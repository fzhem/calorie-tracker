import { exportUserData } from "@/data/exportData";
import * as Sharing from "expo-sharing";
import { getDocumentAsync } from "expo-document-picker";
import { importUserData } from "@/data/exportData";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useFocusEffect } from "expo-router/react-navigation";
import {
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  Card,
  Chip,
  Icon,
  IconButton,
  ProgressBar,
  SegmentedButtons,
  Snackbar,
  Switch,
  Text,
  TextInput,
  useTheme,
  type MD3Theme,
} from "react-native-paper";
import Slider from "@react-native-community/slider";
import { Directory, File, Paths } from "expo-file-system";
import {
  createDownloadTask,
  completeHandler as completeDownloadHandler,
  getExistingDownloadTasks,
  setConfig as setDownloadConfig,
} from "@kesha-antonov/react-native-background-downloader";

import {
  clearModelCache,
  getModelKeySnapshot,
  getModelMemoryUsageBytes,
  getModelMemoryUsageDetails,
  subscribeModelCache,
} from "@/lib/modelCache";
import { checkModelMemory } from "@/lib/memoryUtils";
import {
  detectArchitecture,
  isLiteRTSupported,
  getLiteRTUnsupportedReason,
  getArchitectureLabel,
  type DeviceArchitecture,
} from "@/lib/architectureUtils";

import { ToastAndroid } from "react-native";
import {
  DEFAULT_DATA,
  DEFAULT_MODEL_CONFIG,
  getCachedData,
  loadStoredData as readStoredData,
  saveStoredData,
} from "@/data/storage";
import type { Weight, BodyFat } from "@/db/index";
import type { ModelConfig, StoredData } from "@/data/storage";
import { useThemeMode, type ThemeMode } from "@/ui/themeMode";
import { useM3Alert } from "@/ui/m3Alert";
import { getAppSegmentedButtonsTheme } from "@/ui/segmentedButtons";

import { getLatestWeight, getLatestBodyFat } from "@/db/index";
import {
  invalidateBodyFatCaches,
  invalidateMealCaches,
  invalidateWeightCaches,
} from "@/lib/queryCache";
import { parseAppDate, toLocalISOString } from "@/lib/dateKey";
import { healthConnect, syncHealthConnectData } from "@/lib/healthConnectSync";

type HealthStatus =
  | "idle"
  | "available"
  | "syncing"
  | "unavailable"
  | "update-required"
  | "error";

type NotificationPermissionStatus =
  | "unknown"
  | "not-required"
  | "granted"
  | "denied";

