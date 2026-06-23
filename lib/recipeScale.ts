import type { RecipeItem } from "@/db/index";

/** Round to `decimals` places. Strips floating-point noise such as
 *  14.5 * 0.5 + 29 * 0.5 = 21.750000000000004 without throwing away the real
 *  precision that rounding to whole numbers or a single decimal would. */
export function roundTo(n: number, decimals: number): number {
  const p = 10 ** decimals;
  return Math.round(n * p) / p;
}

/** Decimal places retained for scaled recipe calories and macros. Two places
 *  is far beyond any nutrition display need, yet it removes float artifacts
 *  and keeps repeated rescaling (e.g. editing an item's grams back and forth)
 *  accurate enough that round-trips return to the original value. Values that
 *  need coarser storage — meals store integer calories — round down further
 *  at the point they are logged. */
export const SCALE_DECIMALS = 2;

/** Scale a recipe item's calories and macros by `factor` (e.g. 0.5 for half
 *  a portion). Null macros stay null; numeric values keep `SCALE_DECIMALS`
 *  places of precision so repeated scaling does not erode them. Calories are
 *  clamped to a minimum of 0. */
export function scaleRecipeItem(item: RecipeItem, factor: number): RecipeItem {
  const scaleNum = (n: number | null | undefined) =>
    typeof n === "number" ? roundTo(n * factor, SCALE_DECIMALS) : null;
  return {
    title: item.title,
    calories: Math.max(0, roundTo(item.calories * factor, SCALE_DECIMALS)),
    proteinGrams: scaleNum(item.proteinGrams),
    fatGrams: scaleNum(item.fatGrams),
    carbsGrams: scaleNum(item.carbsGrams),
    fibreGrams: scaleNum(item.fibreGrams),
  };
}

export type ScaledRecipeTotals = {
  calories: number;
  proteinGrams: number;
  fatGrams: number;
  carbsGrams: number;
  fibreGrams: number;
  items: RecipeItem[];
};

/** Scale every item of a recipe by `factor` and sum the results into totals.
 *  Item values keep full scale precision; the totals are rounded for display
 *  (whole-number calories, 1-decimal macros). Macros that were null on every
 *  item collapse to 0 in the totals. */
export function sumScaledRecipe(
  items: RecipeItem[],
  factor: number,
): ScaledRecipeTotals {
  const scaled = items.map((i) => scaleRecipeItem(i, factor));
  return {
    items: scaled,
    calories: Math.round(scaled.reduce((s, i) => s + i.calories, 0)),
    proteinGrams: roundTo(
      scaled.reduce((s, i) => s + (i.proteinGrams ?? 0), 0),
      1,
    ),
    fatGrams: roundTo(
      scaled.reduce((s, i) => s + (i.fatGrams ?? 0), 0),
      1,
    ),
    carbsGrams: roundTo(
      scaled.reduce((s, i) => s + (i.carbsGrams ?? 0), 0),
      1,
    ),
    fibreGrams: roundTo(
      scaled.reduce((s, i) => s + (i.fibreGrams ?? 0), 0),
      1,
    ),
  };
}

/** Derive the per-portion scale factor for a recipe that makes `servings`
 *  portions when the user logs `portionsEaten`. Guards against zero/negative
 *  servings by falling back to 1. */
export function portionFactor(servings: number, portionsEaten: number): number {
  const safeServings = servings > 0 ? servings : 1;
  return portionsEaten / safeServings;
}

/** Rescale a recipe item's calories and macros from one gram weight to
 *  another, preserving the item's kcal/g density. Macros that were null stay
 *  null (so an item with no macros doesn't suddenly gain zeros).
 *
 *  Scaling preserves full precision (see SCALE_DECIMALS), so editing grams
 *  back and forth is effectively lossless. If `fromGrams` is missing/<=0
 *  there is no reference density, so the item is returned unchanged except
 *  for the new `grams` value — this lets the first grams entry establish
 *  "these calories are for this many grams". */
export function rescaleByGrams(
  item: RecipeItem,
  fromGrams: number | null | undefined,
  toGrams: number,
): RecipeItem {
  const from = typeof fromGrams === "number" && fromGrams > 0 ? fromGrams : 0;
  if (from > 0 && toGrams > 0 && toGrams !== from) {
    return { ...scaleRecipeItem(item, toGrams / from), grams: toGrams };
  }
  return { ...item, grams: toGrams };
}
