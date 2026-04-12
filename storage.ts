export type MealEntry = {
  id: string;
  title: string;
  calories: number;
  loggedAt: string;
  healthConnectSyncAt?: string | null;
};

export type FavoriteQuickAdd = {
  title: string;
  calories: number;
};

export type MetabolismSex = 'unspecified' | 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'heavy' | 'athlete' | 'very-active' | 'extra-active' | 'active';

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
  metabolismSex: MetabolismSex;
  metabolismAgeYears: number | null;
  metabolismHeightCm: number | null;
  activityLevel: ActivityLevel;
  manualWeightKg: number | null;
  weightHistory: WeightPoint[];
  bodyFatHistory: BodyFatPoint[];
  lastWeightSyncAt: string | null;
  lastBodyFatSyncAt: string | null;
  lastCalorieSyncAt: string | null;
};

export const STORAGE_KEY = 'calorie-tracker-storage-v1';

export const DEFAULT_DATA: StoredData = {
  entries: [],
  favoriteQuickAdds: [],
  baseTarget: 2100,
  caloriesPerKg: 30,
  metabolismSex: 'male',
  metabolismAgeYears: null,
  metabolismHeightCm: null,
  activityLevel: 'moderate',
  manualWeightKg: null,
  weightHistory: [],
  bodyFatHistory: [],
  lastWeightSyncAt: null,
  lastBodyFatSyncAt: null,
  lastCalorieSyncAt: null,
};
