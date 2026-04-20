import { exportUserData } from "../data/exportData";
import * as Sharing from "expo-sharing";
import { getDocumentAsync } from "expo-document-picker";
import { importUserData } from "../data/exportData";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type { Permission } from "react-native-health-connect";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  Card,
  Chip,
  Icon,
  IconButton,
  ProgressBar,
  SegmentedButtons,
  Text,
  TextInput,
  useTheme,
  type MD3Theme,
} from "react-native-paper";
import { Directory, File, Paths } from "expo-file-system";

import {
  clearModelCache,
  getModelKeySnapshot,
  getModelMemoryUsageBytes,
  subscribeModelCache,
} from "../lib/modelCache";
import {
  DEFAULT_DATA,
  getCachedData,
  loadStoredData as readStoredData,
  saveStoredData,
} from "../data/storage";
import type {
  BodyFatPoint,
  ModelConfig,
  StoredData,
  WeightPoint,
} from "../data/storage";
import { useThemeMode, type ThemeMode } from "../ui/themeMode";

const DEFAULT_MODEL_CONFIG: ModelConfig = {
  temperature: 0.2,
  maxTokens: 1024,
  topK: 40,
  topP: 0.95,
};

type HealthConnectModule = typeof import("react-native-health-connect");
const healthConnect: HealthConnectModule | null =
  Platform.OS === "android" ? require("react-native-health-connect") : null;

type HealthStatus =
  | "idle"
  | "available"
  | "syncing"
  | "unavailable"
  | "update-required"
  | "error";

type ModelCatalogItem = {
  key: "GEMMA_4_E2B_IT" | "GEMMA_4_E4B_IT";
  label: string;
  sizeLabel: string;
  url: string;
  fileName: string;
};

type DownloadedModel = {
  name: string;
  uri: string;
  size: number | null;
  modifiedAt: number | null;
};

/**
 * Download URL for the Gemma 4 E2B IT model (2.58 GB).
 * Public - no HuggingFace account required.
 */
export const GEMMA_4_E2B_IT =
  "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm";

/**
 * Download URL for the Gemma 4 E4B IT model (3.65 GB).
 * Higher quality than E2B but requires more device memory.
 * Public - no HuggingFace account required.
 */
export const GEMMA_4_E4B_IT =
  "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it.litertlm";

const BUILT_IN_MODELS: ModelCatalogItem[] = [
  {
    key: "GEMMA_4_E2B_IT",
    label: "Gemma-4-E2B-it",
    sizeLabel: "2.58 GB",
    url: GEMMA_4_E2B_IT,
    fileName: "gemma-4-E2B-it.litertlm",
  },
  {
    key: "GEMMA_4_E4B_IT",
    label: "Gemma-4-E4B-it",
    sizeLabel: "3.65 GB",
    url: GEMMA_4_E4B_IT,
    fileName: "gemma-4-E4B-it.litertlm",
  },
];

const MODEL_DIRECTORY = new Directory(Paths.document, "models");

type ModelConfigModalProps = {
  modelUri: string | null;
  modelName: string;
  config: ModelConfig | null;
  theme: MD3Theme;
  onSave: (config: ModelConfig) => void;
  onClose: () => void;
};

