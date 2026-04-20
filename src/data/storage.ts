import { kvStore } from "../lib/kvStore";

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
  entries: MealEntry[];
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
  weightHistory: WeightPoint[];
  bodyFatHistory: BodyFatPoint[];
  lastWeightSyncAt: string | null;
  lastBodyFatSyncAt: string | null;
  proteinGoalGrams: number | null;
  fatGoalGrams: number | null;
  carbsGoalGrams: number | null;
  fiberGoalGrams: number | null;
  calorieTolerancePercent: number;
  graphToleranceCalories: number;
  perModelConfig: Record<string, ModelConfig>;
};

export type ModelConfig = {
  temperature: number;
  maxTokens: number;
  topK: number;
  topP: number;
};

export const STORAGE_KEY = "calorie-tracker-storage-v1";

export const DEFAULT_DATA: StoredData = {
  entries: [],
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
  baseTarget: 2100,
  caloriesPerKg: 30,
  goalPhase: "maintain",
  cutAdjustmentType: "kcal",
  cutCalorieAdjustment: 500,
  cutPercentPerWeek: 1,
  bulkAdjustmentType: "kcal",
  bulkCalorieAdjustment: 500,
  bulkPercentPerWeek: 1,
  metabolismSex: "male",
  metabolismAgeYears: null,
  metabolismHeightCm: null,
  activityLevel: "moderate",
  manualWeightKg: null,
  weightHistory: [],
  bodyFatHistory: [],
  lastWeightSyncAt: null,
  lastBodyFatSyncAt: null,
  proteinGoalGrams: null,
  fatGoalGrams: null,
  carbsGoalGrams: null,
  fiberGoalGrams: null,
  calorieTolerancePercent: 12,
  graphToleranceCalories: 100,
  perModelConfig: {},
};

let cachedData: StoredData | null = null;

function normalizeStoredData(parsed: Partial<StoredData>): StoredData {
  return {
    ...DEFAULT_DATA,
    ...parsed,
    entries: parsed.entries ?? [],
    favoriteQuickAdds: parsed.favoriteQuickAdds ?? [],
    weightHistory: parsed.weightHistory ?? [],
    bodyFatHistory: parsed.bodyFatHistory ?? [],
  };
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
