import { kvStore } from "@/lib/kvStore";
import { createDeferredWriter } from "@/lib/deferredWrite";
import {
  STORAGE_KEY as CONST_STORAGE_KEY,
  DEFAULT_BASE_TARGET_CALORIES,
  DEFAULT_CALORIES_PER_KG,
  DEFAULT_CALORIE_ADJUSTMENT,
  DEFAULT_PERCENT_PER_WEEK,
  DEFAULT_CALORIE_TOLERANCE_PERCENT,
  DEFAULT_GRAPH_TOLERANCE_CALORIES,
  DEFAULT_ACTIVITY_LEVEL,
  DEFAULT_SEX,
  DEFAULT_MODEL_TEMPERATURE,
  DEFAULT_MODEL_MAX_TOKENS,
  DEFAULT_MODEL_TOP_K,
  DEFAULT_MODEL_TOP_P,
  DEFAULT_MODEL_BACKEND,
  DEFAULT_INFERENCE_BACKEND,
  DEFAULT_FIBRE_CALORIE_APPROACH,
  PHASE_MAINTAIN,
  ADJUSTMENT_TYPE_KCAL,
} from "@/constants";
import type { InferenceBackend, FibreCalorieApproach } from "@/constants";

export type FavouriteQuickAdd = {
  title: string;
  calories: number;
  proteinGrams?: number | null;
  fatGrams?: number | null;
  carbsGrams?: number | null;
  fibreGrams?: number | null;
};

export type MetabolismSex = "unspecified" | "male" | "female";
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "heavy"
  | "athlete";
export type GoalPhase = "maintain" | "cut" | "bulk";
export type GoalAdjustmentType = "kcal" | "percent";

export type WeightPoint = {
  recordedAt: string;
  weightKg: number;
  source: "manual" | "health-connect";
  originAppId?: string;
  originAppName?: string;
  originDevice?: string;
};

export type BodyFatPoint = {
  recordedAt: string;
  bodyFatPercentage: number;
  source: "health-connect";
  originAppId?: string;
  originAppName?: string;
  originDevice?: string;
};

export type StoredData = {
  favouriteQuickAdds: FavouriteQuickAdd[];
  modelPath: string | null;
  /** Model used for text-only estimate-meal feature. Falls back to modelPath. */
  estimateModelPath: string | null;
  /** Which inference engine to use: "litert" (default) or "llama-rn" */
  inferenceBackend: InferenceBackend;
  systemPrompt: string;
  quickLogMacrosExpanded: boolean;
  baseTarget: number;
  caloriesPerKg: number;
  goalPhase: GoalPhase;
  cutAdjustmentType: GoalAdjustmentType;
  cutCalorieAdjustment: number;
  cutPercentPerWeek: number;
  bulkAdjustmentType: GoalAdjustmentType;
  bulkCalorieAdjustment: number;
  bulkPercentPerWeek: number;
  metabolismSex: MetabolismSex;
  metabolismAgeYears: number | null;
  metabolismHeightCm: number | null;
  metabolismBodyFatPercent: number | null;
  manualBodyFatPercent: number | null;
  activityLevel: ActivityLevel;
  manualWeightKg: number | null;
  lastWeightSyncAt: string | null;
  lastBodyFatSyncAt: string | null;
  proteinGoalGrams: number | null;
  fatGoalGrams: number | null;
  carbsGoalGrams: number | null;
  fibreGoalGrams: number | null;
  /** How fibre contributes to the macro-derived calorie estimate. */
  fibreCalorieApproach: FibreCalorieApproach;
  calorieTolerancePercent: number;
  graphToleranceCalories: number;
  perModelConfig: Record<string, ModelConfig>;
  healthConnectAutoSync: boolean;
};