const ModelConfigModal = memo(function ModelConfigModal({
  modelUri,
  modelName,
  config,
  theme,
  onSave,
  onClose,
}: ModelConfigModalProps) {
  const [draft, setDraft] = useState<ModelConfig>(
    () => config ?? DEFAULT_MODEL_CONFIG,
  );

  useEffect(() => {
    if (config) setDraft(config);
  }, [config]);

  return (
    <Modal
      visible={!!modelUri}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.modalCard, { backgroundColor: theme.colors.surface }]}
          onPress={() => {}}
        >
          <Text variant="titleMedium" style={{ fontWeight: "700" }}>
            {modelName} Settings
          </Text>
          <Text
            variant="labelSmall"
            style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}
          >
            Inference parameters
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              mode="outlined"
              label="Temperature"
              keyboardType="numeric"
              value={String(draft.temperature)}
              onChangeText={(value) => {
                const num = Number(value);
                if (Number.isFinite(num) && num >= 0 && num <= 2) {
                  setDraft((prev) => ({ ...prev, temperature: num }));
                }
              }}
              style={{ flex: 1 }}
            />
            <TextInput
              mode="outlined"
              label="Max Tokens"
              keyboardType="number-pad"
              value={String(draft.maxTokens)}
              onChangeText={(value) => {
                const num = Number(value);
                if (Number.isFinite(num) && num > 0) {
                  setDraft((prev) => ({ ...prev, maxTokens: Math.round(num) }));
                }
              }}
              style={{ flex: 1 }}
            />
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              mode="outlined"
              label="Top K"
              keyboardType="number-pad"
              value={String(draft.topK)}
              onChangeText={(value) => {
                const num = Number(value);
                if (Number.isFinite(num) && num >= 0) {
                  setDraft((prev) => ({ ...prev, topK: Math.round(num) }));
                }
              }}
              style={{ flex: 1 }}
            />
            <TextInput
              mode="outlined"
              label="Top P"
              keyboardType="numeric"
              value={String(draft.topP)}
              onChangeText={(value) => {
                const num = Number(value);
                if (Number.isFinite(num) && num >= 0 && num <= 1) {
                  setDraft((prev) => ({ ...prev, topP: num }));
                }
              }}
              style={{ flex: 1 }}
            />
          </View>
          <View
            style={{
              flexDirection: "row",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 4,
            }}
          >
            <Button mode="text" onPress={() => setDraft(DEFAULT_MODEL_CONFIG)}>
              Reset
            </Button>
            <Button mode="text" onPress={onClose}>
              Cancel
            </Button>
            <Button mode="contained" onPress={() => onSave(draft)}>
              Save
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function roundTo(value: number, digits = 1) {
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

function mergeWeightHistory(
  existing: WeightPoint[],
  incoming: WeightPoint[],
): WeightPoint[] {
  const keyed = new Map<string, WeightPoint>();
  for (const p of [...existing, ...incoming])
    keyed.set(`${p.source}-${p.recordedAt}`, p);
  return Array.from(keyed.values()).sort(
    (a, b) =>
      new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
  );
}

function mergeBodyFatHistory(
  existing: BodyFatPoint[],
  incoming: BodyFatPoint[],
): BodyFatPoint[] {
  const keyed = new Map<string, BodyFatPoint>();
  for (const p of [...existing, ...incoming])
    keyed.set(`${p.source}-${p.recordedAt}`, p);
  return Array.from(keyed.values()).sort(
    (a, b) =>
      new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
  );
}

function formatDisplayDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Unknown Health Connect error.";
}

function hasPermission(
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

function extractHealthOrigin(record: unknown) {
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
  } as Pick<WeightPoint, "originAppId" | "originAppName" | "originDevice">;
}