type ModelCatalogItem = {
  key: "GEMMA_4_E2B_IT" | "GEMMA_4_E4B_IT";
  label: string;
  sizeLabel: string;
  url: string;
  fileName: string;
  recommended?: boolean;
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

/** Magic number for .litertlm model files: "LITERTLM" */
const LITERTLM_MAGIC = [0x4c, 0x49, 0x54, 0x45, 0x52, 0x54, 0x4c, 0x4d];

const BUILT_IN_MODELS: ModelCatalogItem[] = [
  {
    key: "GEMMA_4_E2B_IT",
    label: "Gemma-4-E2B-it",
    sizeLabel: "2.58 GB",
    url: GEMMA_4_E2B_IT,
    fileName: "gemma-4-E2B-it.litertlm",
    recommended: true,
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
const MODAL_CONFIG_MODAL_THEME = { animation: { scale: 0 } };

type ModelConfigModalProps = {
  modelUri: string | null;
  modelName: string;
  config: ModelConfig | null;
  theme: MD3Theme;
  onSave: (config: ModelConfig) => void;
  onClose: () => void;
};

type Accelerator = "cpu" | "gpu" | "npu";

const flex1Style = { flex: 1 };
const FOCUS_REFRESH_INTERVAL_MS = 12_000;

function isModelConfigEqual(a: ModelConfig, b: ModelConfig) {
  return (
    a.temperature === b.temperature &&
    a.maxTokens === b.maxTokens &&
    a.topK === b.topK &&
    a.topP === b.topP &&
    a.backend === b.backend &&
    a.enableSpeculativeDecoding === b.enableSpeculativeDecoding
  );
}

// Use StyleSheet for row styles to avoid type errors and ensure compatibility
const modalRow = {
  flexDirection: "row" as const,
  gap: 8,
};
const modalRowEnd = {
  flexDirection: "row" as const,
  justifyContent: "flex-end" as const,
  gap: 8,
  marginTop: 4,
};

const SliderRow = memo(function SliderRow({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  onValueChange,
  theme,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue: (v: number) => string;
  onValueChange: (v: number) => void;
  theme: MD3Theme;
}) {
  const [valueStr, setValueStr] = useState(() => formatValue(value));
  const [isEditing, setIsEditing] = useState(false);

  // Update text when slider value changes externally (only if not currently editing)
  useEffect(() => {
    if (!isEditing) {
      setValueStr(formatValue(value));
    }
  }, [value, formatValue, isEditing]);

  const handleTextChangeStart = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleValueChange = useCallback(
    (text: string) => {
      setValueStr(text);
      const num = Number(text);
      // Only update slider if value is valid and in range
      if (Number.isFinite(num) && num >= min && num <= max) {
        onValueChange(num);
      }
    },
    [min, max, onValueChange],
  );

  const handleBlur = useCallback(() => {
    const num = Number(valueStr);
    if (!Number.isFinite(num) || num < min) {
      setValueStr(formatValue(min));
      onValueChange(min);
    } else if (num > max) {
      setValueStr(formatValue(max));
      onValueChange(max);
    } else {
      const rounded = Math.round(num * 100) / 100;
      setValueStr(formatValue(rounded));
      if (rounded !== num) {
        onValueChange(rounded);
      }
    }
  }, [valueStr, min, max, onValueChange, formatValue]);

  return (
    <View style={sliderRowStyles.container}>
      <Text variant="bodyMedium">{label}</Text>
      <View style={sliderRowStyles.sliderRow}>
        <Text
          variant="bodySmall"
          style={{ color: theme.colors.onSurfaceVariant }}
        >
          {formatValue(min)}
        </Text>
        <Slider
          style={{ flex: 1 }}
          value={value}
          minimumValue={min}
          maximumValue={max}
          step={step}
          onValueChange={onValueChange}
          minimumTrackTintColor={theme.colors.primary}
          maximumTrackTintColor={theme.colors.surfaceVariant}
          thumbTintColor={theme.colors.primary}
        />
        <TextInput
          mode="outlined"
          keyboardType="decimal-pad"
          value={valueStr}
          onChangeText={handleValueChange}
          onFocus={handleTextChangeStart}
          onBlur={() => {
            setIsEditing(false);
            handleBlur();
          }}
          style={sliderRowStyles.valueInput}
          contentStyle={sliderRowStyles.valueInputContent}
          dense
        />
      </View>
    </View>
  );
});

const sliderRowStyles = StyleSheet.create({
  container: { gap: 6 },
  sliderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  valueInput: {
    width: 72,
    height: 40,
    marginVertical: 0,
  },
  valueInputContent: {
    height: 40,
    paddingVertical: 0,
  },
});

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
  const [accelerator, setAccelerator] = useState<Accelerator>(
    () => (config?.backend as Accelerator) ?? "cpu",
  );
  const [enableSpeculativeDecoding, setEnableSpeculativeDecoding] =
    useState<boolean>(() => config?.enableSpeculativeDecoding ?? false);

  useEffect(() => {
    if (config && !isModelConfigEqual(config, draft)) setDraft(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useEffect(() => {
    setAccelerator((config?.backend as Accelerator) ?? "cpu");
    setEnableSpeculativeDecoding(config?.enableSpeculativeDecoding ?? false);
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

          {/* Max Tokens */}
          <View style={modalRow}>
            <TextInput
              mode="outlined"
              label="Max tokens"
              keyboardType="number-pad"
              value={String(draft.maxTokens)}
              onChangeText={(value) => {
                const num = Number(value);
                if (Number.isFinite(num) && num > 0) {
                  setDraft((prev) => ({ ...prev, maxTokens: Math.round(num) }));
                }
              }}
              style={{ flex: 1 }}
              theme={MODAL_CONFIG_MODAL_THEME}
            />
          </View>

          {/* TopK Slider */}
          <SliderRow
            label="TopK (5-100)"
            value={draft.topK}
            min={5}
            max={100}
            step={1}
            formatValue={(v) => String(Math.round(v))}
            onValueChange={(v) =>
              setDraft((prev) => ({ ...prev, topK: Math.round(v) }))
            }
            theme={theme}
          />

          {/* TopP Slider */}
          <SliderRow
            label="TopP (0.00-1.00)"
            value={draft.topP}
            min={0}
            max={1}
            step={0.01}
            formatValue={(v) => v.toFixed(2)}
            onValueChange={(v) =>
              setDraft((prev) => ({ ...prev, topP: Math.round(v * 100) / 100 }))
            }
            theme={theme}
          />

          {/* Temperature Slider */}
          <SliderRow
            label="Temperature (0.00-2.00)"
            value={draft.temperature}
            min={0}
            max={2}
            step={0.01}
            formatValue={(v) => v.toFixed(2)}
            onValueChange={(v) =>
              setDraft((prev) => ({
                ...prev,
                temperature: Math.round(v * 100) / 100,
              }))
            }
            theme={theme}
          />

          {/* Accelerator Selection */}
          <View>
            <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
              Accelerator
            </Text>
            <Button mode="contained" compact>
              CPU
            </Button>
          </View>

          <View style={styles.speculativeToggleRow}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyMedium">Enable speculative decoding</Text>
            </View>
            <Switch
              value={enableSpeculativeDecoding}
              onValueChange={setEnableSpeculativeDecoding}
            />
          </View>

          <View style={modalRowEnd}>
            <Button
              mode="text"
              onPress={() => {
                setDraft(DEFAULT_MODEL_CONFIG);
                setAccelerator("cpu");
                setEnableSpeculativeDecoding(false);
              }}
            >
              Reset
            </Button>
            <Button mode="text" onPress={onClose}>
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={() => {
                // Validate and clamp all slider values before saving
                const validated = { ...draft };
                validated.topK = Math.min(Math.max(validated.topK, 5), 100);
                validated.topP = Math.min(Math.max(validated.topP, 0), 1);
                validated.temperature = Math.min(
                  Math.max(validated.temperature, 0),
                  2,
                );
                validated.maxTokens = Math.max(validated.maxTokens, 1);
                setDraft(validated);
                onSave({
                  ...validated,
                  backend: accelerator,
                  enableSpeculativeDecoding,
                });
              }}
            >
              Save
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

function formatDisplayDate(value: string) {
  return parseAppDate(value).toLocaleString(undefined, {
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

function formatBytes(value: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "Unknown size";
  }
  if (value < 0) return "Unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeout / 1000} seconds`);
    }
    throw error;
  }
}

async function resolveRemoteFileSize(url: string) {
  try {
    const head = await fetchWithTimeout(url, {
      method: "HEAD",
      timeout: 15000,
    });
    const headLength = head.headers.get("content-length");
    if (head.ok && headLength) {
      const parsed = parseInt(headLength, 10);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  } catch {
    // Best effort only.
  }

  return null;
}

/**
 * Validates that the URL points to a valid .litertlm model file by checking
 * the magic number in the first 8 bytes (LITERTLM).
 */
async function validateModelMagicNumber(
  url: string,
): Promise<{ valid: boolean; message?: string }> {
  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: { Range: "bytes=0-7" },
      timeout: 15000,
    });

    if (!response.ok && response.status !== 206) {
      // Can't validate (e.g. no partial content support), allow download to proceed
      return { valid: true };
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength < 8) {
      return {
        valid: false,
        message:
          "The file is too small to be a valid model. Please check the URL.",
      };
    }

    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < 8; i++) {
      if (bytes[i] !== LITERTLM_MAGIC[i]) {
        return {
          valid: false,
          message:
            "The URL does not point to a valid .litertlm model file. This may indicate a blob URL or an incorrect link.",
        };
      }
    }

    return { valid: true };
  } catch {
    // If we can't validate, allow download to proceed and let it fail naturally
    return { valid: true };
  }
}

const DOWNLOAD_TASK_ID = "model-download";

export default function SettingsScreen() {
  const [isExporting, setIsExporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    value: number;
    label: string;
  } | null>(null);
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
        m3Alert.alert("Import failed", "Selected file does not exist.");
        return;
      }
      const json = await file.text();
      setImportProgress({ value: 0, label: "Reading file…" });
      const summary = await importUserData(json, (value, label) =>
        setImportProgress({ value, label }),
      );
      // Invalidate all caches so graphs/goals reflect imported data immediately
      invalidateMealCaches();
      invalidateWeightCaches();
      invalidateBodyFatCaches();
      // Refresh latest weight & body fat from DB after import
      getLatestWeight().then((point) =>
        setLatestWeight(point?.weightKg ?? null),
      );
      getLatestBodyFat().then((point) =>
        setLatestBodyFat(point?.bodyFatPercentage ?? null),
      );
      const importedTotal =
        summary.meals.imported +
        summary.weightHistory.imported +
        summary.bodyFatHistory.imported +
        summary.recipes.imported;
      const failedTotal =
        summary.meals.failed +
        summary.weightHistory.failed +
        summary.bodyFatHistory.failed +
        summary.recipes.failed;
      const detail =
        failedTotal > 0
          ? `Imported ${importedTotal} item(s). Skipped ${failedTotal} invalid item(s).`
          : `Imported ${importedTotal} item(s).`;
      m3Alert.alert("Import successful", detail);
    } catch (error) {
      m3Alert.alert(
        "Import failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setImportProgress(null);
    }
  };
  // Export data as JSON and share
  const handleExportData = async () => {
    try {
      setIsExporting(true);
      const json = await exportUserData();
      const now = new Date();
      const timestamp = toLocalISOString(now)
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
      m3Alert.alert(
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
  const [memoryUsageDetails, setMemoryUsageDetails] = useState<{
    residentBytes: number;
    nativeHeapBytes: number;
    availableMemoryBytes: number;
  } | null>(null);
  const m3Alert = useM3Alert();
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [snackbarMessage, setSnackbarMessage] = useState("");
  const [showSnackbar, setShowSnackbar] = useState(false);
  const [showSnackbarViewAction, setShowSnackbarViewAction] = useState(false);

  // Poll memory usage when a model is loaded
  useEffect(() => {
    if (!loadedModelKey) {
      setMemoryUsageBytes(null);
      setMemoryUsageDetails(null);
      return;
    }

    const updateMemoryUsage = () => {
      const bytes = getModelMemoryUsageBytes();
      setMemoryUsageBytes(bytes);
      const details = getModelMemoryUsageDetails();
      setMemoryUsageDetails(details);
    };

    updateMemoryUsage();
    const interval = setInterval(updateMemoryUsage, 5000);
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
  const [deviceArchitecture, setDeviceArchitecture] =
    useState<DeviceArchitecture | null>(null);

  const [isSyncingWeight, setIsSyncingWeight] = useState(false);

  const [selectedModelKey, setSelectedModelKey] = useState<
    "GEMMA_4_E2B_IT" | "GEMMA_4_E4B_IT" | "custom"
  >("GEMMA_4_E2B_IT");
  const [notificationPermissionStatus, setNotificationPermissionStatus] =
    useState<NotificationPermissionStatus>("unknown");
  const [
    isRequestingNotificationPermission,
    setIsRequestingNotificationPermission,
  ] = useState(false);
  const [customModelUrl, setCustomModelUrl] = useState("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCancellingDownload, setIsCancellingDownload] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadedBytes, setDownloadedBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState<number | null>(null);
  const [downloadSpeed, setDownloadSpeed] = useState<number | null>(null);
  const [activeDownloadLabel, setActiveDownloadLabel] = useState<string | null>(
    null,
  );
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadedModels, setDownloadedModels] = useState<DownloadedModel[]>(
    [],
  );
  const downloadTaskRef = useRef<ReturnType<typeof createDownloadTask> | null>(
    null,
  );
  const downloadCancelRequestedRef = useRef(false);
  const downloadResolveRef = useRef<(() => void) | null>(null);
  const lastFocusRefreshAtRef = useRef(0);

  const [activeModelConfigUri, setActiveModelConfigUri] = useState<
    string | null
  >(null);
  const [activeModelTab, setActiveModelTab] = useState<"download" | "offline">(
    "offline",
  );

  // Clear download error when switching from custom URL to built-in models
  useEffect(() => {
    if (selectedModelKey !== "custom") {
      setDownloadError(null);
    }
  }, [selectedModelKey]);

  // Detect device architecture on mount
  useEffect(() => {
    setDeviceArchitecture(detectArchitecture());
  }, []);

  const getNotificationPermissionStatus = useCallback(async () => {
    if (Platform.OS !== "android") return "not-required" as const;
    const apiLevel =
      typeof Platform.Version === "number"
        ? Platform.Version
        : Number.parseInt(String(Platform.Version), 10);
    if (!Number.isFinite(apiLevel) || apiLevel < 33) {
      return "not-required" as const;
    }
    const granted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return granted ? ("granted" as const) : ("denied" as const);
  }, []);

  const refreshNotificationPermissionStatus = useCallback(async () => {
    const next = await getNotificationPermissionStatus();
    setNotificationPermissionStatus(next);
    return next;
  }, [getNotificationPermissionStatus]);

  const requestNotificationPermission = useCallback(async () => {
    if (Platform.OS !== "android") {
      setNotificationPermissionStatus("not-required");
      return true;
    }

    const currentStatus = await refreshNotificationPermissionStatus();
    if (currentStatus === "not-required" || currentStatus === "granted") {
      return true;
    }

    setIsRequestingNotificationPermission(true);
    try {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        {
          title: "Allow notifications?",
          message:
            "Notifications are used to show background model download progress and completion.",
          buttonPositive: "Allow",
          buttonNegative: "Not now",
        },
      );

      const granted = result === PermissionsAndroid.RESULTS.GRANTED;
      setNotificationPermissionStatus(granted ? "granted" : "denied");

      if (!granted && result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        m3Alert.alert(
          "Notification permission blocked",
          "Enable notifications in system settings to see background download progress and completion.",
          [
            { text: "Later", style: "cancel" },
            {
              text: "Open settings",
              onPress: () => {
                void Linking.openSettings();
              },
            },
          ],
        );
      }

      return granted;
    } catch (error) {
      m3Alert.alert(
        "Permission request failed",
        `Could not request notification permission. ${getErrorMessage(error)}`,
      );
      return false;
    } finally {
      setIsRequestingNotificationPermission(false);
    }
  }, [m3Alert, refreshNotificationPermissionStatus]);

  useEffect(() => {
    refreshNotificationPermissionStatus().catch(() => {
      setNotificationPermissionStatus("unknown");
    });
  }, [refreshNotificationPermissionStatus]);

  // Re-attach to downloads that continued while app was backgrounded/killed
  useEffect(() => {
    let cancelled = false;
    getExistingDownloadTasks().then((tasks) => {
      if (cancelled) return;
      const task = tasks.find((t) => t.id === DOWNLOAD_TASK_ID);
      if (!task) return;

      const label = (task.metadata as { label?: string })?.label ?? "Model";
      setIsDownloading(true);
      setActiveDownloadLabel(label);
      downloadTaskRef.current = task;

      task
        .progress(({ bytesDownloaded, bytesTotal }) => {
          setDownloadedBytes(bytesDownloaded);
          if (bytesTotal > 0) {
            setTotalBytes(bytesTotal);
            setDownloadProgress(bytesDownloaded / bytesTotal);
          }
        })
        .done(({ bytesDownloaded }) => {
          completeDownloadHandler(DOWNLOAD_TASK_ID);
          setDownloadedBytes(bytesDownloaded);
          setDownloadProgress(1);
          setIsDownloading(false);
          setActiveDownloadLabel(null);
          downloadTaskRef.current = null;
          refreshDownloadedModels().catch(() => {});
          setSnackbarMessage(`${label} downloaded and selected`);
          setShowSnackbarViewAction(true);
          setShowSnackbar(true);
        })
        .error(() => {
          setIsDownloading(false);
          setActiveDownloadLabel(null);
          downloadTaskRef.current = null;
        });
    });
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    const modelWasLoaded = !!require("@/lib/modelCache").getModelInstance();
    clearModelCache();
    if (Platform.OS === "android") {
      if (modelWasLoaded) {
        ToastAndroid.show(
          "Model unloaded. It will reload with new settings next time.",
          ToastAndroid.LONG,
        );
      } else {
        ToastAndroid.show(
          "Settings saved. Model will use new settings next time it loads.",
          ToastAndroid.SHORT,
        );
      }
    }
    // For iOS or cross-platform, you could use a Snackbar or similar if desired
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
        m3Alert.alert("Storage error", "Saved data could not be loaded."),
      )
      .finally(() => setIsReady(true));
  }, [loadStoredData, refreshDownloadedModels]);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      if (now - lastFocusRefreshAtRef.current < FOCUS_REFRESH_INTERVAL_MS) {
        return undefined;
      }
      lastFocusRefreshAtRef.current = now;

      loadStoredData().catch(() => {
        m3Alert.alert("Storage error", "Saved data could not be loaded.");
      });
      refreshDownloadedModels().catch(() => {
        m3Alert.alert(
          "File error",
          "Downloaded model list could not be refreshed.",
        );
      });
      refreshNotificationPermissionStatus().catch(() => {
        setNotificationPermissionStatus("unknown");
      });
    }, [
      loadStoredData,
      refreshDownloadedModels,
      refreshNotificationPermissionStatus,
    ]),
  );

  // Initialize Health Connect status once on mount
  useEffect(() => {
    const initHealthConnect = async () => {
      if (!healthConnect) {
        setHealthStatus("unavailable");
        return;
      }

      try {
        const status = await healthConnect.getSdkStatus();
        if (status === healthConnect.SdkAvailabilityStatus.SDK_AVAILABLE) {
          setHealthStatus("available");
        } else if (
          status ===
          healthConnect.SdkAvailabilityStatus
            .SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
        ) {
          setHealthStatus("update-required");
        } else {
          setHealthStatus("unavailable");
        }
      } catch {
        setHealthStatus("error");
      }
    };

    void initHealthConnect();
  }, []);

  // Debounce storage writes: batch rapid data changes
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isReady) return;

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Schedule save for 500ms after last change
    saveTimeoutRef.current = setTimeout(() => {
      saveStoredData(data).catch(() =>
        m3Alert.alert("Storage error", "Changes could not be saved."),
      );
      saveTimeoutRef.current = null;
    }, 500);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [data, isReady]);

  const syncWeight = async () => {
    if (!healthConnect) {
      m3Alert.alert(
        "Unavailable",
        "Health Connect requires an Android development build.",
      );
      return;
    }
    setIsSyncingWeight(true);
    setHealthStatus("syncing");
    try {
      await syncHealthConnectData({
        onPermissionDenied: () => {
          setHealthStatus("error");
          m3Alert.alert(
            "Body Data Permission Needed",
            "This app needs Health Connect permission to read Weight and Body Fat data. In Health Connect, enable Weight and Body Fat under app permissions, then tap Sync body data again.",
          );
        },
        onError: (reason) => {
          setHealthStatus("error");
          m3Alert.alert("Sync Failed", `Could not sync body data. ${reason}`);
        },
        onSuccess: () => {
          setData((prev) => ({
            ...prev,
            lastWeightSyncAt: toLocalISOString(new Date()),
            lastBodyFatSyncAt: toLocalISOString(new Date()),
          }));
          setHealthStatus("available");
        },
      });
    } finally {
      setIsSyncingWeight(false);
    }
  };

  const openHealthSettings = () => {
    if (!healthConnect) {
      m3Alert.alert(
        "Unavailable",
        "Health Connect requires an Android development build.",
      );
      return;
    }
    if (typeof healthConnect.openHealthConnectSettings !== "function") {
      m3Alert.alert(
        "Unavailable",
        "Health Connect settings cannot be opened on this device.",
      );
      return;
    }

    try {
      healthConnect.openHealthConnectSettings();
    } catch (error) {
      m3Alert.alert("Could not open settings", getErrorMessage(error));
    }
  };

  const onPressSyncWeight = () => {
    if (healthStatus === "unavailable" || healthStatus === "update-required") {
      m3Alert.alert(
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
      return { label: tail.split(".")[0], url: trimmed, fileName: tail };
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

  const isSelectedModelDownloaded = useMemo(() => {
    if (selectedModelKey === "custom") {
      // For custom models, check if any downloaded model matches the URL
      const trimmed = customModelUrl.trim();
      if (!trimmed) return false;
      return downloadedModels.some((m) => {
        // Check by filename (last segment of URL)
        const urlFileName = trimmed.split("/").pop();
        return m.name === urlFileName || m.name === trimmed.split("/").pop();
      });
    }

    // For built-in models, check by filename
    const builtIn = BUILT_IN_MODELS.find((m) => m.key === selectedModelKey);
    if (!builtIn) return false;
    return downloadedModels.some((m) => m.name === builtIn.fileName);
  }, [selectedModelKey, customModelUrl, downloadedModels]);

  const handleDownloadModel = async () => {
    if (isDownloading) return;
    setDownloadError(null);

    const source = resolveDownloadSource();
    if (!source) {
      setDownloadError("Select a model or enter a valid custom URL first.");
      return;
    }

    // Validate magic number for custom URLs to detect blob URLs and invalid links
    if (selectedModelKey === "custom") {
      const magicValidation = await validateModelMagicNumber(source.url);
      if (!magicValidation.valid) {
        setDownloadError(magicValidation.message!);
        return;
      }
    }

    try {
      downloadCancelRequestedRef.current = false;
      setIsDownloading(true);
      setIsCancellingDownload(false);
      setDownloadProgress(0);
      setDownloadedBytes(0);
      setTotalBytes(null);
      setDownloadSpeed(null);
      setActiveDownloadLabel(source.label);

      let shouldShowDownloadNotifications = true;
      const notificationStatus = await refreshNotificationPermissionStatus();
      if (notificationStatus === "denied") {
        const granted = await requestNotificationPermission();
        shouldShowDownloadNotifications = granted;
        if (!granted) {
          setSnackbarMessage(
            "Download started without notifications. You can enable this in Settings.",
          );
          setShowSnackbarViewAction(false);
          setShowSnackbar(true);
        }
      }

      // Configure the library's built-in notification with the model name
      setDownloadConfig({
        showNotificationsEnabled: shouldShowDownloadNotifications,
        notificationsGrouping: {
          enabled: false,
          texts: {
            downloadTitle: source.label,
            downloadStarting: "Starting download…",
            downloadProgress: "Downloading… {progress}%",
            downloadFinished: "Download complete",
          },
        },
      });

      if (!MODEL_DIRECTORY.exists) {
        MODEL_DIRECTORY.create({ intermediates: true, idempotent: true });
      }

      const destFile = new File(MODEL_DIRECTORY, source.fileName);
      if (destFile.exists) destFile.delete();
      let knownTotalBytes: number | null = null;
      let wasCancelled = false;

      // Try to get file size with a short timeout first
      knownTotalBytes = await resolveRemoteFileSize(source.url);
      if (knownTotalBytes && knownTotalBytes > 0) {
        setTotalBytes(knownTotalBytes);
      }

      // Destination path without file:// prefix (required by background downloader)
      const destPath = destFile.uri.replace(/^file:\/\//, "");

      // Use native background downloader — continues even when app is backgrounded/killed
      await new Promise<void>((resolve, reject) => {
        downloadResolveRef.current = resolve;
        let lastBytes = 0;
        let lastTime = Date.now();

        const task = createDownloadTask({
          id: DOWNLOAD_TASK_ID,
          url: source.url,
          destination: destPath,
          metadata: { label: source.label },
        })
          .begin(({ expectedBytes }) => {
            if (expectedBytes && expectedBytes > 0) {
              knownTotalBytes = expectedBytes;
              setTotalBytes(expectedBytes);
            }
          })
          .progress(({ bytesDownloaded, bytesTotal }) => {
            const currentBytes = bytesDownloaded;
            const now = Date.now();
            const elapsed = (now - lastTime) / 1000;
            if (elapsed > 0) {
              setDownloadSpeed((currentBytes - lastBytes) / elapsed);
            }
            lastBytes = currentBytes;
            lastTime = now;
            setDownloadedBytes(currentBytes);

            const total =
              bytesTotal > 0 ? bytesTotal : (knownTotalBytes ?? null);
            if (total && total > 0) {
              knownTotalBytes = total;
              setTotalBytes(total);
              setDownloadProgress(currentBytes / total);
            }
          })
          .done(() => {
            downloadResolveRef.current = null;
            completeDownloadHandler(DOWNLOAD_TASK_ID);
            resolve();
          })
          .error(({ error }) => {
            downloadResolveRef.current = null;
            if (downloadCancelRequestedRef.current) {
              resolve(); // intentional cancel — not an error
            } else {
              reject(new Error(error));
            }
          });

        downloadTaskRef.current = task;
        task.start();
      });

      if (downloadCancelRequestedRef.current) {
        wasCancelled = true;
      }

      if (wasCancelled) {
        if (destFile.exists) {
          destFile.delete();
        }
        setSnackbarMessage("Model download cancelled");
        setShowSnackbarViewAction(false);
        setShowSnackbar(true);
        return;
      }

      if (destFile.exists) {
        const finalBytes = destFile.size;
        setDownloadedBytes(finalBytes);
        setTotalBytes(finalBytes > 0 ? finalBytes : (knownTotalBytes ?? null));
        setDownloadProgress(1);
      }

      setData((prev) => ({ ...prev, modelPath: destFile.uri }));
      await refreshDownloadedModels();
      setSnackbarMessage(`${source.label} downloaded and selected`);
      setShowSnackbarViewAction(true);
      setShowSnackbar(true);
    } catch (error) {
      if (downloadCancelRequestedRef.current) {
        const partialFile = new File(MODEL_DIRECTORY, source.fileName);
        if (partialFile.exists) partialFile.delete();
        setSnackbarMessage("Model download cancelled");
        setShowSnackbarViewAction(false);
        setShowSnackbar(true);
      } else {
        setDownloadError(`Download failed: ${getErrorMessage(error)}`);
      }
    } finally {
      downloadTaskRef.current = null;
      downloadCancelRequestedRef.current = false;
      setIsDownloading(false);
      setIsCancellingDownload(false);
      setActiveDownloadLabel(null);
    }
  };

  const handleCancelDownload = async () => {
    if (!downloadTaskRef.current || !isDownloading) return;
    try {
      downloadCancelRequestedRef.current = true;
      setIsCancellingDownload(true);
      await downloadTaskRef.current.stop();
      // stop() may not trigger .error() callback — resolve manually if needed
      if (downloadResolveRef.current) {
        const resolve = downloadResolveRef.current;
        downloadResolveRef.current = null;
        resolve();
      }
    } catch (error) {
      setDownloadError(`Cancel failed: ${getErrorMessage(error)}`);
      setIsCancellingDownload(false);
      downloadCancelRequestedRef.current = false;
    }
  };

  const setActiveModel = (uri: string) => {
    if (data.modelPath !== uri) clearModelCache();
    setData((prev) => ({ ...prev, modelPath: uri }));
  };

  const handleDeleteModel = (model: DownloadedModel) => {
    m3Alert.alert("Delete model?", `Remove ${model.name} from local storage?`, [
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
              m3Alert.alert("Delete failed", getErrorMessage(error));
            }
          })();
        },
      },
    ]);
  };

  const refreshLatestMetrics = useCallback(async () => {
    const weight = await getLatestWeight();
    setLatestWeight(weight?.weightKg ?? data.manualWeightKg);
    const bodyFat = await getLatestBodyFat();
    setLatestBodyFat(bodyFat?.bodyFatPercentage ?? null);
  }, [data.manualWeightKg]);

  const [latestWeight, setLatestWeight] = useState<number | null>(null);
  const [latestBodyFat, setLatestBodyFat] = useState<number | null>(null);

  // Fetch latest metrics on mount and when auto-sync completes
  useEffect(() => {
    refreshLatestMetrics().catch(console.error);
  }, [refreshLatestMetrics, data.lastWeightSyncAt, data.lastBodyFatSyncAt]);

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

  const isArchitectureBlocked = useMemo(() => {
    return (
      deviceArchitecture !== null && !isLiteRTSupported(deviceArchitecture)
    );
  }, [deviceArchitecture]);

  const architectureBlockedReason = useMemo(() => {
    if (!isArchitectureBlocked || !deviceArchitecture) return null;
    return getLiteRTUnsupportedReason(deviceArchitecture);
  }, [isArchitectureBlocked, deviceArchitecture]);

  const segmentedButtonsTheme = useMemo(
    () => getAppSegmentedButtonsTheme(theme),
    [
      theme.colors.onPrimaryContainer,
      theme.colors.outlineVariant,
      theme.colors.primaryContainer,
    ],
  );

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
              style={[
                styles.segmentedControl,
                { backgroundColor: theme.colors.elevation.level2 },
              ]}
              theme={segmentedButtonsTheme}
              value={mode}
              onValueChange={(value) => setMode(value as ThemeMode)}
              buttons={[
                {
                  value: "system",
                  label: "System",
                  icon: "theme-light-dark",
                },
                {
                  value: "light",
                  label: "Light",
                  icon: "weather-sunny",
                },
                {
                  value: "dark",
                  label: "Dark",
                  icon: "weather-night",
                },
              ]}
            />
          </Card.Content>
        </Card>

        <Card style={styles.card} mode="elevated">
          <Card.Title
            title="Health Connect"
            titleVariant="titleLarge"
            rightStyle={{ paddingRight: 8 }}
            right={() => (
              <Chip
                mode="outlined"
                icon={
                  healthStatus === "available"
                    ? "check-circle"
                    : healthStatus === "syncing"
                      ? "sync"
                      : "alert-circle-outline"
                }
                compact
              >
                {healthStatus === "available"
                  ? "Connected"
                  : healthStatus === "idle"
                    ? "Ready"
                    : healthStatus === "syncing"
                      ? "Syncing"
                      : healthStatus === "update-required"
                        ? "Update needed"
                        : healthStatus === "error"
                          ? "Error"
                          : "Offline"}
              </Chip>
            )}
          />
          <Card.Content style={[styles.formArea, { marginTop: -15 }]}>
            <View
              style={[
                styles.healthConnectStats,
                { backgroundColor: theme.colors.elevation.level1 },
              ]}
            >
              <View style={styles.healthStat}>
                <MaterialCommunityIcons
                  name="scale-bathroom"
                  size={28}
                  color={theme.colors.primary}
                />
                <Text variant="titleMedium">
                  {latestWeight ? `${latestWeight} kg` : "—"}
                </Text>
              </View>
              <View
                style={[
                  styles.healthStatDivider,
                  { backgroundColor: theme.colors.outlineVariant },
                ]}
              />
              <View style={styles.healthStat}>
                <MaterialCommunityIcons
                  name="percent"
                  size={28}
                  color={theme.colors.primary}
                />
                <Text variant="titleMedium">
                  {latestBodyFat !== null ? `${latestBodyFat}%` : "—"}
                </Text>
              </View>
              <View
                style={[
                  styles.healthStatDivider,
                  { backgroundColor: theme.colors.outlineVariant },
                ]}
              />
              <View style={styles.healthStat}>
                <MaterialCommunityIcons
                  name="clock-outline"
                  size={28}
                  color={theme.colors.onSurfaceVariant}
                />
                <Text variant="titleMedium">
                  {data.lastWeightSyncAt
                    ? (() => {
                        const syncDate = new Date(data.lastWeightSyncAt!);
                        const today = new Date();
                        const yesterday = new Date(today);
                        yesterday.setDate(yesterday.getDate() - 1);
                        if (
                          syncDate.getDate() === today.getDate() &&
                          syncDate.getMonth() === today.getMonth() &&
                          syncDate.getFullYear() === today.getFullYear()
                        ) {
                          return "Today";
                        }
                        if (
                          syncDate.getDate() === yesterday.getDate() &&
                          syncDate.getMonth() === yesterday.getMonth() &&
                          syncDate.getFullYear() === yesterday.getFullYear()
                        ) {
                          return "Yesterday";
                        }
                        return syncDate.toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        });
                      })()
                    : "Never"}
                </Text>
              </View>
            </View>
            <View style={styles.buttonRow}>
              <Button
                style={styles.button}
                mode="contained"
                icon="sync"
                loading={isSyncingWeight}
                disabled={isSyncingWeight}
                onPress={onPressSyncWeight}
              >
                {isSyncingWeight ? "Syncing..." : "Sync"}
              </Button>
              <Button mode="outlined" icon="cog" onPress={openHealthSettings}>
                Settings
              </Button>
            </View>
            <View style={styles.autoSyncRow}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium">Auto-sync</Text>
                <Text
                  variant="labelSmall"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  Automatically sync weight data every hour
                </Text>
              </View>
              <Switch
                value={data.healthConnectAutoSync}
                onValueChange={(value) =>
                  setData((prev) => ({
                    ...prev,
                    healthConnectAutoSync: value,
                  }))
                }
              />
            </View>
          </Card.Content>
        </Card>

        <Card style={styles.card} mode="elevated">
          <Card.Title
            title="LiteRT Models"
            titleVariant="titleLarge"
            right={() =>
              loadedModelKey ? (
                <IconButton
                  icon="chart-donut"
                  accessibilityLabel="Show memory usage"
                  onPress={() => setShowMemoryModal(true)}
                />
              ) : null
            }
          />
          <Card.Content style={[styles.formArea, { marginTop: -18 }]}>
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              Active model: {selectedModelDescription}
            </Text>
            {isArchitectureBlocked && deviceArchitecture ? (
              <View
                style={[
                  styles.memoryAlertBox,
                  { backgroundColor: theme.colors.errorContainer },
                ]}
              >
                <MaterialCommunityIcons
                  name={
                    deviceArchitecture === "x86_64"
                      ? "cpu-64-bit"
                      : "cpu-32-bit"
                  }
                  size={20}
                  color={theme.colors.error}
                />
                <Text
                  variant="labelSmall"
                  style={{ color: theme.colors.onErrorContainer, flex: 1 }}
                >
                  {`Detected ${getArchitectureLabel(deviceArchitecture)}. ${architectureBlockedReason ?? "LiteRT models are unavailable on this architecture."}`}
                </Text>
              </View>
            ) : null}

            {/* Tab navigation for Offline / Download Models */}
            <SegmentedButtons
              style={[
                styles.segmentedControl,
                { backgroundColor: theme.colors.elevation.level2 },
              ]}
              theme={segmentedButtonsTheme}
              value={activeModelTab}
              onValueChange={(value) =>
                setActiveModelTab(value as "download" | "offline")
              }
              buttons={[
                {
                  value: "offline",
                  label:
                    downloadedModels.length > 0
                      ? `Offline (${downloadedModels.length})`
                      : "Offline",
                  icon: "package-down",
                },
                {
                  value: "download",
                  label: "Download",
                  icon: "download",
                },
              ]}
            />

            {isDownloading ? (
              <View
                style={[
                  styles.downloadStatusBar,
                  {
                    backgroundColor: theme.colors.elevation.level2,
                    borderColor: theme.colors.outlineVariant,
                  },
                ]}
              >
                <View style={styles.downloadStatusHeader}>
                  <View style={flex1Style}>
                    <Text variant="labelLarge" style={{ fontWeight: "700" }}>
                      Downloading {activeDownloadLabel ?? "model"}
                    </Text>
                    <Text
                      variant="labelSmall"
                      style={{ color: theme.colors.onSurfaceVariant }}
                    >
                      {totalBytes
                        ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)} (${Math.round(downloadProgress * 100)}%)`
                        : formatBytes(downloadedBytes)}
                      {downloadSpeed !== null
                        ? ` • ${formatBytes(Math.round(downloadSpeed))}/s`
                        : ""}
                    </Text>
                  </View>
                  <Button
                    mode="text"
                    icon="close"
                    compact
                    loading={isCancellingDownload}
                    disabled={isCancellingDownload}
                    onPress={handleCancelDownload}
                    textColor={theme.colors.error}
                  >
                    {isCancellingDownload ? "Cancelling..." : "Cancel"}
                  </Button>
                </View>
                <ProgressBar
                  progress={totalBytes ? downloadProgress : undefined}
                  indeterminate={!totalBytes}
                  style={styles.progressBar}
                />
              </View>
            ) : null}

            {/* Download Tab Content */}
            {activeModelTab === "download" && (
              <>
                <View
                  style={[
                    styles.notificationPermissionRow,
                    {
                      borderColor: theme.colors.outlineVariant,
                      backgroundColor: theme.colors.elevation.level1,
                    },
                  ]}
                >
                  <View style={flex1Style}>
                    <Text variant="bodyMedium">Download notifications</Text>
                    <Text
                      variant="labelSmall"
                      style={{
                        color: theme.colors.onSurfaceVariant,
                        fontSize: 8,
                        lineHeight: 12,
                      }}
                    >
                      Needed for background download progress and completion.
                    </Text>
                  </View>
                  <Button
                    mode={
                      notificationPermissionStatus === "granted"
                        ? "contained-tonal"
                        : "outlined"
                    }
                    compact
                    icon={
                      notificationPermissionStatus === "granted"
                        ? "check"
                        : "bell-ring-outline"
                    }
                    onPress={() => {
                      if (notificationPermissionStatus !== "granted") {
                        void requestNotificationPermission();
                      }
                    }}
                    loading={isRequestingNotificationPermission}
                    disabled={
                      isRequestingNotificationPermission ||
                      notificationPermissionStatus === "not-required" ||
                      notificationPermissionStatus === "granted"
                    }
                  >
                    {notificationPermissionStatus === "granted"
                      ? "Granted"
                      : notificationPermissionStatus === "not-required"
                        ? "Not needed"
                        : isRequestingNotificationPermission
                          ? "Requesting..."
                          : "Grant"}
                  </Button>
                </View>

                <View style={styles.modelSelector}>
                  {BUILT_IN_MODELS.map((model) => {
                    const memoryCheck = checkModelMemory(model.key);
                    const isBlocked =
                      isArchitectureBlocked || memoryCheck.status === "blocked";
                    const isWarning = memoryCheck.status === "warning";
                    const memoryGB =
                      memoryCheck.modelMemoryBytes / (1024 * 1024 * 1024);
                    const memoryLabel = `${memoryGB} GB`;
                    return (
                      <View key={model.key}>
                        <View
                          style={[isBlocked && styles.modelBlockedContainer]}
                        >
                          <Button
                            mode={
                              selectedModelKey === model.key
                                ? "contained"
                                : "outlined"
                            }
                            onPress={() => {
                              if (!isBlocked) setSelectedModelKey(model.key);
                            }}
                            disabled={isBlocked}
                            icon={
                              isBlocked
                                ? "lock"
                                : isWarning
                                  ? "alert"
                                  : undefined
                            }
                            style={
                              isBlocked
                                ? [
                                    styles.modelBlockedButton,
                                    {
                                      backgroundColor:
                                        theme.colors.surfaceVariant,
                                    },
                                  ]
                                : undefined
                            }
                            textColor={
                              isBlocked
                                ? theme.colors.onSurfaceVariant
                                : undefined
                            }
                          >
                            {model.label} ({model.sizeLabel})
                          </Button>
                          {model.recommended && !isBlocked && (
                            <View
                              style={[
                                styles.recommendedTag,
                                {
                                  backgroundColor:
                                    theme.colors.primaryContainer,
                                },
                              ]}
                            >
                              <Text
                                variant="labelSmall"
                                style={{
                                  color: theme.colors.onPrimaryContainer,
                                  fontWeight: "700",
                                }}
                              >
                                Recommended for most devices
                              </Text>
                            </View>
                          )}
                          {(isBlocked || isWarning) && (
                            <View
                              style={[
                                styles.memoryWarningBadge,
                                {
                                  backgroundColor: isBlocked
                                    ? theme.colors.errorContainer
                                    : theme.colors.tertiaryContainer,
                                  paddingHorizontal: 6,
                                  paddingVertical: 2,
                                  borderRadius: 6,
                                },
                              ]}
                            >
                              <MaterialCommunityIcons
                                name={
                                  isBlocked ? "alert-circle-outline" : "alert"
                                }
                                size={12}
                                color={
                                  isBlocked
                                    ? theme.colors.error
                                    : theme.colors.tertiary
                                }
                              />
                              <Text
                                variant="labelSmall"
                                style={{
                                  fontSize: 10,
                                  fontWeight: "700",
                                  color: isBlocked
                                    ? theme.colors.error
                                    : theme.colors.tertiary,
                                  textShadowRadius: 1,
                                }}
                              >
                                {isArchitectureBlocked
                                  ? "Blocked"
                                  : isBlocked
                                    ? "Low RAM"
                                    : "Warning"}
                              </Text>
                            </View>
                          )}
                          {isBlocked && !isArchitectureBlocked && (
                            <Text
                              variant="labelSmall"
                              style={[
                                styles.memoryWarningSubtext,
                                {
                                  color: theme.colors.error,
                                  fontWeight: "700",
                                  textShadowColor: "rgba(255, 82, 82, 0.4)",
                                  textShadowOffset: { width: 0, height: 0 },
                                  textShadowRadius: 4,
                                },
                              ]}
                            >
                              Requires {memoryLabel} ({memoryCheck.usagePercent}
                              % of RAM)
                            </Text>
                          )}
                          {isArchitectureBlocked && (
                            <View
                              style={[
                                styles.recommendedTag,
                                {
                                  backgroundColor: theme.colors.errorContainer,
                                },
                              ]}
                            >
                              <Text
                                variant="labelSmall"
                                style={[
                                  styles.memoryWarningSubtext,
                                  {
                                    color: theme.colors.error,
                                    fontWeight: "700",
                                  },
                                ]}
                              >
                                Architecture not supported
                              </Text>
                            </View>
                          )}
                          {isWarning && !isBlocked && (
                            <Text
                              variant="labelSmall"
                              style={[
                                styles.memoryWarningSubtext,
                                {
                                  color: theme.colors.tertiary,
                                  fontWeight: "700",
                                },
                              ]}
                            >
                              Uses {memoryCheck.usagePercent}% of RAM
                            </Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                  <Button
                    mode={
                      selectedModelKey === "custom" ? "contained" : "outlined"
                    }
                    onPress={() => {
                      if (!isArchitectureBlocked) setSelectedModelKey("custom");
                    }}
                    disabled={isArchitectureBlocked}
                    icon={isArchitectureBlocked ? "lock" : undefined}
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
                  icon={isSelectedModelDownloaded ? "check" : "download"}
                  loading={isDownloading}
                  onPress={handleDownloadModel}
                  disabled={
                    isDownloading ||
                    isArchitectureBlocked ||
                    (selectedModelKey === "custom" && !customModelUrl.trim()) ||
                    isSelectedModelDownloaded ||
                    (selectedModelKey !== "custom" &&
                      checkModelMemory(selectedModelKey).status === "blocked")
                  }
                >
                  {isSelectedModelDownloaded
                    ? "Already downloaded"
                    : isDownloading
                      ? "Downloading..."
                      : "Download selected model"}
                </Button>
                {selectedModelKey !== "custom" &&
                  (() => {
                    const check = checkModelMemory(selectedModelKey);
                    if (check.status === "warning") {
                      return (
                        <View
                          style={[
                            styles.memoryAlertBox,
                            { backgroundColor: theme.colors.tertiaryContainer },
                          ]}
                        >
                          <MaterialCommunityIcons
                            name="alert"
                            size={20}
                            color={theme.colors.tertiary}
                          />
                          <Text
                            variant="labelSmall"
                            style={{ color: theme.colors.tertiary, flex: 1 }}
                          >
                            This model uses {check.usagePercent}% of available
                            RAM. Monitor device performance.
                          </Text>
                        </View>
                      );
                    }
                    return null;
                  })()}

                {downloadError ? (
                  <Text
                    variant="bodyMedium"
                    style={{ color: theme.colors.error }}
                  >
                    {downloadError}
                  </Text>
                ) : null}
              </>
            )}

            {/* Offline Models Tab Content */}
            {activeModelTab === "offline" && (
              <View
                style={[
                  styles.downloadedModelsContainer,
                  {
                    backgroundColor: theme.colors.elevation.level1,
                  },
                ]}
              >
                {downloadedModels.length ? (
                  <View style={styles.downloadedList}>
                    {downloadedModels.map((model) => {
                      const isActive = data.modelPath === model.uri;
                      const inMemory = isInMemory(model.uri);
                      const savedConfig = data.perModelConfig?.[model.uri];
                      const hasCustomConfig =
                        !!savedConfig &&
                        !isModelConfigEqual(savedConfig, DEFAULT_MODEL_CONFIG);

                      // Determine model key from filename
                      const modelKey = model.name.includes("gemma-4-E2B")
                        ? "GEMMA_4_E2B_IT"
                        : model.name.includes("gemma-4-E4B")
                          ? "GEMMA_4_E4B_IT"
                          : null;
                      const memoryCheck = modelKey
                        ? checkModelMemory(modelKey)
                        : null;
                      const isBlocked =
                        isArchitectureBlocked ||
                        memoryCheck?.status === "blocked";
                      const isWarning = memoryCheck?.status === "warning";

                      return (
                        <View
                          key={model.uri}
                          style={[
                            styles.downloadedItem,
                            {
                              borderColor: isActive
                                ? theme.colors.primary
                                : isBlocked
                                  ? theme.colors.error
                                  : theme.colors.outlineVariant,
                              backgroundColor: theme.colors.elevation.level2,
                            },
                          ]}
                        >
                          <View style={styles.downloadedItemTopRow}>
                            <View style={styles.downloadedItemNameRow}>
                              <View
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  flex: 1,
                                  minWidth: 0,
                                }}
                              >
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
                                    color={theme.colors.primary}
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
                              {(isBlocked || isWarning) && (
                                <View
                                  style={[
                                    styles.memoryWarningBadge,
                                    {
                                      backgroundColor: isBlocked
                                        ? theme.colors.errorContainer
                                        : theme.colors.tertiaryContainer,
                                      position: "relative",
                                      top: 0,
                                      right: 0,
                                    },
                                  ]}
                                >
                                  <MaterialCommunityIcons
                                    name={
                                      isBlocked
                                        ? "alert-circle-outline"
                                        : "alert"
                                    }
                                    size={12}
                                    color={
                                      isBlocked
                                        ? theme.colors.error
                                        : theme.colors.tertiary
                                    }
                                  />
                                </View>
                              )}
                              <IconButton
                                icon="cog-outline"
                                size={22}
                                onPress={() =>
                                  setActiveModelConfigUri(model.uri)
                                }
                                disabled={isBlocked}
                                style={{ marginVertical: -8, marginLeft: 4 }}
                              />
                            </View>
                          </View>
                          <Text
                            variant="bodySmall"
                            style={{ color: theme.colors.onSurfaceVariant }}
                          >
                            {formatBytes(model.size)}
                          </Text>
                          {memoryCheck && (isBlocked || isWarning) && (
                            <Text
                              variant="labelSmall"
                              style={{
                                color: isBlocked
                                  ? theme.colors.error
                                  : theme.colors.tertiary,
                              }}
                            >
                              {isArchitectureBlocked
                                ? "Architecture not supported"
                                : isBlocked
                                  ? `Uses ${memoryCheck.usagePercent}% of RAM (blocked)`
                                  : `Uses ${memoryCheck.usagePercent}% of RAM`}
                            </Text>
                          )}
                          <View style={styles.downloadedItemActions}>
                            <Button
                              mode={isActive ? "contained" : "outlined"}
                              onPress={() => setActiveModel(model.uri)}
                              disabled={isBlocked}
                              icon={isBlocked ? "lock" : undefined}
                            >
                              {isActive
                                ? "In use"
                                : isBlocked
                                  ? "Blocked"
                                  : "Use"}
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
                  <View style={styles.offlineEmptyState}>
                    <MaterialCommunityIcons
                      name="package-variant"
                      size={48}
                      color={theme.colors.onSurfaceVariant}
                    />
                    <Text
                      variant="bodyMedium"
                      style={{
                        color: theme.colors.onSurfaceVariant,
                        marginTop: 8,
                      }}
                    >
                      No models downloaded yet
                    </Text>
                    <Text
                      variant="labelSmall"
                      style={{ color: theme.colors.onSurfaceVariant }}
                    >
                      Switch to Download tab to get started
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Memory Usage Modal */}
            <Modal
              visible={!!showMemoryModal}
              transparent
              animationType="fade"
              onRequestClose={() => setShowMemoryModal(false)}
            >
              <Pressable
                style={styles.modalBackdrop}
                onPress={() => setShowMemoryModal(false)}
              >
                <Pressable
                  style={[
                    styles.modalCard,
                    { backgroundColor: theme.colors.surface, minWidth: 280 },
                  ]}
                  onPress={() => {}}
                >
                  <Text
                    variant="titleMedium"
                    style={{ fontWeight: "700", marginBottom: 8 }}
                  >
                    Model Memory Usage
                  </Text>
                  {memoryUsageDetails ? (
                    <View style={{ gap: 10 }}>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <MaterialCommunityIcons
                          name="memory"
                          size={22}
                          color={theme.colors.primary}
                        />
                        <Text variant="bodyLarge">
                          RSS:{" "}
                          {(
                            memoryUsageDetails.residentBytes /
                            1024 /
                            1024
                          ).toFixed(1)}{" "}
                          MB
                        </Text>
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <MaterialCommunityIcons
                          name="chip"
                          size={22}
                          color={theme.colors.primary}
                        />
                        <Text variant="bodyLarge">
                          Native heap:{" "}
                          {(
                            memoryUsageDetails.nativeHeapBytes /
                            1024 /
                            1024
                          ).toFixed(1)}{" "}
                          MB
                        </Text>
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <MaterialCommunityIcons
                          name="database"
                          size={22}
                          color={theme.colors.primary}
                        />
                        <Text variant="bodyLarge">
                          Available:{" "}
                          {(
                            memoryUsageDetails.availableMemoryBytes /
                            1024 /
                            1024
                          ).toFixed(1)}{" "}
                          MB
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <Text variant="bodyMedium">
                      No memory usage details available.
                    </Text>
                  )}
                  <Button
                    style={{ marginTop: 0 }}
                    onPress={() => setShowMemoryModal(false)}
                  >
                    Close
                  </Button>
                </Pressable>
              </Pressable>
            </Modal>
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
              loading={importProgress !== null}
              disabled={importProgress !== null}
              style={{ marginBottom: importProgress !== null ? 6 : 10 }}
            >
              {importProgress !== null ? "Importing..." : "Import data"}
            </Button>
            {importProgress !== null ? (
              <View style={{ marginBottom: 10 }}>
                <Text
                  variant="bodySmall"
                  style={{
                    color: theme.colors.onSurfaceVariant,
                    marginBottom: 4,
                  }}
                >
                  {importProgress.label}
                </Text>
                <ProgressBar
                  progress={importProgress.value}
                  style={styles.progressBar}
                />
              </View>
            ) : null}
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant, marginBottom: 0 }}
            >
              Macro mismatch tolerance
            </Text>
            <Text
              variant="labelSmall"
              style={{ color: theme.colors.onSurfaceVariant, marginBottom: 0 }}
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
                marginTop: 0,
                marginBottom: 0,
              }}
            >
              Graph status tolerance
            </Text>
            <Text
              variant="labelSmall"
              style={{ color: theme.colors.onSurfaceVariant, marginBottom: 0 }}
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
      {m3Alert.alertDialog}
      <Snackbar
        visible={showSnackbar}
        onDismiss={() => setShowSnackbar(false)}
        duration={3000}
        action={
          showSnackbarViewAction
            ? {
                label: "View",
                onPress: () => setActiveModelTab("offline"),
              }
            : undefined
        }
      >
        {snackbarMessage}
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 16, gap: 16 },
  card: { borderRadius: 24 },
  formArea: { gap: 10, paddingBottom: 10 },
  segmentedControl: {
    borderRadius: 14,
    overflow: "hidden",
  },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: -8 },
  button: { flex: 1 },
  autoSyncRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.08)",
    marginTop: 0,
  },
  speculativeToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 4,
  },
  healthConnectStats: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    borderRadius: 16,
    padding: 12,
    marginVertical: 0,
  },
  healthStat: {
    flex: 1,
    alignItems: "center",
  },
  healthStatDivider: {
    width: 1,
    height: 40,
  },
  modelSelector: { gap: 8 },
  recommendedTag: {
    marginTop: 4,
    marginLeft: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  modelBlockedContainer: {
    opacity: 0.6,
  },
  modelBlockedButton: {
    opacity: 0.95,
  },
  memoryWarningBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 8,
    zIndex: 1,
  },
  memoryWarningSubtext: {
    marginTop: 2,
    marginLeft: 4,
  },
  memoryAlertBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: 8,
    marginTop: 8,
  },
  notificationPermissionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 8,
  },
  offlineEmptyState: {
    alignItems: "center",
    paddingVertical: 24,
  },
  downloadStatusBar: {
    gap: 8,
    marginTop: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  downloadStatusHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  progressBar: { height: 10, borderRadius: 6 },
  downloadedModelsContainer: {
    gap: 12,
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
    minWidth: 0,
    flex: 1,
  },
  downloadedItemName: {
    flexShrink: 1,
    flexGrow: 1,
    minWidth: 0,
    maxWidth: "100%",
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
    padding: 16,
    gap: 10,
    maxWidth: 320,
    width: "100%",
  },
});