// ---------------------------------------------------------------------------
// llama.cpp advanced options
//
// Types, defaults and validation live in lib/llamaCppConfig.ts (a pure module
// with no react-native deps) so they can be unit-tested under Node. They are
// re-exported here for convenience alongside the rest of the storage types.
//
// Each field maps 1:1 to a llama-server CLI flag / llama.rn context param:
// https://github.com/mybigday/llama.rn
// ---------------------------------------------------------------------------

export type {
  LlamaCppFlashAttn,
  LlamaCppReasoning,
  LlamaCppCacheType,
  LlamaCppAdvancedConfig,
} from "@/lib/llamaCppConfig";
export {
  DEFAULT_LLAMA_CPP_CONFIG,
  normalizeLlamaCppConfig,
} from "@/lib/llamaCppConfig";
import type { LlamaCppAdvancedConfig } from "@/lib/llamaCppConfig";
import {
  DEFAULT_LLAMA_CPP_CONFIG,
  normalizeLlamaCppConfig,
} from "@/lib/llamaCppConfig";

export type ModelConfig = {
  temperature: number;
  maxTokens: number;
  topK: number;
  topP: number;
  backend: "cpu";
  enableSpeculativeDecoding: boolean;
  /** Advanced llama.cpp options. Ignored by the LiteRT backend. */
  llamaCpp?: Partial<LlamaCppAdvancedConfig>;
};

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  temperature: DEFAULT_MODEL_TEMPERATURE,
  maxTokens: DEFAULT_MODEL_MAX_TOKENS,
  topK: DEFAULT_MODEL_TOP_K,
  topP: DEFAULT_MODEL_TOP_P,
  backend: DEFAULT_MODEL_BACKEND,
  enableSpeculativeDecoding: false,
  llamaCpp: { ...DEFAULT_LLAMA_CPP_CONFIG },
};

export const STORAGE_KEY = CONST_STORAGE_KEY;

export const DEFAULT_DATA: StoredData = {
  favouriteQuickAdds: [],
  modelPath: null,
  estimateModelPath: null,
  inferenceBackend: DEFAULT_INFERENCE_BACKEND,
  systemPrompt: `You are a nutrition assistant.

  Return JSON only.

  Format:
  {
    "items": [
      {
        "name": "food item",
        "calories": number,
        "protein": number,
        "carbs": number,
        "fat": number,
        "fibre": number
      }
    ]
  }`,
  quickLogMacrosExpanded: false,
  baseTarget: DEFAULT_BASE_TARGET_CALORIES,
  caloriesPerKg: DEFAULT_CALORIES_PER_KG,
  goalPhase: PHASE_MAINTAIN,
  cutAdjustmentType: ADJUSTMENT_TYPE_KCAL,
  cutCalorieAdjustment: DEFAULT_CALORIE_ADJUSTMENT,
  cutPercentPerWeek: DEFAULT_PERCENT_PER_WEEK,
  bulkAdjustmentType: ADJUSTMENT_TYPE_KCAL,
  bulkCalorieAdjustment: DEFAULT_CALORIE_ADJUSTMENT,
  bulkPercentPerWeek: DEFAULT_PERCENT_PER_WEEK,
  metabolismSex: DEFAULT_SEX,
  metabolismAgeYears: null,
  metabolismHeightCm: null,
  metabolismBodyFatPercent: null,
  manualBodyFatPercent: null,
  activityLevel: DEFAULT_ACTIVITY_LEVEL,
  manualWeightKg: null,
  lastWeightSyncAt: null,
  lastBodyFatSyncAt: null,
  proteinGoalGrams: null,
  fatGoalGrams: null,
  carbsGoalGrams: null,
  fibreGoalGrams: null,
  fibreCalorieApproach: DEFAULT_FIBRE_CALORIE_APPROACH,
  calorieTolerancePercent: DEFAULT_CALORIE_TOLERANCE_PERCENT,
  graphToleranceCalories: DEFAULT_GRAPH_TOLERANCE_CALORIES,
  perModelConfig: {},
  healthConnectAutoSync: false,
};

let cachedData: StoredData | null = null;
const DEFAULT_WRITE_DEBOUNCE_MS = 400;

