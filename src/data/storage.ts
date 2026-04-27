import { kvStore } from "../lib/kvStore";
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
  PHASE_MAINTAIN,
  ADJUSTMENT_TYPE_KCAL,
} from "../constants";


export type FavoriteQuickAdd = {
  title: string;
  calories: number;
  proteinGrams?: number | null;
  fatGrams?: number | null;
  carbsGrams?: number | null;
  fiberGrams?: number | null;
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
  favoriteQuickAdds: FavoriteQuickAdd[];
  modelPath: string | null;
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
  activityLevel: ActivityLevel;
  manualWeightKg: number | null;
  lastWeightSyncAt: string | null;
  lastBodyFatSyncAt: string | null;
  proteinGoalGrams: number | null;
  fatGoalGrams: number | null;
  carbsGoalGrams: number | null;
  fiberGoalGrams: number | null;
  calorieTolerancePercent: number;
  graphToleranceCalories: number;
  perModelConfig: Record<string, ModelConfig>;
  healthConnectAutoSync: boolean;
};

export type ModelConfig = {
  temperature: number;
  maxTokens: number;
  topK: number;
  topP: number;
  backend: "cpu" | "gpu" | "npu";
};

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  temperature: DEFAULT_MODEL_TEMPERATURE,
  maxTokens: DEFAULT_MODEL_MAX_TOKENS,
  topK: DEFAULT_MODEL_TOP_K,
  topP: DEFAULT_MODEL_TOP_P,
  backend: DEFAULT_MODEL_BACKEND,
};

export const STORAGE_KEY = CONST_STORAGE_KEY;

export const DEFAULT_DATA: StoredData = {
  favoriteQuickAdds: [],
  modelPath: null,
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
  activityLevel: DEFAULT_ACTIVITY_LEVEL,
  manualWeightKg: null,
  lastWeightSyncAt: null,
  lastBodyFatSyncAt: null,
  proteinGoalGrams: null,
  fatGoalGrams: null,
  carbsGoalGrams: null,
  fiberGoalGrams: null,
  calorieTolerancePercent: DEFAULT_CALORIE_TOLERANCE_PERCENT,
  graphToleranceCalories: DEFAULT_GRAPH_TOLERANCE_CALORIES,
  perModelConfig: {},
  healthConnectAutoSync: false,
};

let cachedData: StoredData | null = null;

function normalizeStoredData(parsed: Partial<StoredData>): StoredData {
  return {
    ...DEFAULT_DATA,
    ...parsed,
    favoriteQuickAdds: parsed.favoriteQuickAdds ?? [],
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
    };
  }
  return normalized;
}

export function getCachedData() {
  return cachedData;
}

export async function loadStoredData() {
  const stored = kvStore.getString(STORAGE_KEY) ?? null;
  const next = stored
    ? normalizeStoredData(JSON.parse(stored) as Partial<StoredData>)
    : DEFAULT_DATA;
  cachedData = next;
  return next;
}

export async function saveStoredData(next: StoredData) {
  cachedData = next;
  kvStore.set(STORAGE_KEY, JSON.stringify(next));
}


// ── MealEntry type (re-exported for screen use) ─────────────────────────
export type MealEntry = {
  id: string;
  title: string;
  calories: number;
  proteinGrams?: number | null;
  fatGrams?: number | null;
  carbsGrams?: number | null;
  fiberGrams?: number | null;
  loggedAt: string;
};
