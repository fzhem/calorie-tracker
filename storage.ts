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

export type WeightPoint = {
  recordedAt: string;
  weightKg: number;
  source: 'manual' | 'health-connect';
};

export type StoredData = {
  entries: MealEntry[];
  favoriteQuickAdds: FavoriteQuickAdd[];
  baseTarget: number;
  caloriesPerKg: number;
  manualWeightKg: number | null;
  weightHistory: WeightPoint[];
  lastWeightSyncAt: string | null;
  lastCalorieSyncAt: string | null;
};

export const STORAGE_KEY = 'calorie-tracker-storage-v1';

export const DEFAULT_DATA: StoredData = {
  entries: [],
  favoriteQuickAdds: [],
  baseTarget: 2100,
  caloriesPerKg: 30,
  manualWeightKg: null,
  weightHistory: [],
  lastWeightSyncAt: null,
  lastCalorieSyncAt: null,
};