type LoadStoredDataOptions = {
  forceReload?: boolean;
  flushPendingWrites?: boolean;
};

type SaveStoredDataOptions = {
  immediate?: boolean;
  debounceMs?: number;
};

function normalizeStoredData(parsed: Partial<StoredData>): StoredData {
  return {
    ...DEFAULT_DATA,
    ...parsed,
    favouriteQuickAdds: parsed.favouriteQuickAdds ?? [],
    inferenceBackend: parsed.inferenceBackend ?? DEFAULT_INFERENCE_BACKEND,
    fibreCalorieApproach:
      parsed.fibreCalorieApproach ?? DEFAULT_FIBRE_CALORIE_APPROACH,
    perModelConfig: normalizePerModelConfig(parsed.perModelConfig),
  };
}

function normalizePerModelConfig(
  configs: Record<string, ModelConfig> | undefined,
): Record<string, ModelConfig> {
  if (!configs) return {};
  const normalized: Record<string, ModelConfig> = {};
  for (const [key, config] of Object.entries(configs)) {
    normalized[key] = {
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      topK: config.topK,
      topP: config.topP,
      backend: config.backend ?? "cpu",
      enableSpeculativeDecoding: config.enableSpeculativeDecoding ?? false,
      llamaCpp: normalizeLlamaCppConfig(config.llamaCpp),
    };
  }
  return normalized;
}

export function getCachedData() {
  return cachedData;
}

/**
 * Synchronously update the in-memory cache of stored data WITHOUT writing to
 * disk.
 *
 * Other screens read this cache on focus via `loadStoredData()` (which returns
 * `cachedData` when present). The actual persisted write is still debounced via
 * `saveStoredData()`, so there is a window — up to ~500ms in Settings — during
 * which `cachedData` lags behind the editing screen's local React state.
 *
 * Priming the cache here ensures other tabs observe edits immediately on
 * focus. This fixes stale reads when the user makes a change in one tab (e.g.
 * selecting a model in Settings) and quickly navigates to another tab (e.g.
 * Log) before the debounced save fires.
 */
export function primeStoredDataCache(next: StoredData) {
  cachedData = next;
}

function commitStoredData(next: StoredData) {
  kvStore.set(STORAGE_KEY, JSON.stringify(next));
}

const deferredStoredDataWriter = createDeferredWriter(
  commitStoredData,
  DEFAULT_WRITE_DEBOUNCE_MS,
);

export async function flushPendingStoredDataWrites() {
  if (!deferredStoredDataWriter.hasPendingWrite()) return;
  await deferredStoredDataWriter.flush();
}

export async function loadStoredData(options: LoadStoredDataOptions = {}) {
  const { forceReload = false, flushPendingWrites = false } = options;

  if (flushPendingWrites) {
    await flushPendingStoredDataWrites();
  }

  if (!forceReload && cachedData) {
    return cachedData;
  }

  const stored = kvStore.getString(STORAGE_KEY) ?? null;
  let next = DEFAULT_DATA;
  if (stored) {
    try {
      next = normalizeStoredData(JSON.parse(stored) as Partial<StoredData>);
    } catch (error) {
      console.warn("Failed to parse stored settings, using defaults.", error);
    }
  }
  cachedData = next;
  return next;
}

export async function saveStoredData(
  next: StoredData,
  options: SaveStoredDataOptions = {},
) {
  const { immediate = false, debounceMs = DEFAULT_WRITE_DEBOUNCE_MS } = options;

  cachedData = next;
  await deferredStoredDataWriter.schedule(next, { immediate, debounceMs });
}

// ── MealEntry type (re-exported for screen use) ─────────────────────────
export type MealEntry = {
  id: string;
  title: string;
  calories: number;
  proteinGrams?: number | null;
  fatGrams?: number | null;
  carbsGrams?: number | null;
  fibreGrams?: number | null;
  loggedAt: string;
};
