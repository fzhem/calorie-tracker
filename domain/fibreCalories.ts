import type { FibreCalorieApproach } from "@/constants";
import {
  CALORIES_PER_GRAM_PROTEIN,
  CALORIES_PER_GRAM_CARBS,
  CALORIES_PER_GRAM_FAT,
  FIBRE_CALORIE_APPROACH_FDA,
  FIBRE_CALORIE_APPROACH_NET,
  FIBRE_CALORIE_APPROACH_EU,
} from "@/constants";

/**
 * How each approach treats dietary fibre when deriving calories from macros.
 *
 * There are two independent things an approach must decide:
 *
 *   1. fibreIncludedInCarbs — does the "carbohydrate" figure already contain
 *      the fibre grams (so we must subtract before charging carbs), or is
 *      fibre reported separately (so the carbs figure should be used as-is)?
 *   2. fibreKcalPerGram — at what rate does the fibre itself contribute
 *      energy?
 *
 * Real-world label conventions:
 *
 *   FDA — US / USDA labels: "carbohydrate" is TOTAL carbs (includes fibre),
 *         and fibre is metabolised as an ordinary carb. Net effect: the fibre
 *         field is ignored — it is already inside the carbs figure and charged
 *         at the carb rate (4 kcal/g).
 *   NET — "net carbs" convention: carbohydrate is total (includes fibre) but
 *         fibre is treated as 0 kcal, so it is subtracted from the carbs
 *         bucket and contributes nothing.
 *   EU  — EU / FSANZ labels: "carbohydrate" EXCLUDES fibre (fibre is listed
 *         separately), and fibre is metabolised at ~2 kcal/g. So we do NOT
 *         subtract, and we add fibre back at 2 kcal/g.
 *
 * EU is the default because it best reflects actual metabolisable energy for
 * foods labelled under the EU/Aus convention.
 */
export const FIBRE_KCAL_PER_GRAM_BY_APPROACH: Record<
  FibreCalorieApproach,
  number
> = {
  [FIBRE_CALORIE_APPROACH_FDA]: 4,
  [FIBRE_CALORIE_APPROACH_NET]: 0,
  [FIBRE_CALORIE_APPROACH_EU]: 2,
};

/** Whether the "carbs" figure already includes the fibre grams. */
export const FIBRE_INCLUDED_IN_CARBS_BY_APPROACH: Record<
  FibreCalorieApproach,
  boolean
> = {
  // US / USDA labels report total carbohydrate (fibre included).
  [FIBRE_CALORIE_APPROACH_FDA]: true,
  [FIBRE_CALORIE_APPROACH_NET]: true,
  // EU / FSANZ labels report carbohydrate excluding fibre.
  [FIBRE_CALORIE_APPROACH_EU]: false,
};

export function getFibreKcalPerGram(
  approach: FibreCalorieApproach | null | undefined,
): number {
  if (!approach)
    return FIBRE_KCAL_PER_GRAM_BY_APPROACH[FIBRE_CALORIE_APPROACH_EU];
  return FIBRE_KCAL_PER_GRAM_BY_APPROACH[approach];
}

export function getFibreIncludedInCarbs(
  approach: FibreCalorieApproach | null | undefined,
): boolean {
  if (!approach)
    return FIBRE_INCLUDED_IN_CARBS_BY_APPROACH[FIBRE_CALORIE_APPROACH_EU];
  return FIBRE_INCLUDED_IN_CARBS_BY_APPROACH[approach];
}

export type MacroCalorieInput = {
  proteinGrams?: number | null;
  fatGrams?: number | null;
  carbsGrams?: number | null;
  fibreGrams?: number | null;
};

/**
 * Estimates total calories from macros, honouring the selected fibre approach.
 *
 * Returns `null` only when no macro information at all is present. When fibre
 * is provided without carbs, the fibre contribution is still applied at the
 * approach-specific rate (and the carbs bucket is clamped at 0 so the result
 * can never go negative for approaches that subtract fibre from carbs).
 */
export function getMacroCalories(
  item: MacroCalorieInput,
  approach: FibreCalorieApproach | null | undefined,
): number | null {
  const hasProtein = typeof item.proteinGrams === "number";
  const hasFat = typeof item.fatGrams === "number";
  const hasCarbs = typeof item.carbsGrams === "number";
  const hasFibre = typeof item.fibreGrams === "number";

  if (!hasProtein && !hasFat && !hasCarbs && !hasFibre) return null;

  const protein = item.proteinGrams ?? 0;
  const fat = item.fatGrams ?? 0;
  const carbs = item.carbsGrams ?? 0;
  const fibre = item.fibreGrams ?? 0;

  const fibreKcalPerGram = getFibreKcalPerGram(approach);
  const fibreIncludedInCarbs = getFibreIncludedInCarbs(approach);

  // For US / USDA / "net carb" conventions the reported carbohydrate figure
  // already contains the fibre, so subtract it before charging the carbs
  // bucket (and clamp at 0 so a meal reporting more fibre than carbs can't go
  // negative). For the EU convention fibre is reported separately, so the
  // carbs figure is used as-is and the fibre is re-added at its own rate.
  const carbsBucket = fibreIncludedInCarbs ? Math.max(0, carbs - fibre) : carbs;

  return (
    protein * CALORIES_PER_GRAM_PROTEIN +
    fat * CALORIES_PER_GRAM_FAT +
    carbsBucket * CALORIES_PER_GRAM_CARBS +
    fibre * fibreKcalPerGram
  );
}

export type MacroCalorieMismatch = {
  macroCalories: number;
  delta: number;
};

/**
 * Compares logged calories against the macro-derived estimate and returns a
 * mismatch descriptor when the two diverge beyond the given tolerance band.
 * Returns `null` when there are no macros to compare against, or when the
 * values are within tolerance.
 */
export function getMacroCalorieMismatch(
  calories: number,
  item: MacroCalorieInput,
  options: {
    approach?: FibreCalorieApproach | null;
    tolerancePercent?: number;
  } = {},
): MacroCalorieMismatch | null {
  const macroCalories = getMacroCalories(item, options.approach);
  if (macroCalories === null) return null;

  const roundedMacroCalories = Math.round(macroCalories);
  const delta = Math.round(calories - roundedMacroCalories);
  const tolerancePercent = options.tolerancePercent ?? 12;
  const tolerance = Math.round(calories * (tolerancePercent / 100));

  if (Math.abs(delta) <= tolerance) return null;
  return { macroCalories: roundedMacroCalories, delta };
}
