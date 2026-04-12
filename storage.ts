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

export type MetabolismSex = 'unspecified' | 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'heavy' | 'athlete' | 'very-active' | 'extra-active' | 'active';
export type GoalPhase = 'maintain' | 'cut' | 'bulk';
export type GoalAdjustmentType = 'kcal' | 'percent';

export type WeightPoint = {
  recordedAt: string;
  weightKg: number;
  source: 'manual' | 'health-connect';
  originAppId?: string;
  originAppName?: string;
  originDevice?: string;
};

export type BodyFatPoint = {
  recordedAt: string;
  bodyFatPercentage: number;
  source: 'health-connect';
  originAppId?: string;
  originAppName?: string;
  originDevice?: string;
};

export type StoredData = {
  entries: MealEntry[];
  favoriteQuickAdds: FavoriteQuickAdd[];
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
};

export const STORAGE_KEY = 'calorie-tracker-storage-v1';

export const DEFAULT_DATA: StoredData = {
  entries: [],
  favoriteQuickAdds: [],
  baseTarget: 2100,
  caloriesPerKg: 30,
  goalPhase: 'maintain',
  cutAdjustmentType: 'kcal',
  cutCalorieAdjustment: 500,
  cutPercentPerWeek: 1,
  bulkAdjustmentType: 'kcal',
  bulkCalorieAdjustment: 500,
  bulkPercentPerWeek: 1,
  metabolismSex: 'male',
  metabolismAgeYears: null,
  metabolismHeightCm: null,
  activityLevel: 'moderate',
  manualWeightKg: null,
  weightHistory: [],
  bodyFatHistory: [],
  lastWeightSyncAt: null,
  lastBodyFatSyncAt: null,
  proteinGoalGrams: null,
  fatGoalGrams: null,
  carbsGoalGrams: null,
  fiberGoalGrams: null,
};
