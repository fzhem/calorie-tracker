/**
 * Standalone Health Connect sync logic shared between the Settings screen
 * (manual sync + UI feedback) and the root layout (background auto-sync).
 */
import { Platform } from "react-native";
import type { Permission } from "react-native-health-connect";
import { toLocalISOString } from "@/lib/dateKey";
import { insertWeight, insertBodyFat } from "@/db/index";
import type { Weight, BodyFat } from "@/db/index";
import {
  invalidateWeightCaches,
  invalidateBodyFatCaches,
} from "@/lib/queryCache";
import { getCachedData, saveStoredData } from "@/data/storage";

type HealthConnectModule = typeof import("react-native-health-connect");
export const healthConnect: HealthConnectModule | null =
  Platform.OS === "android" ? require("react-native-health-connect") : null;

// ── Helpers ──────────────────────────────────────────────────────────────

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function roundTo(value: number, digits = 1) {
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

export function hasPermission(
  granted: unknown[],
  accessType: Permission["accessType"],
  recordType: string,
) {
  return (
    Array.isArray(granted) &&
    granted.some((permission) => {
      if (!permission || typeof permission !== "object") return false;
      const candidate = permission as {
        accessType?: string;
        recordType?: string;
      };
      return (
        candidate.accessType === accessType &&
        candidate.recordType === recordType
      );
    })
  );
}

function getKnownOriginAppName(appId?: string) {
  if (!appId) return undefined;
  const normalized = appId.toLowerCase();
  if (normalized === "android") return "Android (on-device)";
  if (normalized.includes("shealth") || normalized.includes("samsung.health"))
    return "Samsung Health";
  if (normalized.includes("google.android.apps.fitness")) return "Google Fit";
  if (normalized.includes("healthmate")) return "Withings Health Mate";
  if (normalized.includes("fitbit")) return "Fitbit";
  if (normalized.includes("zepp") || normalized.includes("amazfit"))
    return "Zepp";
  if (normalized.includes("garmin")) return "Garmin";
  if (normalized.includes("healthconnect")) return "Health Connect";
  return undefined;
}

function getDeviceTypeLabel(deviceType?: number) {
  if (typeof deviceType !== "number") return undefined;
  const byType: Record<number, string> = {
    0: "Unknown device type",
    2: "Phone",
    3: "Scale",
    4: "Ring",
    5: "Head-mounted device",
    6: "Fitness band",
    7: "Chest strap",
    8: "Smart display",
  };
  return byType[deviceType];
}

function getStringValueAtPath(input: unknown, path: string[]) {
  let cursor: unknown = input;
  for (const segment of path) {
    if (!cursor || typeof cursor !== "object") return undefined;
    const next = (cursor as Record<string, unknown>)[segment];
    cursor = next;
  }
  return typeof cursor === "string" && cursor.trim() ? cursor : undefined;
}

function getFirstStringAtPaths(input: unknown, paths: string[][]) {
  for (const path of paths) {
    const value = getStringValueAtPath(input, path);
    if (value) return value;
  }
  return undefined;
}

function getNumberValueAtPath(input: unknown, path: string[]) {
  let cursor: unknown = input;
  for (const segment of path) {
    if (!cursor || typeof cursor !== "object") return undefined;
    const next = (cursor as Record<string, unknown>)[segment];
    cursor = next;
  }
  return typeof cursor === "number" ? cursor : undefined;
}

function getFirstNumberAtPaths(input: unknown, paths: string[][]) {
  for (const path of paths) {
    const value = getNumberValueAtPath(input, path);
    if (typeof value === "number") return value;
  }
  return undefined;
}

export function extractHealthOrigin(record: unknown) {
  const originAppId = getFirstStringAtPaths(record, [
    ["metadata", "dataOrigin", "packageName"],
    ["metadata", "dataOrigin", "applicationId"],
    ["metadata", "dataOrigin", "id"],
    ["metadata", "dataOrigin"],
    ["dataOrigin", "packageName"],
    ["dataOrigin", "applicationId"],
    ["dataOrigin", "id"],
    ["dataOrigin"],
    ["metadata", "clientPackageName"],
  ]);

  const deviceManufacturer = getFirstStringAtPaths(record, [
    ["metadata", "device", "manufacturer"],
    ["device", "manufacturer"],
  ]);
  const deviceModel = getFirstStringAtPaths(record, [
    ["metadata", "device", "model"],
    ["device", "model"],
  ]);
  const deviceType = getFirstStringAtPaths(record, [
    ["metadata", "device", "type"],
    ["device", "type"],
  ]);
  const deviceTypeNumber = getFirstNumberAtPaths(record, [
    ["metadata", "device", "type"],
    ["device", "type"],
  ]);
  const deviceTypeLabel = getDeviceTypeLabel(deviceTypeNumber);

  const deviceParts = [deviceManufacturer, deviceModel].filter(
    (value) => !!value?.trim(),
  );
  const originDevice =
    deviceParts.join(" ").trim() || deviceType || deviceTypeLabel;

  return {
    originAppId,
    originAppName: getKnownOriginAppName(originAppId) ?? originAppId,
    originDevice,
  } as Pick<Weight, "originAppId" | "originAppName" | "originDevice">;
}

// ── Core sync ────────────────────────────────────────────────────────────

export type SyncHealthConnectCallbacks = {
  onPermissionDenied?: () => void;
  onError?: (reason: string) => void;
  onSuccess?: () => void;
};

/**
 * Reads weight and body-fat records from Health Connect and inserts them into
 * the local SQLite database.  Safe to call from any component or the root
 * layout — it does not require UI state.
 *
 * Returns `true` on success and `false` on any failure/permission issue.
 */
export async function syncHealthConnectData(
  callbacks: SyncHealthConnectCallbacks = {},
): Promise<boolean> {
  if (!healthConnect) return false;

  try {
    const status = await healthConnect.getSdkStatus();
    if (status !== healthConnect.SdkAvailabilityStatus.SDK_AVAILABLE) {
      return false;
    }

    await healthConnect.initialize();

    const permissions = [
      { accessType: "read" as const, recordType: "Weight" as const },
      { accessType: "read" as const, recordType: "BodyFat" as const },
      {
        accessType: "read" as const,
        recordType: "ReadHealthDataHistory" as const,
      },
    ];
    const granted = await healthConnect.requestPermission(permissions);
    const hasWeightPermission = hasPermission(granted, "read", "Weight");
    const hasBodyFatPermission = hasPermission(granted, "read", "BodyFat");

    if (!hasWeightPermission && !hasBodyFatPermission) {
      callbacks.onPermissionDenied?.();
      return false;
    }

    const endTime = new Date();
    const startTime = toLocalISOString(addDays(endTime, -400));
    const allRecords: Array<{
      time: string;
      weight: { inKilograms: number };
      metadata?: unknown;
    }> = [];
    const allBodyFatRecords: Array<{
      time: string;
      percentage: number;
      metadata?: unknown;
    }> = [];
    let pageToken: string | undefined;

    if (hasWeightPermission) {
      do {
        const result = await healthConnect.readRecords("Weight", {
          timeRangeFilter: {
            operator: "between",
            startTime,
            endTime: toLocalISOString(endTime),
          },
          ascendingOrder: false,
          pageSize: 1000,
          pageToken,
        });
        allRecords.push(
          ...(result.records as Array<{
            time: string;
            weight: { inKilograms: number };
            metadata?: unknown;
          }>),
        );
        pageToken = result.pageToken;
      } while (pageToken);
    }

    pageToken = undefined;
    if (hasBodyFatPermission) {
      do {
        const result: { records: unknown[]; pageToken?: string } =
          await healthConnect.readRecords("BodyFat", {
            timeRangeFilter: {
              operator: "between",
              startTime,
              endTime: toLocalISOString(endTime),
            },
            ascendingOrder: false,
            pageSize: 1000,
            pageToken,
          });
        allBodyFatRecords.push(
          ...(result.records as Array<{
            time: string;
            percentage: number;
            metadata?: unknown;
          }>),
        );
        pageToken = result.pageToken;
      } while (pageToken);
    }

    const synced: Omit<Weight, "id">[] = allRecords.map((r) => ({
      recordedAt: toLocalISOString(new Date(r.time)),
      weightKg: roundTo(r.weight.inKilograms, 2),
      source: "health-connect",
      ...extractHealthOrigin(r),
    }));

    const syncedBodyFat: Omit<BodyFat, "id">[] = allBodyFatRecords
      .map((r) => {
        const raw =
          typeof r.percentage === "number"
            ? r.percentage
            : typeof (r as { percentage?: { value?: number } }).percentage
                  ?.value === "number"
              ? (r as { percentage?: { value?: number } }).percentage!.value!
              : NaN;
        return {
          recordedAt: toLocalISOString(new Date(r.time)),
          bodyFatPercentage: roundTo(raw, 2),
          source: "health-connect" as const,
          ...extractHealthOrigin(r),
        };
      })
      .filter((point) => Number.isFinite(point.bodyFatPercentage));

    for (const w of synced) {
      await insertWeight(w).catch(() => {});
    }
    for (const bf of syncedBodyFat) {
      await insertBodyFat(bf).catch(() => {});
    }

    // Update last-sync timestamps in persisted storage
    const current = getCachedData();
    if (current) {
      await saveStoredData({
        ...current,
        lastWeightSyncAt: toLocalISOString(new Date()),
        lastBodyFatSyncAt: toLocalISOString(new Date()),
      });
    }

    invalidateWeightCaches();
    invalidateBodyFatCaches();

    callbacks.onSuccess?.();
    return true;
  } catch (error) {
    const reason =
      error instanceof Error && error.message
        ? error.message
        : typeof error === "string" && error.trim()
          ? error
          : "Unknown Health Connect error.";
    callbacks.onError?.(reason);
    return false;
  }
}
