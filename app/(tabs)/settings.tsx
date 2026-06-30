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
  type ComponentProps,
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
  useColorScheme,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import LlamaIcon from "@/ui/LlamaIcon";
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
  primeStoredDataCache,
  saveStoredData,
} from "@/data/storage";
import type {
  ModelConfig,
  StoredData,
  LlamaCppAdvancedConfig,
  LlamaCppFlashAttn,
  LlamaCppReasoning,
  LlamaCppCacheType,
} from "@/data/storage";
import { DEFAULT_LLAMA_CPP_CONFIG } from "@/data/storage";
import { useThemeMode, type ThemeMode } from "@/ui/themeMode";
import { useM3Alert } from "@/ui/m3Alert";
import { getAppSegmentedButtonsTheme } from "@/ui/segmentedButtons";

import { BACKEND_LITERT, BACKEND_LLAMA_CPP } from "@/constants";
import type { InferenceBackend } from "@/constants";
import {
  FIBRE_CALORIE_APPROACH_FDA,
  FIBRE_CALORIE_APPROACH_NET,
  FIBRE_CALORIE_APPROACH_EU,
  DEFAULT_FIBRE_CALORIE_APPROACH,
  DEFAULT_CALORIE_TOLERANCE_PERCENT,
  DEFAULT_GRAPH_TOLERANCE_CALORIES,
} from "@/constants";

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

/** Keys for every built-in model across both backends. */
export type BuiltInModelKey =
  | "GEMMA_4_E2B_IT"
  | "GEMMA_4_E4B_IT"
  | "GRANITE_4_1_3B";

