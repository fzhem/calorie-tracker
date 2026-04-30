import type {
  ActivityLevel,
  GoalAdjustmentType,
  GoalPhase,
  MetabolismSex,
  StoredData,
} from "@/data/storage";
import {
  KCAL_PER_KG_BODY_WEIGHT,
  ACTIVITY_FACTOR_BY_LEVEL,
  BMR_WEIGHT_COEFF,
  BMR_HEIGHT_COEFF,
  BMR_AGE_COEFF,
  BMR_MALE_OFFSET,
  BMR_FEMALE_OFFSET,
  CALORIES_PER_GRAM_PROTEIN,
  CALORIES_PER_GRAM_CARBS,
  CALORIES_PER_GRAM_FAT,
  DEFAULT_MACRO_RATIOS,
  DEFAULT_CALORIE_ADJUSTMENT,
  DEFAULT_PERCENT_PER_WEEK,
  PHASE_CUT,
  PHASE_BULK,
  PHASE_MAINTAIN,
  ADJUSTMENT_TYPE_KCAL,
  ADJUSTMENT_TYPE_PERCENT,
  SEX_UNSPECIFIED,
  SEX_MALE,
} from "@/constants";

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
  const safeAdjustmentKcal = Math.max(
    0,
    Math.round(options?.adjustmentKcal ?? DEFAULT_CALORIE_ADJUSTMENT),
  );
  const safePercentPerWeek = Math.max(
    0,
    options?.percentPerWeek ?? DEFAULT_PERCENT_PER_WEEK,
  );
  const weightKg = options?.weightKg;

  let dailyDelta = safeAdjustmentKcal;
  if (
    options?.adjustmentType === ADJUSTMENT_TYPE_PERCENT &&
    typeof weightKg === "number" &&
    Number.isFinite(weightKg) &&
    weightKg > 0
  ) {
    // Convert target weekly body-weight change into a daily kcal adjustment.
    const weeklyKgDelta = weightKg * (safePercentPerWeek / 100);
    dailyDelta = Math.round((weeklyKgDelta * KCAL_PER_KG_BODY_WEIGHT) / 7);
  }

  if (goalPhase === PHASE_CUT) return -dailyDelta;
  if (goalPhase === PHASE_BULK) return dailyDelta;
  return 0;
}

export function estimateMetabolism(input: MetabolismInput): MetabolismMetrics {
  const { weightKg, heightCm, ageYears, sex, activityLevel } = input;

  if (
    !isPositiveNumber(weightKg) ||
    !isPositiveNumber(heightCm) ||
    !isPositiveNumber(ageYears) ||
    sex === SEX_UNSPECIFIED
  ) {
    return { bmr: null, tdee: null, maintenanceCalories: null };
  }

  const sexOffset = sex === SEX_MALE ? BMR_MALE_OFFSET : BMR_FEMALE_OFFSET;
  const bmr =
    BMR_WEIGHT_COEFF * weightKg +
    BMR_HEIGHT_COEFF * heightCm -
    BMR_AGE_COEFF * ageYears +
    sexOffset;
  const tdee = bmr * getActivityFactor(activityLevel);

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    maintenanceCalories: Math.round(tdee),
  };
}

export function getAdjustedCalorieTarget(
  data: StoredData,
  latestHealthConnectWeightKg?: number | null,
) {
  const effectiveWeightKg =
    data.manualWeightKg ?? latestHealthConnectWeightKg ?? null;

  const metabolism = estimateMetabolism({
    weightKg: effectiveWeightKg,
    heightCm: data.metabolismHeightCm,
    ageYears: data.metabolismAgeYears,
    sex: data.metabolismSex,
    activityLevel: data.activityLevel,
  });

  const goalDelta = getGoalCalorieDelta(data.goalPhase ?? PHASE_MAINTAIN, {
    adjustmentType:
      data.goalPhase === PHASE_CUT
        ? (data.cutAdjustmentType ?? ADJUSTMENT_TYPE_KCAL)
        : data.goalPhase === PHASE_BULK
          ? (data.bulkAdjustmentType ?? ADJUSTMENT_TYPE_KCAL)
          : ADJUSTMENT_TYPE_KCAL,
    adjustmentKcal:
      data.goalPhase === PHASE_CUT
        ? (data.cutCalorieAdjustment ?? DEFAULT_CALORIE_ADJUSTMENT)
        : data.goalPhase === PHASE_BULK
          ? (data.bulkCalorieAdjustment ?? DEFAULT_CALORIE_ADJUSTMENT)
          : DEFAULT_CALORIE_ADJUSTMENT,
    percentPerWeek:
      data.goalPhase === PHASE_CUT
        ? (data.cutPercentPerWeek ?? DEFAULT_PERCENT_PER_WEEK)
        : data.goalPhase === PHASE_BULK
          ? (data.bulkPercentPerWeek ?? DEFAULT_PERCENT_PER_WEEK)
          : DEFAULT_PERCENT_PER_WEEK,
    weightKg: effectiveWeightKg,
  });

  const baseCalculatedTarget =
    metabolism.maintenanceCalories ??
    (effectiveWeightKg
      ? Math.round(effectiveWeightKg * data.caloriesPerKg)
      : data.baseTarget);
  const adjustedTarget = Math.round(baseCalculatedTarget + goalDelta);

  return {
    adjustedTarget,
    baseCalculatedTarget,
    goalDelta,
    metabolism,
    effectiveWeightKg,
  };
}

export function getAutoMacroTargets(
  calories: number,
  goalPhase: GoalPhase,
): MacroTargets {
  const safeCalories = Math.max(0, Math.round(calories));

  // Use a simple phase-aware split with slightly higher protein for cuts
  // and higher carbs for bulks.
  const ratio =
    goalPhase === PHASE_CUT
      ? DEFAULT_MACRO_RATIOS.cut
      : goalPhase === PHASE_BULK
        ? DEFAULT_MACRO_RATIOS.bulk
        : DEFAULT_MACRO_RATIOS.maintain;

  return {
    proteinGrams: Math.round(
      (safeCalories * ratio.protein) / CALORIES_PER_GRAM_PROTEIN,
    ),
    carbsGrams: Math.round(
      (safeCalories * ratio.carbs) / CALORIES_PER_GRAM_CARBS,
    ),
    fatGrams: Math.round((safeCalories * ratio.fat) / CALORIES_PER_GRAM_FAT),
  };
}
