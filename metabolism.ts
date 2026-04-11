import type { ActivityLevel, MetabolismSex } from './storage';

const ACTIVITY_FACTOR_BY_LEVEL: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  heavy: 1.725,
  athlete: 1.9,
  'very-active': 1.725,
  'extra-active': 1.9,
  active: 1.725,
};

type MetabolismInput = {
  weightKg: number | null;
  heightCm: number | null;
  ageYears: number | null;
  sex: MetabolismSex;
  activityLevel: ActivityLevel;
};

export type MetabolismMetrics = {
  bmr: number | null;
  tdee: number | null;
  maintenanceCalories: number | null;
};

function isPositiveNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

export function getActivityFactor(activityLevel: ActivityLevel) {
  return ACTIVITY_FACTOR_BY_LEVEL[activityLevel];
}

export function estimateMetabolism(input: MetabolismInput): MetabolismMetrics {
  const { weightKg, heightCm, ageYears, sex, activityLevel } = input;

  if (!isPositiveNumber(weightKg) || !isPositiveNumber(heightCm) || !isPositiveNumber(ageYears) || sex === 'unspecified') {
    return { bmr: null, tdee: null, maintenanceCalories: null };
  }

  const sexOffset = sex === 'male' ? 5 : -161;
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * ageYears + sexOffset;
  const tdee = bmr * getActivityFactor(activityLevel);

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    maintenanceCalories: Math.round(tdee),
  };
}