function formatBytes(value: number | null) {
  if (!value || value <= 0) return "Unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

async function resolveRemoteFileSize(url: string) {
  try {
    const head = await fetch(url, { method: "HEAD" });
    const headLength = head.headers.get("content-length");
    if (head.ok && headLength) {
      const parsed = parseInt(headLength, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // Best effort only.
  }

  try {
    const range = await fetch(url, { headers: { Range: "bytes=0-0" } });
    const contentRange = range.headers.get("content-range");
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)$/);
      if (match?.[1]) {
        const parsed = parseInt(match[1], 10);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
      }
    }
    const rangeLength = range.headers.get("content-length");
    if (range.ok && rangeLength) {
      const parsed = parseInt(rangeLength, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // Best effort only.
  }

  return null;
}

export default function SettingsScreen() {
  const [isExporting, setIsExporting] = useState(false);
  // Import data from JSON file
  const handleImportData = async () => {
    try {
      const result = await getDocumentAsync({
        type: "application/json",
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const fileUri = result.assets[0].uri;
      const file = new File(fileUri);
      if (!file.exists) {
        Alert.alert("Import failed", "Selected file does not exist.");
        return;
      }
      const json = await file.text();
      await importUserData(json);
      Alert.alert("Import successful", "Your data has been imported.");
    } catch (error) {
      Alert.alert(
        "Import failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  // Export data as JSON and share
  const handleExportData = async () => {
    try {
      setIsExporting(true);
      const json = exportUserData();
      const now = new Date();
      const timestamp = now
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .slice(0, 19);
      const filename = `calorie-tracker-export_${timestamp}.json`;
      const file = new File(Paths.document, filename);
      file.create({ overwrite: true });
      file.write(json);
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/json",
        dialogTitle: "Export Calorie Tracker Data",
      });
    } catch (error) {
      Alert.alert(
        "Export failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setIsExporting(false);
    }
  };
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { mode, setMode } = useThemeMode();

  const loadedModelKey = useSyncExternalStore(
    subscribeModelCache,
    getModelKeySnapshot,
  );

  // Memory usage tracking
  const [memoryUsageBytes, setMemoryUsageBytes] = useState<number | null>(null);

  // Poll memory usage when a model is loaded
  useEffect(() => {
    if (!loadedModelKey) {
      setMemoryUsageBytes(null);
      return;
    }

    const updateMemoryUsage = () => {
      const bytes = getModelMemoryUsageBytes();
      setMemoryUsageBytes(bytes);
    };

    updateMemoryUsage();
    const interval = setInterval(updateMemoryUsage, 2000);
    return () => clearInterval(interval);
  }, [loadedModelKey]);

  function isInMemory(modelUri: string) {
    if (!loadedModelKey) return false;
    const cleaned = modelUri.startsWith("file:///")
      ? modelUri.replace("file:///", "/")
      : modelUri;
    return loadedModelKey.startsWith(cleaned + "::");
  }

  const [data, setData] = useState<StoredData>(
    () => getCachedData() ?? DEFAULT_DATA,
  );
  const [isReady, setIsReady] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatus>("idle");
  const [healthMessage, setHealthMessage] = useState(
    "Health Connect sync is ready to configure.",
  );
  const [isSyncingWeight, setIsSyncingWeight] = useState(false);

  const [selectedModelKey, setSelectedModelKey] = useState<
    "GEMMA_4_E2B_IT" | "GEMMA_4_E4B_IT" | "custom"
  >("GEMMA_4_E2B_IT");
  const [customModelUrl, setCustomModelUrl] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState<number | null>(null);
  const [downloadSpeed, setDownloadSpeed] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadedModels, setDownloadedModels] = useState<DownloadedModel[]>(
    [],
  );
  const [activeModelConfigUri, setActiveModelConfigUri] = useState<
    string | null
  >(null);

  const activeModelConfig = activeModelConfigUri
    ? (data.perModelConfig?.[activeModelConfigUri] ?? DEFAULT_MODEL_CONFIG)
    : null;

  const handleSaveModelConfig = (config: ModelConfig) => {
    if (!activeModelConfigUri) return;
    setData((prev) => ({
      ...prev,
      perModelConfig: {
        ...prev.perModelConfig,
        [activeModelConfigUri]: config,
      },
    }));
    setActiveModelConfigUri(null);
  };

  const loadStoredData = useCallback(async () => {
    const next = await readStoredData();
    setData(next);
    return next;
  }, []);

  const refreshDownloadedModels = useCallback(async () => {
    if (!MODEL_DIRECTORY.exists) {
      MODEL_DIRECTORY.create({ intermediates: true, idempotent: true });
      setDownloadedModels([]);
      return;
    }

    const details: DownloadedModel[] = MODEL_DIRECTORY.list()
      .filter((entry): entry is File => entry instanceof File)
      .filter((file) => file.name.toLowerCase().endsWith(".litertlm"))
      .map((file) => ({
        name: file.name,
        uri: file.uri,
        size: file.exists ? file.size : null,
        modifiedAt: file.exists ? file.modificationTime : null,
      }));

    details.sort((a, b) => (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0));
    setDownloadedModels(details);
  }, []);

  useEffect(() => {
    loadStoredData()
      .then(() => refreshDownloadedModels())
      .catch(() =>
        Alert.alert("Storage error", "Saved data could not be loaded."),
      )
      .finally(() => setIsReady(true));
  }, [loadStoredData, refreshDownloadedModels]);

  useFocusEffect(
    useCallback(() => {
      loadStoredData().catch(() => {
        Alert.alert("Storage error", "Saved data could not be loaded.");
      });
      refreshDownloadedModels().catch(() => {
        Alert.alert(
          "File error",
          "Downloaded model list could not be refreshed.",
        );
      });
    }, [loadStoredData, refreshDownloadedModels]),
  );

  useEffect(() => {
    if (!healthConnect) {
      setHealthStatus("unavailable");
      setHealthMessage(
        "Health Connect is only available on Android development builds.",
      );
      return;
    }
    healthConnect
      .getSdkStatus()
      .then((status) => {
        if (status === healthConnect.SdkAvailabilityStatus.SDK_AVAILABLE) {
          setHealthStatus("available");
          setHealthMessage(
            "Health Connect is available. Sync body data to import weight and body fat records.",
          );
        } else if (
          status ===
          healthConnect.SdkAvailabilityStatus
            .SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
        ) {
          setHealthStatus("update-required");
          setHealthMessage(
            "Install or update Health Connect before syncing body data.",
          );
        } else {
          setHealthStatus("unavailable");
          setHealthMessage(
            "Health Connect is not available on this device yet.",
          );
        }
      })
      .catch(() => {
        setHealthStatus("error");
        setHealthMessage("Health Connect status could not be checked.");
      });
  }, []);

  useEffect(() => {
    if (!isReady) return;
    saveStoredData(data).catch(() =>
      Alert.alert("Storage error", "Changes could not be saved."),
    );
  }, [data, isReady]);

  const ensureHealthConnectAvailable = async () => {
    if (!healthConnect) {
      Alert.alert(
        "Unavailable",
        "Health Connect requires an Android development build.",
      );
      return false;
    }

    const status = await healthConnect.getSdkStatus();
    if (status !== healthConnect.SdkAvailabilityStatus.SDK_AVAILABLE) {
      const isUpdate =
        status ===
        healthConnect.SdkAvailabilityStatus
          .SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED;
      setHealthStatus(isUpdate ? "update-required" : "unavailable");
      setHealthMessage(
        isUpdate
          ? "Install or update Health Connect and try again."
          : "Health Connect is unavailable on this device.",
      );
      return false;
    }

    await healthConnect.initialize();
    setHealthStatus("available");
    return true;
  };

  const syncWeight = async () => {
    if (!healthConnect) {
      Alert.alert(
        "Unavailable",
        "Health Connect requires an Android development build.",
      );
      return;
    }
    setIsSyncingWeight(true);
    setHealthStatus("syncing");
    setHealthMessage("Syncing weight and body fat data from Health Connect...");

    try {
      const available = await ensureHealthConnectAvailable();
      if (!available) return;

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
        setHealthStatus("error");
        setHealthMessage(
          "Weight/Body Fat permissions are off. Open Health Connect settings and allow this app to read Weight or Body Fat records, then sync again.",
        );
        Alert.alert(
          "Body Data Permission Needed",
          "This app needs Health Connect permission to read Weight and Body Fat data. In Health Connect, enable Weight and Body Fat under app permissions, then tap Sync body data again.",
          [{ text: "OK" }],
        );
        return;
      }

      const endTime = new Date();
      const startTime = addDays(endTime, -400).toISOString();
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
              endTime: endTime.toISOString(),
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
                endTime: endTime.toISOString(),
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

      const synced: WeightPoint[] = allRecords.map((r) => ({
        recordedAt: r.time,
        weightKg: roundTo(r.weight.inKilograms, 2),
        source: "health-connect",
        ...extractHealthOrigin(r),
      }));

      const syncedBodyFat: BodyFatPoint[] = allBodyFatRecords
        .map((r) => {
          const raw =
            typeof r.percentage === "number"
              ? r.percentage
              : typeof (r as { percentage?: { value?: number } }).percentage
                    ?.value === "number"
                ? (r as { percentage?: { value?: number } }).percentage!.value!
                : NaN;
          return {
            recordedAt: r.time,
            bodyFatPercentage: roundTo(raw, 2),
            source: "health-connect" as const,
            ...extractHealthOrigin(r),
          };
        })
        .filter((point) => Number.isFinite(point.bodyFatPercentage));

      setData((prev) => ({
        ...prev,
        weightHistory: mergeWeightHistory(
          prev.weightHistory.filter((p) => p.source !== "health-connect"),
          synced,
        ),
        bodyFatHistory: mergeBodyFatHistory(
          prev.bodyFatHistory.filter((p) => p.source !== "health-connect"),
          syncedBodyFat,
        ),
        lastWeightSyncAt: new Date().toISOString(),
        lastBodyFatSyncAt: new Date().toISOString(),
      }));

      setHealthStatus("available");
      setHealthMessage(
        synced.length || syncedBodyFat.length
          ? `Synced ${synced.length} weight and ${syncedBodyFat.length} body fat record${synced.length + syncedBodyFat.length === 1 ? "" : "s"}.`
          : "No recent body metric records found in Health Connect.",
      );
    } catch (error) {
      const reason = getErrorMessage(error);
      setHealthStatus("error");
      setHealthMessage(`Body sync failed: ${reason}`);
      Alert.alert("Sync Failed", `Could not sync body data. ${reason}`);
    } finally {
      setIsSyncingWeight(false);
    }
  };

  const openHealthSettings = () => {
    if (!healthConnect) {
      Alert.alert(
        "Unavailable",
        "Health Connect requires an Android development build.",
      );
      return;
    }
    if (typeof healthConnect.openHealthConnectSettings !== "function") {
      Alert.alert(
        "Unavailable",
        "Health Connect settings cannot be opened on this device.",
      );
      return;
    }

    try {
      healthConnect.openHealthConnectSettings();
    } catch (error) {
      Alert.alert("Could not open settings", getErrorMessage(error));
    }
  };

  const onPressSyncWeight = () => {
    if (healthStatus === "unavailable" || healthStatus === "update-required") {
      Alert.alert(
        "Health Connect Unavailable",
        healthStatus === "update-required"
          ? "Please install or update Health Connect first, then try syncing again."
          : "Health Connect is not available on this device yet.",
      );
      return;
    }
    void syncWeight();
  };

  const resolveDownloadSource = () => {
    if (selectedModelKey === "custom") {
      const trimmed = customModelUrl.trim();
      if (!trimmed) return null;
      const tail = trimmed.split("/").pop() || `model-${Date.now()}.litertlm`;
      return { label: "Custom model", url: trimmed, fileName: tail };
    }

    const selected = BUILT_IN_MODELS.find(
      (item) => item.key === selectedModelKey,
    );
    if (!selected) return null;
    return {
      label: selected.label,
      url: selected.url,
      fileName: selected.fileName,
    };
  };

  const handleDownloadModel = async () => {
    setDownloadError(null);

    const source = resolveDownloadSource();
    if (!source) {
      setDownloadError("Select a model or enter a valid custom URL first.");
      return;
    }

    try {
      setIsDownloading(true);
      setDownloadProgress(0);
      setDownloadedBytes(0);
      setTotalBytes(null);
      setDownloadSpeed(null);

      if (!MODEL_DIRECTORY.exists) {
        MODEL_DIRECTORY.create({ intermediates: true, idempotent: true });
      }

      const destFile = new File(MODEL_DIRECTORY, source.fileName);
      if (destFile.exists) destFile.delete();
      destFile.create();
      let knownTotalBytes: number | null = null;

      knownTotalBytes = await resolveRemoteFileSize(source.url);
      if (knownTotalBytes && knownTotalBytes > 0) {
        setTotalBytes(knownTotalBytes);
      }

      let usedFallback = false;
      try {
        const response = await fetch(source.url);
        if (!response.ok)
          throw new Error(`Server returned HTTP ${response.status}`);

        const contentLength = response.headers.get("content-length");
        const total = contentLength ? parseInt(contentLength, 10) : null;
        if (total && total > 0) {
          knownTotalBytes = total;
          setTotalBytes(total);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error("Response body is not readable.");

        const handle = destFile.open();
        let written = 0;
        let speedWindowStart = Date.now();
        let speedWindowBytes = 0;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            handle.writeBytes(value);
            written += value.byteLength;
            speedWindowBytes += value.byteLength;

            const now = Date.now();
            const elapsed = (now - speedWindowStart) / 1000;
            if (elapsed >= 0.5) {
              setDownloadSpeed(speedWindowBytes / elapsed);
              speedWindowStart = now;
              speedWindowBytes = 0;
            }

            setDownloadedBytes(written);
            if (knownTotalBytes) setDownloadProgress(written / knownTotalBytes);
          }
        } finally {
          handle.close();
        }
      } catch {
        usedFallback = true;

        if (destFile.exists) destFile.delete();
        destFile.create();

        let pollTimer: ReturnType<typeof setInterval> | null = null;
        let lastBytes = 0;
        let lastTime = Date.now();

        try {
          // Fallback: native downloader with periodic file-size polling for live progress/speed.
          pollTimer = setInterval(() => {
            if (!destFile.exists) return;
            const currentBytes = destFile.size;
            const now = Date.now();
            const elapsed = (now - lastTime) / 1000;
            if (elapsed > 0) {
              setDownloadSpeed((currentBytes - lastBytes) / elapsed);
            }
            lastBytes = currentBytes;
            lastTime = now;
            setDownloadedBytes(currentBytes);
            if (knownTotalBytes && knownTotalBytes > 0) {
              setDownloadProgress(currentBytes / knownTotalBytes);
            }
          }, 700);

          await File.downloadFileAsync(source.url, destFile, {
            idempotent: true,
          });
        } finally {
          if (pollTimer) clearInterval(pollTimer);
        }
      }

      if (destFile.exists) {
        const finalBytes = destFile.size;
        setDownloadedBytes(finalBytes);
        if (knownTotalBytes && knownTotalBytes > 0) {
          setDownloadProgress(1);
        } else if (usedFallback) {
          setTotalBytes(finalBytes);
          setDownloadProgress(1);
        }
      }

      if (!usedFallback && knownTotalBytes && knownTotalBytes > 0) {
        setDownloadProgress(1);
      }

      setData((prev) => ({ ...prev, modelPath: destFile.uri }));
      await refreshDownloadedModels();
      Alert.alert(
        "Download complete",
        `${source.label} is ready and selected for AI meal estimation.`,
      );
    } catch (error) {
      setDownloadError(`Download failed: ${getErrorMessage(error)}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const setActiveModel = (uri: string) => {
    if (data.modelPath !== uri) clearModelCache();
    setData((prev) => ({ ...prev, modelPath: uri }));
  };

  const handleDeleteModel = (model: DownloadedModel) => {
    Alert.alert("Delete model?", `Remove ${model.name} from local storage?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              if (isInMemory(model.uri)) clearModelCache();
              const file = new File(model.uri);
              if (file.exists) file.delete();
              setData((prev) => ({
                ...prev,
                modelPath: prev.modelPath === model.uri ? null : prev.modelPath,
              }));
              await refreshDownloadedModels();
            } catch (error) {
              Alert.alert("Delete failed", getErrorMessage(error));
            }
          })();
        },
      },
    ]);
  };

  const latestWeight = data.weightHistory[0]?.weightKg ?? data.manualWeightKg;
  const latestBodyFat = data.bodyFatHistory[0]?.bodyFatPercentage ?? null;

  useEffect(() => {
    if (!isReady || !data.modelPath) return;
    const exists = downloadedModels.some(
      (model) => model.uri === data.modelPath,
    );
    if (!exists) {
      setData((prev) =>
        prev.modelPath === data.modelPath ? { ...prev, modelPath: null } : prev,
      );
    }
  }, [data.modelPath, downloadedModels, isReady]);

  const selectedModelDescription = useMemo(() => {
    if (!data.modelPath) return "No model selected.";
    const active = downloadedModels.find(
      (model) => model.uri === data.modelPath,
    );
    if (active) return `${active.name} (local)`;
    return "No model selected.";
  }, [data.modelPath, downloadedModels]);

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, backgroundColor: theme.colors.background },
      ]}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.card} mode="elevated">
          <Card.Title title="Appearance" titleVariant="titleLarge" />
          <Card.Content style={styles.formArea}>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              Theme follows your system preference by default.
            </Text>
            <SegmentedButtons
              value={mode}
              onValueChange={(value) => setMode(value as ThemeMode)}
              buttons={[
                { value: "system", label: "System", icon: "theme-light-dark" },
                { value: "light", label: "Light", icon: "weather-sunny" },
                { value: "dark", label: "Dark", icon: "weather-night" },
              ]}
            />
          </Card.Content>
        </Card>

        <Card style={styles.card} mode="elevated">
          <Card.Title title="Health Connect" titleVariant="titleLarge" />
          <Card.Content style={styles.formArea}>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              {healthMessage}
            </Text>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              Latest weight: {latestWeight ? `${latestWeight} kg` : "None yet"}
            </Text>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              Latest body fat:{" "}
              {latestBodyFat !== null ? `${latestBodyFat}%` : "None yet"}
            </Text>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              Last sync:{" "}
              {data.lastWeightSyncAt
                ? formatDisplayDate(data.lastWeightSyncAt)
                : "Never"}
            </Text>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              Last body fat sync:{" "}
              {data.lastBodyFatSyncAt
                ? formatDisplayDate(data.lastBodyFatSyncAt)
                : "Never"}
            </Text>
            <Chip
              icon={
                healthStatus === "available"
                  ? "check-circle"
                  : "information-outline"
              }
            >
              Status: {healthStatus}
            </Chip>
            <View style={styles.buttonColumn}>
              <Button
                style={styles.button}
                mode="contained"
                icon="sync"
                loading={isSyncingWeight}
                disabled={isSyncingWeight}
                onPress={onPressSyncWeight}
              >
                {isSyncingWeight ? "Syncing..." : "Sync body data"}
              </Button>
              <Button mode="outlined" icon="cog" onPress={openHealthSettings}>
                Open settings
              </Button>
            </View>
          </Card.Content>
        </Card>

        <Card style={styles.card} mode="elevated">
          <Card.Title title="LiteRT Models" titleVariant="titleLarge" />
          <Card.Content style={styles.formArea}>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              Active model: {selectedModelDescription}
            </Text>
            {memoryUsageBytes !== null ? (
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <MaterialCommunityIcons
                  name="memory"
                  size={16}
                  color={theme.dark ? "#7bd88f" : "#2e7d32"}
                />
                <Text
                  variant="bodySmall"
                  style={{ color: theme.dark ? "#7bd88f" : "#2e7d32" }}
                >
                  Memory: {(memoryUsageBytes / 1024 / 1024).toFixed(1)} MB
                </Text>
              </View>
            ) : loadedModelKey ? (
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.onSurfaceVariant }}
              >
                Memory usage available when tracking enabled
              </Text>
            ) : null}

            <View style={styles.modelSelector}>
              {BUILT_IN_MODELS.map((model) => (
                <Button
                  key={model.key}
                  mode={
                    selectedModelKey === model.key ? "contained" : "outlined"
                  }
                  onPress={() => setSelectedModelKey(model.key)}
                >
                  {model.label} ({model.sizeLabel})
                </Button>
              ))}
              <Button
                mode={selectedModelKey === "custom" ? "contained" : "outlined"}
                onPress={() => setSelectedModelKey("custom")}
              >
                Custom URL
              </Button>
            </View>

            {selectedModelKey === "custom" ? (
              <TextInput
                mode="outlined"
                label="Model URL"
                value={customModelUrl}
                onChangeText={setCustomModelUrl}
                placeholder="https://.../model.litertlm"
                autoCapitalize="none"
                autoCorrect={false}
              />
            ) : null}

            <Button
              mode="contained"
              icon="download"
              onPress={handleDownloadModel}
              loading={isDownloading}
              disabled={
                isDownloading ||
                (selectedModelKey === "custom" && !customModelUrl.trim())
              }
            >
              {isDownloading
                ? "Downloading model..."
                : "Download selected model"}
            </Button>

            {isDownloading ? (
              <View style={styles.downloadProgressArea}>
                <ProgressBar
                  progress={totalBytes ? downloadProgress : undefined}
                  indeterminate={!totalBytes}
                  style={styles.progressBar}
                />
                <View style={styles.downloadProgressRow}>
                  <Text
                    variant="labelMedium"
                    style={{ color: theme.colors.onSurfaceVariant }}
                  >
                    {totalBytes
                      ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)} (${Math.round(downloadProgress * 100)}%)`
                      : formatBytes(downloadedBytes)}
                  </Text>
                  {downloadSpeed !== null ? (
                    <Text
                      variant="labelMedium"
                      style={{ color: theme.colors.onSurfaceVariant }}
                    >
                      {formatBytes(Math.round(downloadSpeed))}/s
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            {downloadError ? (
              <Text variant="bodyMedium" style={{ color: theme.colors.error }}>
                {downloadError}
              </Text>
            ) : null}

            <View
              style={[
                styles.downloadedModelsContainer,
                {
                  backgroundColor: theme.colors.elevation.level1,
                  borderColor: theme.colors.primary,
                },
              ]}
            >
              <View style={styles.downloadedModelsHeader}>
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <MaterialCommunityIcons
                    name="package-down"
                    size={24}
                    color={theme.colors.primary}
                  />
                  <Text
                    variant="headlineSmall"
                    style={{ fontWeight: "700", color: theme.colors.primary }}
                  >
                    Offline Models
                  </Text>
                </View>
              </View>
              {downloadedModels.length ? (
                <View style={styles.downloadedList}>
                  {downloadedModels.map((model) => {
                    const isActive = data.modelPath === model.uri;
                    const inMemory = isInMemory(model.uri);
                    const hasCustomConfig =
                      !!data.perModelConfig?.[model.uri] &&
                      JSON.stringify(data.perModelConfig[model.uri]) !==
                        JSON.stringify(DEFAULT_MODEL_CONFIG);
                    return (
                      <View
                        key={model.uri}
                        style={[
                          styles.downloadedItem,
                          {
                            borderColor: isActive
                              ? theme.colors.primary
                              : theme.colors.outlineVariant,
                            backgroundColor: theme.colors.elevation.level2,
                          },
                        ]}
                      >
                        <View style={styles.downloadedItemTopRow}>
                          <View style={styles.downloadedItemNameRow}>
                            <Text
                              variant="bodyLarge"
                              numberOfLines={1}
                              style={styles.downloadedItemName}
                            >
                              {model.name}
                            </Text>
                            {inMemory ? (
                              <Icon
                                source="memory"
                                color={theme.dark ? "#7bd88f" : "#2e7d32"}
                                size={20}
                              />
                            ) : null}
                            {hasCustomConfig ? (
                              <Icon
                                source="tune"
                                color={theme.colors.primary}
                                size={16}
                              />
                            ) : null}
                          </View>
                          <IconButton
                            icon="cog-outline"
                            size={22}
                            onPress={() => setActiveModelConfigUri(model.uri)}
                            style={{ marginVertical: -8 }}
                          />
                        </View>
                        <Text
                          variant="bodySmall"
                          style={{ color: theme.colors.onSurfaceVariant }}
                        >
                          {formatBytes(model.size)}
                        </Text>
                        <View style={styles.downloadedItemActions}>
                          <Button
                            mode={isActive ? "contained" : "outlined"}
                            onPress={() => setActiveModel(model.uri)}
                          >
                            {isActive ? "In use" : "Use"}
                          </Button>
                          {inMemory ? (
                            <Button
                              mode="outlined"
                              onPress={() => clearModelCache()}
                            >
                              Unload
                            </Button>
                          ) : null}
                          <Button
                            mode="text"
                            compact
                            textColor={theme.colors.error}
                            onPress={() => handleDeleteModel(model)}
                          >
                            Delete
                          </Button>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <Text
                  variant="bodyMedium"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  No models downloaded yet.
                </Text>
              )}
            </View>
          </Card.Content>
        </Card>

        <Card style={styles.card} mode="elevated">
          <Card.Title title="Advanced" titleVariant="titleLarge" />
          <Card.Content style={styles.formArea}>
            <Button
              mode="contained"
              icon="export"
              onPress={handleExportData}
              loading={isExporting}
              disabled={isExporting}
              style={{ marginBottom: 8 }}
            >
              {isExporting ? "Exporting..." : "Export data"}
            </Button>
            <Button
              mode="outlined"
              icon="import"
              onPress={handleImportData}
              style={{ marginBottom: 16 }}
            >
              Import data
            </Button>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}
            >
              Macro mismatch tolerance
            </Text>
            <Text
              variant="labelSmall"
              style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}
            >
              Percentage of logged calories allowed to differ from calculated
              macros (default: 12%)
            </Text>
            <TextInput
              mode="outlined"
              label="Tolerance %"
              keyboardType="number-pad"
              value={String(data.calorieTolerancePercent)}
              onChangeText={(value) => {
                const num = Number(value);
                if (Number.isFinite(num) && num >= 0) {
                  setData((prev) => ({
                    ...prev,
                    calorieTolerancePercent: num,
                  }));
                }
              }}
            />

            <Text
              variant="labelSmall"
              style={{
                color: theme.colors.onSurfaceVariant,
                marginTop: 12,
                marginBottom: 8,
              }}
            >
              Graph status tolerance
            </Text>
            <Text
              variant="labelSmall"
              style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}
            >
              How close you need to be to your goal to show On target (default:
              100 kcal)
            </Text>
            <TextInput
              mode="outlined"
              label="Graph tolerance (kcal)"
              keyboardType="number-pad"
              value={String(data.graphToleranceCalories)}
              onChangeText={(value) => {
                const num = Number(value);
                if (Number.isFinite(num) && num >= 0) {
                  setData((prev) => ({ ...prev, graphToleranceCalories: num }));
                }
              }}
            />
          </Card.Content>
        </Card>
      </ScrollView>

      <ModelConfigModal
        modelUri={activeModelConfigUri}
        modelName={
          downloadedModels.find((m) => m.uri === activeModelConfigUri)?.name ??
          "Model"
        }
        config={activeModelConfig ?? DEFAULT_MODEL_CONFIG}
        theme={theme}
        onSave={handleSaveModelConfig}
        onClose={() => setActiveModelConfigUri(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 16, gap: 16 },
  card: { borderRadius: 24 },
  formArea: { gap: 10 },
  buttonColumn: { gap: 10 },
  button: { flex: 1 },
  modelSelector: { gap: 8 },
  downloadProgressArea: { gap: 6 },
  downloadProgressRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressBar: { height: 10, borderRadius: 6 },
  downloadedModelsContainer: {
    borderRadius: 12,
    borderWidth: 2,
    padding: 16,
    gap: 12,
    marginVertical: 4,
    marginHorizontal: 0,
  },
  downloadedModelsHeader: {
    marginBottom: 3,
  },
  downloadedList: { gap: 8 },
  downloadedItem: {
    borderWidth: 2,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  downloadedItemTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  downloadedItemNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 24,
  },
  downloadedItemName: {
    flexShrink: 1,
  },
  downloadedItemActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalCard: {
    borderRadius: 20,
    padding: 20,
    gap: 12,
    maxWidth: 500,
    width: "100%",
  },
});