type ModelCatalogItem = {
  key: BuiltInModelKey;
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
 * Download URL for the Gemma 4 E2B IT model (2.41 GB).
 * Public - no HuggingFace account required.
 */
export const GEMMA_4_E2B_IT =
  "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm";

/**
 * Download URL for the Gemma 4 E4B IT model (3.41 GB).
 * Higher quality than E2B but requires more device memory.
 * Public - no HuggingFace account required.
 */
export const GEMMA_4_E4B_IT =
  "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it.litertlm";

/**
 * Download URL for the IBM Granite 4.1 3B model (Q4_0 GGUF, 1.85 GB).
 * Built-in GGUF model for the llama.cpp backend.
 * Public - no HuggingFace account required.
 */
export const GRANITE_4_1_3B =
  "https://huggingface.co/ibm-granite/granite-4.1-3b-GGUF/resolve/main/granite-4.1-3b-Q4_0.gguf";

/** Magic number for .litertlm model files: "LITERTLM" */
const LITERTLM_MAGIC = [0x4c, 0x49, 0x54, 0x45, 0x52, 0x54, 0x4c, 0x4d];

/** Magic number for GGUF model files: "GGUF" */
const GGUF_MAGIC = [0x47, 0x47, 0x55, 0x46];

/** Built-in LiteRT (.litertlm) models for the LiteRT backend. */
const BUILT_IN_MODELS: ModelCatalogItem[] = [
  {
    key: "GEMMA_4_E2B_IT",
    label: "Gemma-4-E2B-it",
    sizeLabel: "2.41 GB",
    url: GEMMA_4_E2B_IT,
    fileName: "gemma-4-E2B-it.litertlm",
    recommended: true,
  },
  {
    key: "GEMMA_4_E4B_IT",
    label: "Gemma-4-E4B-it",
    sizeLabel: "3.41 GB",
    url: GEMMA_4_E4B_IT,
    fileName: "gemma-4-E4B-it.litertlm",
  },
];

/** Built-in GGUF models for the llama.cpp backend. */
const BUILT_IN_GGUF_MODELS: ModelCatalogItem[] = [
  {
    key: "GRANITE_4_1_3B",
    label: "Granite-4.1-3B",
    sizeLabel: "1.85 GB",
    url: GRANITE_4_1_3B,
    fileName: "granite-4.1-3b-Q4_0.gguf",
  },
];

/** All built-in models across both backends (used for key lookups). */
const ALL_BUILT_IN_MODELS: ModelCatalogItem[] = [
  ...BUILT_IN_MODELS,
  ...BUILT_IN_GGUF_MODELS,
];

/** Built-in model keys grouped by backend (used to validate selection state). */
const LITERT_BUILT_IN_KEYS = BUILT_IN_MODELS.map((m) => m.key);
const GGUF_BUILT_IN_KEYS = BUILT_IN_GGUF_MODELS.map((m) => m.key);

const MODEL_DIRECTORY = new Directory(Paths.document, "models");
const MODAL_CONFIG_MODAL_THEME = { animation: { scale: 0 } };

type ModelConfigModalProps = {
  modelUri: string | null;
  modelName: string;
  config: ModelConfig | null;
  inferenceBackend: InferenceBackend;
  theme: MD3Theme;
  onSave: (config: ModelConfig) => void;
  onClose: () => void;
};

const flex1Style = { flex: 1 };
const FOCUS_REFRESH_INTERVAL_MS = 12_000;

/** Deep comparison of two LlamaCppAdvancedConfig objects (undefined-safe). */
function isLlamaCppConfigEqual(
  a?: Partial<LlamaCppAdvancedConfig>,
  b?: Partial<LlamaCppAdvancedConfig>,
): boolean {
  const mergedA: LlamaCppAdvancedConfig = { ...DEFAULT_LLAMA_CPP_CONFIG, ...a };
  const mergedB: LlamaCppAdvancedConfig = { ...DEFAULT_LLAMA_CPP_CONFIG, ...b };
  const keys = Object.keys(DEFAULT_LLAMA_CPP_CONFIG) as Array<
    keyof LlamaCppAdvancedConfig
  >;
  return keys.every((k) => mergedA[k] === mergedB[k]);
}

function isModelConfigEqual(a: ModelConfig, b: ModelConfig) {
  return (
    a.temperature === b.temperature &&
    a.maxTokens === b.maxTokens &&
    a.topK === b.topK &&
    a.topP === b.topP &&
    a.backend === b.backend &&
    a.enableSpeculativeDecoding === b.enableSpeculativeDecoding &&
    isLlamaCppConfigEqual(a.llamaCpp, b.llamaCpp)
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

/**
 * Integer text input row with a label. Used for llama.cpp numeric params
 * (context size, threads, batch sizes, draft tokens, ...).
 */
const IntInputRow = memo(function IntInputRow({
  label,
  value,
  min = 0,
  max,
  onValueChange,
  hint,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onValueChange: (v: number) => void;
  hint?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = (raw: string) => {
    let num = Number(raw);
    if (!Number.isFinite(num)) num = min;
    if (num < min) num = min;
    if (max !== undefined && num > max) num = max;
    num = Math.round(num);
    setText(String(num));
    onValueChange(num);
  };

  // number-pad has no minus key, so switch to numeric when negatives are valid
  // (e.g. threads = -1 means "auto").
  const keyboardType: "number-pad" | "numeric" =
    min < 0 ? "numeric" : "number-pad";

  return (
    <View style={advancedStyles.intRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyMedium">{label}</Text>
        {hint ? (
          <Text variant="labelSmall" style={{ opacity: 0.6 }}>
            {hint}
          </Text>
        ) : null}
      </View>
      <TextInput
        mode="outlined"
        keyboardType={keyboardType}
        value={text}
        onChangeText={(raw) => {
          setText(raw);
          // Fire onValueChange live for complete valid integers so parent state
          // stays in sync even if the user taps Save before dismissing the
          // keyboard (on Android, blur can fire after the button's onPress).
          const num = Number(raw);
          if (raw.length > 0 && raw !== "-" && Number.isFinite(num)) {
            let n = Math.round(num);
            if (n < min) n = min;
            if (max !== undefined && n > max) n = max;
            onValueChange(n);
          }
        }}
        onBlur={() => commit(text)}
        style={advancedStyles.intInput}
        contentStyle={advancedStyles.intInputContent}
        dense
        theme={MODAL_CONFIG_MODAL_THEME}
      />
    </View>
  );
});

/**
 * Selectable chip group for enum-style llama.cpp params (cache type, etc.).
 */
function ChipSelect<T extends string>({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onValueChange: (v: T) => void;
}) {
  return (
    <View style={advancedStyles.chipGroup}>
      <Text variant="bodyMedium">{label}</Text>
      <View style={advancedStyles.chipRow}>
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <Chip
              key={opt.value}
              selected={selected}
              onPress={() => onValueChange(opt.value)}
              mode={selected ? "flat" : "outlined"}
              compact
            >
              {opt.label}
            </Chip>
          );
        })}
      </View>
    </View>
  );
}

const advancedStyles = StyleSheet.create({
  sectionDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
    opacity: 0.2,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  advancedBody: {
    gap: 14,
  },
  intRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  intInput: {
    width: 90,
    height: 40,
    marginVertical: 0,
  },
  intInputContent: {
    height: 40,
    paddingVertical: 0,
  },
  chipGroup: {
    gap: 6,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
});

type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

/** Header row for a tunable setting. Shows the icon + label on the left, and
 *  on the right either a subtle "Default" pill (when the current value equals
 *  the built-in default) or a "Reset" affordance (when it has been changed).
 *  This gives an at-a-glance cue for which values are still at their defaults
 *  and a one-tap way back. */
const SettingLabel = memo(function SettingLabel({
  icon,
  label,
  isDefault,
  onReset,
  theme,
}: {
  icon: IconName;
  label: string;
  isDefault: boolean;
  onReset: () => void;
  theme: MD3Theme;
}) {
  return (
    <View style={settingLabelStyles.row}>
      <View style={settingLabelStyles.left}>
        <MaterialCommunityIcons
          name={icon}
          size={16}
          color={theme.colors.onSurfaceVariant}
        />
        <Text variant="labelLarge" style={{ fontWeight: "700" }}>
          {label}
        </Text>
      </View>
      {isDefault ? (
        <View
          style={[
            settingLabelStyles.badge,
            { backgroundColor: theme.colors.secondaryContainer },
          ]}
        >
          <MaterialCommunityIcons
            name="check-circle-outline"
            size={13}
            color={theme.colors.onSecondaryContainer}
          />
          <Text
            variant="labelSmall"
            style={[
              settingLabelStyles.badgeText,
              { color: theme.colors.onSecondaryContainer },
            ]}
          >
            Default
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={onReset}
          hitSlop={8}
          style={({ pressed }) => [
            settingLabelStyles.reset,
            {
              backgroundColor: pressed
                ? theme.colors.surfaceVariant
                : "transparent",
            },
          ]}
        >
          <MaterialCommunityIcons
            name="restore"
            size={16}
            color={theme.colors.onSurfaceVariant}
          />
          <Text
            variant="labelSmall"
            style={{ color: theme.colors.onSurfaceVariant }}
          >
            Reset
          </Text>
        </Pressable>
      )}
    </View>
  );
});

const settingLabelStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
    gap: 8,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeText: {
    fontWeight: "600",
    lineHeight: 14,
  },
  reset: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
  },
});

