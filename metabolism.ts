import type { ActivityLevel, GoalAdjustmentType, GoalPhase, MetabolismSex, StoredData } from './storage';

const KCAL_PER_KG_BODY_WEIGHT = 7700;

const ACTIVITY_FACTOR_BY_LEVEL: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  heavy: 1.725,
  athlete: 1.9,
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

export type MacroTargets = {
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
};

function isPositiveNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

export function getActivityFactor(activityLevel: ActivityLevel) {
  return ACTIVITY_FACTOR_BY_LEVEL[activityLevel];
}

export function getGoalCalorieDelta(
  goalPhase: GoalPhase,
  options?: {
    adjustmentType?: GoalAdjustmentType;
    adjustmentKcal?: number;
    percentPerWeek?: number;
    weightKg?: number | null;
  },
) {
  const safeAdjustmentKcal = Math.max(0, Math.round(options?.adjustmentKcal ?? 500));
  const safePercentPerWeek = Math.max(0, options?.percentPerWeek ?? 1);
  const weightKg = options?.weightKg;

  let dailyDelta = safeAdjustmentKcal;
  if (options?.adjustmentType === 'percent' && typeof weightKg === 'number' && Number.isFinite(weightKg) && weightKg > 0) {
    // Convert target weekly body-weight change into a daily kcal adjustment.
    const weeklyKgDelta = weightKg * (safePercentPerWeek / 100);
    dailyDelta = Math.round((weeklyKgDelta * KCAL_PER_KG_BODY_WEIGHT) / 7);
  }

  if (goalPhase === 'cut') return -dailyDelta;
  if (goalPhase === 'bulk') return dailyDelta;
  return 0;
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

export function getAdjustedCalorieTarget(data: StoredData) {
  const latestHealthConnectWeight = data.weightHistory.find((point) => point.source === 'health-connect')?.weightKg ?? null;
  const effectiveWeightKg = data.manualWeightKg ?? latestHealthConnectWeight;

  const metabolism = estimateMetabolism({
    weightKg: effectiveWeightKg,
    heightCm: data.metabolismHeightCm,
    ageYears: data.metabolismAgeYears,
    sex: data.metabolismSex,
    activityLevel: data.activityLevel,
  });

  const goalDelta = getGoalCalorieDelta(data.goalPhase ?? 'maintain', {
    adjustmentType:
      data.goalPhase === 'cut'
        ? (data.cutAdjustmentType ?? 'kcal')
        : (data.goalPhase === 'bulk' ? (data.bulkAdjustmentType ?? 'kcal') : 'kcal'),
    adjustmentKcal:
      data.goalPhase === 'cut'
        ? (data.cutCalorieAdjustment ?? 500)
        : (data.goalPhase === 'bulk' ? (data.bulkCalorieAdjustment ?? 500) : 500),
    percentPerWeek:
      data.goalPhase === 'cut'
        ? (data.cutPercentPerWeek ?? 1)
        : (data.goalPhase === 'bulk' ? (data.bulkPercentPerWeek ?? 1) : 1),
    weightKg: effectiveWeightKg,
  });

  const baseCalculatedTarget = metabolism.maintenanceCalories
    ?? (effectiveWeightKg ? Math.round(effectiveWeightKg * data.caloriesPerKg) : data.baseTarget);
  const adjustedTarget = Math.round(baseCalculatedTarget + goalDelta);

  return {
    adjustedTarget,
    baseCalculatedTarget,
    goalDelta,
    metabolism,
    effectiveWeightKg,
  };
}

export function getAutoMacroTargets(calories: number, goalPhase: GoalPhase): MacroTargets {
  const safeCalories = Math.max(0, Math.round(calories));

  // Use a simple phase-aware split with slightly higher protein for cuts
  // and higher carbs for bulks.
  let proteinRatio = 0.3;
  let carbsRatio = 0.4;
  let fatRatio = 0.3;

  if (goalPhase === 'cut') {
    proteinRatio = 0.35;
    carbsRatio = 0.35;
    fatRatio = 0.3;
  } else if (goalPhase === 'bulk') {
    proteinRatio = 0.3;
    carbsRatio = 0.45;
    fatRatio = 0.25;
  }

  return {
    proteinGrams: Math.round((safeCalories * proteinRatio) / 4),
    carbsGrams: Math.round((safeCalories * carbsRatio) / 4),
    fatGrams: Math.round((safeCalories * fatRatio) / 9),
  };
}
