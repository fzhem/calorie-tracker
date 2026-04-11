export type MealEntry = {
  id: string;
  title: string;
  calories: number;
  loggedAt: string;
};

export type WeightPoint = {
  recordedAt: string;
  weightKg: number;
  source: 'manual' | 'health-connect';
};

export type StoredData = {
  entries: MealEntry[];
  baseTarget: number;
  caloriesPerKg: number;
  manualWeightKg: number | null;
  weightHistory: WeightPoint[];
  lastWeightSyncAt: string | null;
};

export const STORAGE_KEY = 'calorie-tracker-storage-v1';

export const DEFAULT_DATA: StoredData = {
  entries: [],
  baseTarget: 2100,
  caloriesPerKg: 30,
  manualWeightKg: null,
  weightHistory: [],
  lastWeightSyncAt: null,
};