const FLASH_ATTN_OPTIONS: ReadonlyArray<{
  value: LlamaCppFlashAttn;
  label: string;
}> = [
  { value: "auto", label: "Auto" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const REASONING_OPTIONS: ReadonlyArray<{
  value: LlamaCppReasoning;
  label: string;
}> = [
  { value: "auto", label: "Auto" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const CACHE_TYPE_OPTIONS: ReadonlyArray<{
  value: LlamaCppCacheType;
  label: string;
}> = [
  { value: "f16", label: "f16" },
  { value: "f32", label: "f32" },
  { value: "bf16", label: "bf16" },
  { value: "q8_0", label: "q8_0" },
  { value: "q5_0", label: "q5_0" },
  { value: "q5_1", label: "q5_1" },
  { value: "q4_0", label: "q4_0" },
  { value: "q4_1", label: "q4_1" },
  { value: "iq4_nl", label: "iq4_nl" },
];

const ModelConfigModal = memo(function ModelConfigModal({
  modelUri,
  modelName,
  config,
  inferenceBackend,
  theme,
  onSave,
  onClose,
}: ModelConfigModalProps) {
  const isLlamaCpp = inferenceBackend === BACKEND_LLAMA_CPP;

  const [draft, setDraft] = useState<ModelConfig>(
    () => config ?? DEFAULT_MODEL_CONFIG,
  );
  const [enableSpeculativeDecoding, setEnableSpeculativeDecoding] =
    useState<boolean>(() => config?.enableSpeculativeDecoding ?? false);
  const [llamaCppDraft, setLlamaCppDraft] = useState<LlamaCppAdvancedConfig>(
    () => ({ ...DEFAULT_LLAMA_CPP_CONFIG, ...(config?.llamaCpp ?? {}) }),
  );
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  useEffect(() => {
    if (config && !isModelConfigEqual(config, draft)) setDraft(config);
  }, [modelUri]);

  useEffect(() => {
    setEnableSpeculativeDecoding(config?.enableSpeculativeDecoding ?? false);
    setLlamaCppDraft({
      ...DEFAULT_LLAMA_CPP_CONFIG,
      ...(config?.llamaCpp ?? {}),
    });
  }, [modelUri]);

  return (
    <Modal
      visible={!!modelUri}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      {/*
        Backdrop + card are SIBLINGS, not nested. The backdrop Pressable fills
        the screen behind the card; tapping it (outside the card) closes the
        modal. Keeping the card a plain View — with no Pressable ancestor above
        the ScrollView — is what lets the ScrollView capture pan gestures even
        when the drag starts on empty/gap space inside it.
      */}
      <View style={styles.modalBackdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.modalCard,
            {
              backgroundColor: theme.colors.surface,
              maxWidth: 380,
              maxHeight: "85%",
            },
          ]}
        >
          <Text variant="titleMedium" style={{ fontWeight: "700" }}>
            {modelName} Settings
          </Text>

          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ gap: 10 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
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
                    setDraft((prev) => ({
                      ...prev,
                      maxTokens: Math.round(num),
                    }));
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
                setDraft((prev) => ({
                  ...prev,
                  topP: Math.round(v * 100) / 100,
                }))
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

            {/* Speculative decoding toggle — LiteRT only. llama.cpp uses the
              richer spec config in the advanced section below. */}
            {!isLlamaCpp && (
              <View style={styles.speculativeToggleRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium">Enable speculative decoding</Text>
                </View>
                <Switch
                  value={enableSpeculativeDecoding}
                  onValueChange={setEnableSpeculativeDecoding}
                />
              </View>
            )}

            {/* Advanced llama.cpp options. Only shown for the llama.cpp backend.
              Each field maps 1:1 to a llama-server / llama.rn context param. */}
            {isLlamaCpp && (
              <View style={advancedStyles.advancedBody}>
                <Pressable
                  style={advancedStyles.sectionHeader}
                  onPress={() => setShowAdvanced((v) => !v)}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <MaterialCommunityIcons
                      name="tune-variant"
                      size={18}
                      color={theme.colors.primary}
                    />
                    <Text variant="titleSmall" style={{ fontWeight: "700" }}>
                      Advanced
                    </Text>
                  </View>
                  <MaterialCommunityIcons
                    name={showAdvanced ? "chevron-up" : "chevron-down"}
                    size={22}
                    color={theme.colors.onSurfaceVariant}
                  />
                </Pressable>

                {showAdvanced && (
                  <>
                    <ChipSelect<LlamaCppFlashAttn>
                      label="Flash attention (-fa)"
                      value={llamaCppDraft.flashAttn}
                      options={FLASH_ATTN_OPTIONS}
                      onValueChange={(flashAttn) =>
                        setLlamaCppDraft((prev) => ({ ...prev, flashAttn }))
                      }
                    />

                    <IntInputRow
                      label="Context size (-c)"
                      hint="size of the prompt context (default 4096)"
                      value={llamaCppDraft.nCtx}
                      min={0}
                      onValueChange={(nCtx) =>
                        setLlamaCppDraft((prev) => ({ ...prev, nCtx }))
                      }
                    />
                    <IntInputRow
                      label="Threads (-t)"
                      hint="number of CPU threads during generation. -1 = auto"
                      value={llamaCppDraft.nThreads}
                      min={-1}
                      onValueChange={(nThreads) =>
                        setLlamaCppDraft((prev) => ({ ...prev, nThreads }))
                      }
                    />
                    <IntInputRow
                      label="Batch size (-b)"
                      hint="logical maximum batch size"
                      value={llamaCppDraft.nBatch}
                      min={1}
                      onValueChange={(nBatch) =>
                        setLlamaCppDraft((prev) => ({ ...prev, nBatch }))
                      }
                    />
                    <IntInputRow
                      label="Ubatch size (-ub)"
                      hint="physical maximum batch size"
                      value={llamaCppDraft.nUbatch}
                      min={1}
                      onValueChange={(nUbatch) =>
                        setLlamaCppDraft((prev) => ({ ...prev, nUbatch }))
                      }
                    />

                    <ChipSelect<LlamaCppCacheType>
                      label="KV cache data type for K (-ctk)"
                      value={llamaCppDraft.cacheTypeK}
                      options={CACHE_TYPE_OPTIONS}
                      onValueChange={(cacheTypeK) =>
                        setLlamaCppDraft((prev) => ({ ...prev, cacheTypeK }))
                      }
                    />
                    <ChipSelect<LlamaCppCacheType>
                      label="KV cache data type for V (-ctv)"
                      value={llamaCppDraft.cacheTypeV}
                      options={CACHE_TYPE_OPTIONS}
                      onValueChange={(cacheTypeV) =>
                        setLlamaCppDraft((prev) => ({ ...prev, cacheTypeV }))
                      }
                    />

                    <View style={styles.speculativeToggleRow}>
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyMedium">mlock (--mlock)</Text>
                        <Text variant="labelSmall" style={{ opacity: 0.6 }}>
                          keep model in RAM rather than swapping or compressing
                        </Text>
                      </View>
                      <Switch
                        value={llamaCppDraft.useMlock}
                        onValueChange={(useMlock) =>
                          setLlamaCppDraft((prev) => ({ ...prev, useMlock }))
                        }
                      />
                    </View>
                    <View style={styles.speculativeToggleRow}>
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyMedium">mmap (--mmap)</Text>
                        <Text variant="labelSmall" style={{ opacity: 0.6 }}>
                          memory-map model. if disabled, slower load but may
                          reduce pageouts if not using mlock
                        </Text>
                      </View>
                      <Switch
                        value={llamaCppDraft.useMmap}
                        onValueChange={(useMmap) =>
                          setLlamaCppDraft((prev) => ({ ...prev, useMmap }))
                        }
                      />
                    </View>
                    <ChipSelect<LlamaCppReasoning>
                      label="Reasoning (-rea, --reasoning)"
                      value={llamaCppDraft.reasoning}
                      options={REASONING_OPTIONS}
                      onValueChange={(reasoning) =>
                        setLlamaCppDraft((prev) => ({ ...prev, reasoning }))
                      }
                    />
                  </>
                )}
              </View>
            )}
          </ScrollView>

          <View style={modalRowEnd}>
            <Button
              mode="text"
              onPress={() => {
                setDraft(DEFAULT_MODEL_CONFIG);
                setEnableSpeculativeDecoding(false);
                setLlamaCppDraft({ ...DEFAULT_LLAMA_CPP_CONFIG });
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
                console.log("[ModelConfigModal] Saving config", {
                  backend: "cpu",
                  llamaCppDraft,
                });
                onSave({
                  ...validated,
                  backend: "cpu",
                  enableSpeculativeDecoding,
                  // Only persist llama.cpp advanced config for the llama.cpp
                  // backend; drop it for LiteRT so storage stays clean.
                  llamaCpp: isLlamaCpp ? llamaCppDraft : undefined,
                });
              }}
            >
              Save
            </Button>
          </View>
        </View>
      </View>
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
  const systemColorScheme = useColorScheme();
  // AMOLED is dark-derived, so the segmented control collapses it onto
  // "dark" and exposes it as a separate toggle below.
  const isDarkResolved =
    mode === "dark" ||
    mode === "amoled" ||
    (mode === "system" && systemColorScheme === "dark");

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
    BuiltInModelKey | "custom"
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
  const [downloadStatusLabel, setDownloadStatusLabel] = useState<string | null>(
    null,
  );
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
  // Per-backend model tab selection so switching backends doesn't carry the
  // Offline/Download choice over. Defaults are computed lazily per backend
  // (Offline if that backend has compatible models installed, else Download).
  const [modelTabsByBackend, setModelTabsByBackend] = useState<
    Partial<Record<InferenceBackend, "download" | "offline">>
  >({});
  const [showLlamaCppModal, setShowLlamaCppModal] = useState(false);

  // Clear download error when switching from custom URL to built-in models
  useEffect(() => {
    if (selectedModelKey !== "custom") {
      setDownloadError(null);
    }
  }, [selectedModelKey]);

  // Keep the download selection coherent with the active backend. When the
  // backend changes (or on first load with a persisted backend), fall back to
  // the first built-in model for that backend if the current selection belongs
  // to the other backend — otherwise the catalog/highlighting and the download
  // source would be mismatched. A manually-selected "custom" URL is preserved.
  useEffect(() => {
    if (selectedModelKey === "custom") return;
    const backend = data.inferenceBackend ?? BACKEND_LITERT;
    if (
      backend === BACKEND_LLAMA_CPP &&
      !GGUF_BUILT_IN_KEYS.includes(selectedModelKey)
    ) {
      setSelectedModelKey(BUILT_IN_GGUF_MODELS[0]?.key ?? "custom");
    } else if (
      backend === BACKEND_LITERT &&
      !LITERT_BUILT_IN_KEYS.includes(selectedModelKey)
    ) {
      setSelectedModelKey(BUILT_IN_MODELS[0]?.key ?? "custom");
    }
  }, [data.inferenceBackend, selectedModelKey]);

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
    ? (data.perModelConfig?.[
        activeModelConfigUri.startsWith("file:///")
          ? activeModelConfigUri.replace("file:///", "/")
          : activeModelConfigUri
      ] ?? DEFAULT_MODEL_CONFIG)
    : null;

  const handleSaveModelConfig = (config: ModelConfig) => {
    if (!activeModelConfigUri) return;
    // Normalize the key the same way log.tsx does when looking up perModelConfig,
    // so the saved entry is always found at runtime.
    const configKey = activeModelConfigUri.startsWith("file:///")
      ? activeModelConfigUri.replace("file:///", "/")
      : activeModelConfigUri;
    console.log("[handleSaveModelConfig] Saving to perModelConfig", {
      modelUri: configKey,
      config,
    });
    setData((prev) => ({
      ...prev,
      perModelConfig: {
        ...prev.perModelConfig,
        [configKey]: config,
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
      .filter(
        (file) =>
          file.name.toLowerCase().endsWith(".litertlm") ||
          file.name.toLowerCase().endsWith(".gguf"),
      )
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

    // Prime the in-memory cache synchronously so other tabs observe this
    // change immediately on focus. The actual disk write below is debounced,
    // so without this a quick Settings -> Log round trip (e.g. selecting a
    // model) would let Log read a stale cached model path and fail to clear a
    // stale "No model file selected" error.
    primeStoredDataCache(data);

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

    const selected = ALL_BUILT_IN_MODELS.find(
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
    const builtIn = ALL_BUILT_IN_MODELS.find((m) => m.key === selectedModelKey);
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

    try {
      downloadCancelRequestedRef.current = false;
      setIsDownloading(true);
      setIsCancellingDownload(false);
      setDownloadProgress(0);
      setDownloadedBytes(0);
      setTotalBytes(null);
      setDownloadSpeed(null);
      setDownloadStatusLabel("Preparing");
      setActiveDownloadLabel(source.label);

      // Validate magic number for LiteRT custom URLs to detect invalid links.
      // Skip for llama.cpp since GGUF files have a different magic.
      if (
        selectedModelKey === "custom" &&
        (data.inferenceBackend ?? BACKEND_LITERT) === BACKEND_LITERT
      ) {
        setDownloadStatusLabel("Checking model file");
        const magicValidation = await validateModelMagicNumber(source.url);
        if (!magicValidation.valid) {
          setDownloadError(magicValidation.message!);
          return;
        }
      }

      let shouldShowDownloadNotifications = true;
      setDownloadStatusLabel("Checking notifications");
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
      setDownloadStatusLabel("Checking file size");
      knownTotalBytes = await resolveRemoteFileSize(source.url);
      if (knownTotalBytes && knownTotalBytes > 0) {
        setTotalBytes(knownTotalBytes);
      }

      // Destination path without file:// prefix (required by background downloader)
      const destPath = destFile.uri.replace(/^file:\/\//, "");

      // Use native background downloader — continues even when app is backgrounded/killed
      setDownloadStatusLabel("Starting download");
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
            setDownloadStatusLabel("Downloading");
            if (expectedBytes && expectedBytes > 0) {
              knownTotalBytes = expectedBytes;
              setTotalBytes(expectedBytes);
            }
          })
          .progress(({ bytesDownloaded, bytesTotal }) => {
            setDownloadStatusLabel("Downloading");
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
      setDownloadStatusLabel(null);
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
    if (active) return active.name;
    return "No model selected.";
  }, [data.modelPath, downloadedModels]);

  /** Whether the currently loaded model uses the LiteRT backend. */
  const activeModelUsesLiteRT = useMemo(() => {
    if (!loadedModelKey || !data.modelPath) return false;
    const active = downloadedModels.find(
      (model) => model.uri === data.modelPath,
    );
    if (!active) return false;
    return active.name.toLowerCase().endsWith(".litertlm");
  }, [loadedModelKey, data.modelPath, downloadedModels]);

  /** Whether the currently loaded model uses the llama.cpp backend. */
  const activeModelUsesLlamaCpp = useMemo(() => {
    if (!loadedModelKey || !data.modelPath) return false;
    const active = downloadedModels.find(
      (model) => model.uri === data.modelPath,
    );
    if (!active) return false;
    return active.name.toLowerCase().endsWith(".gguf");
  }, [loadedModelKey, data.modelPath, downloadedModels]);

  /** Whether the selected model is a GGUF/llama.cpp model (for icon selection). */
  const isModelLlamaCpp = useMemo(() => {
    if (data.modelPath) {
      return data.modelPath.toLowerCase().endsWith(".gguf");
    }
    return (data.inferenceBackend ?? BACKEND_LITERT) === BACKEND_LLAMA_CPP;
  }, [data.modelPath, data.inferenceBackend]);

  /** Filter downloaded models to only show files compatible with the active backend. */
  const backendFilteredModels = useMemo(() => {
    const backend = data.inferenceBackend ?? BACKEND_LITERT;
    return downloadedModels.filter((m) => {
      const isGguf = m.name.toLowerCase().endsWith(".gguf");
      const isLitertlm = m.name.toLowerCase().endsWith(".litertlm");
      return backend === BACKEND_LLAMA_CPP ? isGguf : isLitertlm;
    });
  }, [data.inferenceBackend, downloadedModels]);

  const activeBackend: InferenceBackend =
    data.inferenceBackend ?? BACKEND_LITERT;
  const activeModelTab: "download" | "offline" =
    modelTabsByBackend[activeBackend] ?? "download";

  const setActiveModelTab = useCallback(
    (value: "download" | "offline") => {
      setModelTabsByBackend((prev) =>
        prev[activeBackend] === value
          ? prev
          : { ...prev, [activeBackend]: value },
      );
    },
    [activeBackend],
  );

  // Lazily pick the default tab for whichever backend is active: Offline when
  // compatible models exist for it, otherwise Download so users with nothing
  // installed for that backend are guided straight there.
  useEffect(() => {
    if (!isReady) return;
    setModelTabsByBackend((prev) => {
      if (prev[activeBackend] !== undefined) return prev;
      return {
        ...prev,
        [activeBackend]:
          backendFilteredModels.length > 0 ? "offline" : "download",
      };
    });
  }, [isReady, activeBackend, backendFilteredModels.length]);

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

  /**
   * Render a single built-in model button (shared by the LiteRT and llama.cpp
   * catalogs). Handles selection highlight, architecture/RAM blocking, and the
   * recommended / memory warning badges.
   */
  const renderBuiltInModelButton = (model: ModelCatalogItem) => {
    const memoryCheck = checkModelMemory(model.key);
    const isBlocked = isArchitectureBlocked || memoryCheck.status === "blocked";
    const isWarning = memoryCheck.status === "warning";
    const memoryGB = memoryCheck.modelMemoryBytes / (1024 * 1024 * 1024);
    const memoryLabel = `${memoryGB} GB`;
    return (
      <View key={model.key}>
        <View style={[isBlocked && styles.modelBlockedContainer]}>
          <Button
            mode={selectedModelKey === model.key ? "contained" : "outlined"}
            onPress={() => {
              if (!isBlocked) setSelectedModelKey(model.key);
            }}
            disabled={isBlocked}
            icon={isBlocked ? "lock" : isWarning ? "alert" : undefined}
            style={
              isBlocked
                ? [
                    styles.modelBlockedButton,
                    {
                      backgroundColor: theme.colors.surfaceVariant,
                    },
                  ]
                : undefined
            }
            textColor={isBlocked ? theme.colors.onSurfaceVariant : undefined}
          >
            {model.label} ({model.sizeLabel})
          </Button>
          {model.recommended && !isBlocked && (
            <View
              style={[
                styles.recommendedTag,
                {
                  backgroundColor: theme.colors.primaryContainer,
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
                name={isBlocked ? "alert-circle-outline" : "alert"}
                size={12}
                color={isBlocked ? theme.colors.error : theme.colors.tertiary}
              />
              <Text
                variant="labelSmall"
                style={{
                  fontSize: 10,
                  fontWeight: "700",
                  color: isBlocked ? theme.colors.error : theme.colors.tertiary,
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
              Requires {memoryLabel} ({memoryCheck.usagePercent}% of RAM)
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
  };

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
              value={mode === "amoled" ? "dark" : mode}
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
            <View style={styles.amoledRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyMedium">Pure black (AMOLED)</Text>
                <Text
                  variant="labelSmall"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  Use a pure black background in dark mode. Saves battery on
                  OLED screens.
                </Text>
              </View>
              <Switch
                value={mode === "amoled"}
                disabled={!isDarkResolved}
                onValueChange={(value) => setMode(value ? "amoled" : "dark")}
              />
            </View>
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
          <Card.Title title="Models & Backend" titleVariant="titleLarge" />
          <Card.Content style={[styles.formArea, { marginTop: -5 }]}>
            {/* Active model badge */}
            <Pressable
              onPress={() => loadedModelKey && setShowMemoryModal(true)}
              style={({ pressed }) => [
                styles.activeModelBadge,
                {
                  backgroundColor: pressed
                    ? theme.colors.elevation.level3
                    : theme.colors.elevation.level2,
                  borderColor: loadedModelKey
                    ? theme.colors.primary
                    : theme.colors.outlineVariant,
                },
              ]}
            >
              {isModelLlamaCpp ? (
                <View style={{ width: 20, height: 20 }}>
                  <LlamaIcon
                    size={20}
                    color={
                      loadedModelKey
                        ? theme.colors.primary
                        : theme.colors.onSurfaceVariant
                    }
                  />
                </View>
              ) : (
                <MaterialCommunityIcons
                  name="google"
                  size={20}
                  color={
                    loadedModelKey
                      ? theme.colors.primary
                      : theme.colors.onSurfaceVariant
                  }
                />
              )}
              <View style={{ flex: 1 }}>
                <Text
                  variant="labelSmall"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  {loadedModelKey ? "Loaded in memory" : "Active model"}
                </Text>
                <Text variant="bodyMedium" style={{ fontWeight: "600" }}>
                  {selectedModelDescription}
                </Text>
              </View>
              {loadedModelKey && memoryUsageBytes !== null && (
                <Chip
                  mode="flat"
                  compact
                  style={{ backgroundColor: theme.colors.primaryContainer }}
                  textStyle={{
                    color: theme.colors.onPrimaryContainer,
                    fontSize: 10,
                    fontWeight: "700",
                  }}
                >
                  {(memoryUsageBytes / 1024 / 1024).toFixed(0)} MB
                </Chip>
              )}
            </Pressable>

            {/* Backend selector */}
            <View style={styles.sectionLabel}>
              <MaterialCommunityIcons
                name="swap-horizontal"
                size={16}
                color={theme.colors.onSurfaceVariant}
              />
              <Text variant="labelLarge" style={{ fontWeight: "700" }}>
                Inference backend
              </Text>
            </View>
            <SegmentedButtons
              style={[
                styles.segmentedControl,
                { backgroundColor: theme.colors.elevation.level2 },
              ]}
              theme={segmentedButtonsTheme}
              value={data.inferenceBackend ?? BACKEND_LITERT}
              onValueChange={(value) => {
                const newBackend = value as InferenceBackend;

                // A model file only runs on its matching backend
                // (.litertlm -> LiteRT, .gguf -> llama.cpp). When switching,
                // keep the active model only if it's compatible with the new
                // backend; otherwise clear it so we never feed a .gguf to
                // LiteRT (or a .litertlm to llama.cpp), which throws
                // "Unsupported or unknown file format".
                //
                // We deliberately do NOT auto-pick a replacement: with
                // multiple models downloaded the choice would be arbitrary
                // (array order), which is surprising. The user explicitly
                // taps the model they want for the new backend. The Offline
                // tab already shows "No model selected" until they do.
                //
                // clearModelCache() is called OUTSIDE the setData updater —
                // it notifies useSyncExternalStore listeners synchronously,
                // which is a side effect React forbids inside an updater.
                const isCompatible = (path: string | null): boolean => {
                  if (!path) return false;
                  const lower = path.toLowerCase();
                  return newBackend === BACKEND_LLAMA_CPP
                    ? lower.endsWith(".gguf")
                    : lower.endsWith(".litertlm");
                };
                const keepActive = isCompatible(data.modelPath);
                if (!keepActive) clearModelCache();

                setData((prev) =>
                  keepActive
                    ? { ...prev, inferenceBackend: newBackend }
                    : {
                        ...prev,
                        inferenceBackend: newBackend,
                        modelPath: null,
                      },
                );
              }}
              buttons={[
                {
                  value: BACKEND_LITERT,
                  label: `LiteRT${activeModelUsesLiteRT ? " ★" : ""}`,
                  icon: "google",
                },
                {
                  value: BACKEND_LLAMA_CPP,
                  label: `llama.cpp${activeModelUsesLlamaCpp ? " ★" : ""}`,
                  icon: ({ size, color }: { size: number; color: string }) => (
                    <LlamaIcon size={size} color={color} />
                  ),
                },
              ]}
            />
            <Text
              variant="labelSmall"
              style={{
                color: theme.colors.onSurfaceVariant,
                marginTop: -2,
              }}
            >
              {(data.inferenceBackend ?? BACKEND_LITERT) === BACKEND_LITERT
                ? "Google's optimized runtime for .litertlm models"
                : "Open-source GGUF inference engine (llama.cpp)"}
            </Text>

            {showLlamaCppModal && (
              <Modal
                visible={true}
                transparent
                animationType="fade"
                onRequestClose={() => setShowLlamaCppModal(false)}
              >
                <Pressable
                  style={styles.modalBackdrop}
                  onPress={() => setShowLlamaCppModal(false)}
                >
                  <Pressable
                    style={[
                      styles.modalCard,
                      { backgroundColor: theme.colors.surface },
                    ]}
                    onPress={() => {}}
                  >
                    <MaterialCommunityIcons
                      name="package-variant-closed"
                      size={40}
                      color={theme.colors.primary}
                      style={{ alignSelf: "center" }}
                    />
                    <Text
                      variant="titleMedium"
                      style={{ fontWeight: "700", textAlign: "center" }}
                    >
                      Enable llama.cpp
                    </Text>
                    <Text
                      variant="bodySmall"
                      style={{
                        color: theme.colors.onSurfaceVariant,
                        textAlign: "center",
                      }}
                    >
                      llama.cpp is an optional backend. The native module must
                      be linked at build time — it cannot be downloaded at
                      runtime.
                    </Text>
                    <View
                      style={{
                        backgroundColor: theme.colors.surfaceVariant,
                        borderRadius: 12,
                        padding: 12,
                        gap: 8,
                      }}
                    >
                      <Text
                        variant="labelMedium"
                        style={{
                          color: theme.colors.onSurfaceVariant,
                          fontWeight: "700",
                        }}
                      >
                        Install & Rebuild
                      </Text>
                      <Text
                        variant="bodySmall"
                        style={{
                          fontFamily:
                            Platform.OS === "android" ? "monospace" : "Menlo",
                          color: theme.colors.onSurfaceVariant,
                          lineHeight: 18,
                        }}
                      >
                        npm install llama.rn{"\n"}npx expo run:android
                      </Text>
                      <Button
                        mode="outlined"
                        icon="content-copy"
                        compact
                        onPress={() => {
                          try {
                            // @ts-ignore – Clipboard may not be available in all RN versions
                            const Clipboard =
                              require("@react-native-clipboard/clipboard").default;
                            if (Clipboard) {
                              Clipboard.setString(
                                "npm install llama.rn\nnpx expo run:android",
                              );
                              if (Platform.OS === "android") {
                                ToastAndroid.show(
                                  "Commands copied to clipboard",
                                  ToastAndroid.SHORT,
                                );
                              }
                            }
                          } catch {
                            // Clipboard not available — ignore
                          }
                        }}
                      >
                        Copy commands
                      </Button>
                    </View>
                    <View style={modalRowEnd}>
                      <Button
                        mode="text"
                        onPress={() => setShowLlamaCppModal(false)}
                      >
                        Close
                      </Button>
                    </View>
                  </Pressable>
                </Pressable>
              </Modal>
            )}

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

            {/* Offline / Download subview */}
            <View
              style={[
                styles.tabContentContainer,
                { borderColor: theme.colors.outlineVariant },
              ]}
            >
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
                      backendFilteredModels.length > 0
                        ? `Offline (${backendFilteredModels.length})`
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
                        {downloadStatusLabel ?? "Downloading"}{" "}
                        {activeDownloadLabel ?? "model"}
                      </Text>
                      <Text
                        variant="labelSmall"
                        style={{ color: theme.colors.onSurfaceVariant }}
                      >
                        {downloadedBytes > 0 || totalBytes
                          ? totalBytes
                            ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)} (${Math.round(downloadProgress * 100)}%)`
                            : formatBytes(downloadedBytes)
                          : "Preparing connection"}
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
                      disabled={
                        isCancellingDownload ||
                        downloadStatusLabel !== "Downloading"
                      }
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

                  {/* LiteRT built-in model buttons — only shown when LiteRT backend is active */}
                  {(data.inferenceBackend ?? BACKEND_LITERT) ===
                    BACKEND_LITERT && (
                    <View style={styles.modelSelector}>
                      {BUILT_IN_MODELS.map(renderBuiltInModelButton)}
                      <Button
                        mode={
                          selectedModelKey === "custom"
                            ? "contained"
                            : "outlined"
                        }
                        onPress={() => {
                          if (!isArchitectureBlocked)
                            setSelectedModelKey("custom");
                        }}
                        disabled={isArchitectureBlocked}
                        icon={isArchitectureBlocked ? "lock" : undefined}
                      >
                        Custom URL
                      </Button>
                    </View>
                  )}

                  {/* llama.cpp built-in GGUF model buttons — only shown when the
                      llama.cpp backend is active. Mirrors the LiteRT selector
                      via the shared renderBuiltInModelButton helper. */}
                  {(data.inferenceBackend ?? BACKEND_LITERT) ===
                    BACKEND_LLAMA_CPP && (
                    <View style={styles.modelSelector}>
                      {BUILT_IN_GGUF_MODELS.map(renderBuiltInModelButton)}
                      <Button
                        mode={
                          selectedModelKey === "custom"
                            ? "contained"
                            : "outlined"
                        }
                        onPress={() => setSelectedModelKey("custom")}
                        icon="download"
                      >
                        Custom URL
                      </Button>
                    </View>
                  )}

                  {selectedModelKey === "custom" ? (
                    <TextInput
                      mode="outlined"
                      label="Model URL"
                      value={customModelUrl}
                      onChangeText={setCustomModelUrl}
                      placeholder={
                        (data.inferenceBackend ?? BACKEND_LITERT) ===
                        BACKEND_LLAMA_CPP
                          ? "https://.../model.gguf"
                          : "https://.../model.litertlm"
                      }
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
                      (selectedModelKey === "custom" &&
                        !customModelUrl.trim()) ||
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
                              {
                                backgroundColor: theme.colors.tertiaryContainer,
                              },
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
                  {backendFilteredModels.length ? (
                    <View style={styles.downloadedList}>
                      {backendFilteredModels.map((model) => {
                        const isEstimate =
                          (data.estimateModelPath ?? data.modelPath) ===
                          model.uri;
                        const inMemory = isInMemory(model.uri);
                        const savedConfig =
                          data.perModelConfig?.[
                            model.uri.startsWith("file:///")
                              ? model.uri.replace("file:///", "/")
                              : model.uri
                          ];
                        const hasCustomConfig =
                          !!savedConfig &&
                          !isModelConfigEqual(
                            savedConfig,
                            DEFAULT_MODEL_CONFIG,
                          );

                        // Determine model key from filename
                        const modelKey = model.name.includes("gemma-4-E2B")
                          ? "GEMMA_4_E2B_IT"
                          : model.name.includes("gemma-4-E4B")
                            ? "GEMMA_4_E4B_IT"
                            : model.name.includes("granite-4.1-3b")
                              ? "GRANITE_4_1_3B"
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
                                borderColor: isEstimate
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
                                mode={isEstimate ? "contained" : "outlined"}
                                onPress={() => setActiveModel(model.uri)}
                                disabled={isBlocked}
                                icon={isBlocked ? "lock" : undefined}
                              >
                                {isEstimate
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
            </View>

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
          <Card.Title title="Data backup" titleVariant="titleLarge" />
          <Card.Content style={styles.formArea}>
            <Button
              mode="contained"
              icon="tray-arrow-up"
              onPress={handleExportData}
              loading={isExporting}
              disabled={isExporting}
            >
              {isExporting ? "Exporting..." : "Export data"}
            </Button>
            <Button
              mode="outlined"
              icon="tray-arrow-down"
              onPress={handleImportData}
              loading={importProgress !== null}
              disabled={importProgress !== null}
            >
              {importProgress !== null ? "Importing..." : "Import data"}
            </Button>
            {importProgress !== null ? (
              <View>
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
          </Card.Content>
        </Card>

        <Card style={styles.card} mode="elevated">
          <Card.Title title="Calculations" titleVariant="titleLarge" />
          <Card.Content style={styles.formArea}>
            <SettingLabel
              icon="leaf"
              label="Fibre calorie approach"
              isDefault={
                data.fibreCalorieApproach === DEFAULT_FIBRE_CALORIE_APPROACH
              }
              onReset={() =>
                setData((prev) => ({
                  ...prev,
                  fibreCalorieApproach: DEFAULT_FIBRE_CALORIE_APPROACH,
                }))
              }
              theme={theme}
            />
            <Text
              variant="labelSmall"
              style={{ color: theme.colors.onSurfaceVariant, marginTop: -2 }}
            >
              US &amp; Net: your carb figure includes fibre (USDA / US labels).
              EU: carbs exclude fibre (EU / Aus labels). Default: EU.
            </Text>
            <SegmentedButtons
              style={[
                styles.segmentedControl,
                { backgroundColor: theme.colors.elevation.level2 },
              ]}
              theme={segmentedButtonsTheme}
              value={data.fibreCalorieApproach}
              onValueChange={(value) => {
                if (
                  value === FIBRE_CALORIE_APPROACH_FDA ||
                  value === FIBRE_CALORIE_APPROACH_NET ||
                  value === FIBRE_CALORIE_APPROACH_EU
                ) {
                  setData((prev) => ({
                    ...prev,
                    fibreCalorieApproach: value,
                  }));
                }
              }}
              buttons={[
                {
                  value: FIBRE_CALORIE_APPROACH_FDA,
                  label: "US",
                  icon: "flag-outline",
                },
                {
                  value: FIBRE_CALORIE_APPROACH_NET,
                  label: "Net",
                  icon: "minus-circle-outline",
                },
                {
                  value: FIBRE_CALORIE_APPROACH_EU,
                  label: "EU",
                  icon: "check-circle-outline",
                },
              ]}
            />

            <SettingLabel
              icon="percent-outline"
              label="Macro mismatch tolerance"
              isDefault={
                data.calorieTolerancePercent ===
                DEFAULT_CALORIE_TOLERANCE_PERCENT
              }
              onReset={() =>
                setData((prev) => ({
                  ...prev,
                  calorieTolerancePercent: DEFAULT_CALORIE_TOLERANCE_PERCENT,
                }))
              }
              theme={theme}
            />
            <Text
              variant="labelSmall"
              style={{ color: theme.colors.onSurfaceVariant, marginTop: -2 }}
            >
              Allowed difference between logged calories and the macro-derived
              estimate. Default: 12%.
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
          </Card.Content>
        </Card>

        <Card style={styles.card} mode="elevated">
          <Card.Title title="Graph" titleVariant="titleLarge" />
          <Card.Content style={styles.formArea}>
            <SettingLabel
              icon="chart-line"
              label="On-target tolerance"
              isDefault={
                data.graphToleranceCalories === DEFAULT_GRAPH_TOLERANCE_CALORIES
              }
              onReset={() =>
                setData((prev) => ({
                  ...prev,
                  graphToleranceCalories: DEFAULT_GRAPH_TOLERANCE_CALORIES,
                }))
              }
              theme={theme}
            />
            <Text
              variant="labelSmall"
              style={{ color: theme.colors.onSurfaceVariant, marginTop: -2 }}
            >
              How close to your daily goal counts as “On target”. Default: 100
              kcal.
            </Text>
            <TextInput
              mode="outlined"
              label="Tolerance (kcal)"
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
        inferenceBackend={data.inferenceBackend ?? BACKEND_LITERT}
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
  amoledRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  tabContentContainer: {
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 12,
    gap: 10,
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
  activeModelBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 2,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sectionLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
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
    gap: 4,
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
    marginTop: 2,
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
