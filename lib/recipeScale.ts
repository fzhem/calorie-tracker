import type { RecipeItem } from "@/db/index";

/** Round to 1 decimal place to avoid floating-point display artifacts
 *  (e.g. 14.5 * 0.5 + 29 * 0.5 = 21.750000000000004). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Scale a recipe item's calories and macros by `factor` (e.g. 0.5 for half
 *  a portion). Null macros stay null; values are rounded to 1 decimal place.
 *  Calories are clamped to a minimum of 0. */
export function scaleRecipeItem(item: RecipeItem, factor: number): RecipeItem {
  const scaleNum = (n: number | null | undefined) =>
    typeof n === "number" ? round1(n * factor) : null;
  return {
    title: item.title,
    calories: Math.max(0, Math.round(item.calories * factor)),
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
 *  Macros that were null on every item collapse to 0 in the totals. */
export function sumScaledRecipe(
  items: RecipeItem[],
  factor: number,
): ScaledRecipeTotals {
  const scaled = items.map((i) => scaleRecipeItem(i, factor));
  return {
    items: scaled,
    calories: scaled.reduce((s, i) => s + i.calories, 0),
    proteinGrams: round1(scaled.reduce((s, i) => s + (i.proteinGrams ?? 0), 0)),
    fatGrams: round1(scaled.reduce((s, i) => s + (i.fatGrams ?? 0), 0)),
    carbsGrams: round1(scaled.reduce((s, i) => s + (i.carbsGrams ?? 0), 0)),
    fibreGrams: round1(scaled.reduce((s, i) => s + (i.fibreGrams ?? 0), 0)),
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
 *  If `fromGrams` is missing/<=0 there is no reference density, so the item is
 *  returned unchanged except for the new `grams` value — this lets the first
 *  grams entry establish "these calories are for this many grams". */
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
