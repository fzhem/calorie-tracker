import { test } from "node:test";
import assert from "node:assert/strict";
import {
  roundTo,
  scaleRecipeItem,
  sumScaledRecipe,
  portionFactor,
  rescaleByGrams,
} from "../lib/recipeScale";
import type { RecipeItem } from "../db/index";

const item: RecipeItem = {
  title: "Oatmeal",
  calories: 300,
  proteinGrams: 10,
  fatGrams: 5,
  carbsGrams: 50,
  fibreGrams: 8,
};

test("scaleRecipeItem scales calories and macros by the factor", () => {
  const half = scaleRecipeItem(item, 0.5);
  assert.equal(half.calories, 150);
  assert.equal(half.proteinGrams, 5);
  assert.equal(half.fatGrams, 2.5);
  assert.equal(half.carbsGrams, 25);
  assert.equal(half.fibreGrams, 4);
  assert.equal(half.title, "Oatmeal");
});

test("roundTo keeps the requested precision and removes float noise", () => {
  assert.equal(roundTo(21.750000000000004, 2), 21.75);
  assert.equal(roundTo(0.30000000000000004, 2), 0.3);
  assert.equal(roundTo(7.25, 2), 7.25);
});

test("scaleRecipeItem strips float artifacts without discarding precision", () => {
  // 14.5 * 0.5 is exactly 7.25; the old code rounded to 1 decimal (7.3) which
  // eroded values across repeated scaling. We now keep two decimals.
  const scaled = scaleRecipeItem(
    { title: "Mix", calories: 100, carbsGrams: 14.5 },
    0.5,
  );
  assert.equal(scaled.carbsGrams, 7.25);
});

test("scaleRecipeItem keeps null macros as null", () => {
  const scaled = scaleRecipeItem(
    { title: "Blank", calories: 200, proteinGrams: null },
    2,
  );
  assert.equal(scaled.calories, 400);
  assert.equal(scaled.proteinGrams, null);
  assert.equal(scaled.fatGrams, null);
});

test("scaleRecipeItem never returns negative calories", () => {
  const scaled = scaleRecipeItem(item, -1);
  assert.equal(scaled.calories, 0);
});

test("sumScaledRecipe totals scaled items", () => {
  const totals = sumScaledRecipe([item, item], 0.5);
  assert.equal(totals.calories, 300);
  assert.equal(totals.proteinGrams, 10);
  assert.equal(totals.fatGrams, 5);
  assert.equal(totals.carbsGrams, 50);
  assert.equal(totals.fibreGrams, 8);
  assert.equal(totals.items.length, 2);
});

test("portionFactor divides portions eaten by servings", () => {
  assert.equal(portionFactor(4, 1), 0.25);
  assert.equal(portionFactor(4, 2), 0.5);
  assert.equal(portionFactor(1, 1), 1);
});

test("portionFactor guards against zero/negative servings", () => {
  assert.equal(portionFactor(0, 2), 2);
  assert.equal(portionFactor(-3, 2), 2);
});

test("eating 1 of 4 servings logs a quarter of the recipe", () => {
  // A 2000 kcal recipe that makes 4 servings → one portion = 500 kcal.
  const recipeItems: RecipeItem[] = [
    {
      title: "Chili",
      calories: 2000,
      proteinGrams: 120,
      fatGrams: 40,
      carbsGrams: 200,
    },
  ];
  const totals = sumScaledRecipe(recipeItems, portionFactor(4, 1));
  assert.equal(totals.calories, 500);
  assert.equal(totals.proteinGrams, 30);
  assert.equal(totals.fatGrams, 10);
  assert.equal(totals.carbsGrams, 50);
});

test("rescaleByGrams scales calories and macros by the gram ratio", () => {
  const item: RecipeItem = {
    title: "Chicken",
    calories: 165,
    proteinGrams: 31,
    fatGrams: 3.6,
    carbsGrams: 0,
    grams: 100,
  };
  const doubled = rescaleByGrams(item, 100, 200);
  assert.equal(doubled.calories, 330);
  assert.equal(doubled.proteinGrams, 62);
  assert.equal(doubled.fatGrams, 7.2);
  assert.equal(doubled.carbsGrams, 0);
  assert.equal(doubled.grams, 200);
});

test("rescaleByGrams preserves kcal/g density", () => {
  const item: RecipeItem = {
    title: "Rice",
    calories: 130,
    proteinGrams: 2.7,
    fatGrams: 0.3,
    carbsGrams: 28,
    grams: 100,
  };
  // 100g → 130 kcal (1.3 kcal/g). Rescale to an odd weight and check density.
  const rescaled = rescaleByGrams(item, 100, 73);
  assert.equal(
    Math.round((rescaled.calories / rescaled.grams!) * 100) / 100,
    1.3,
  );
});

test("rescaleByGrams keeps null macros null", () => {
  const item: RecipeItem = { title: "X", calories: 200, grams: 50 };
  const rescaled = rescaleByGrams(item, 50, 150);
  assert.equal(rescaled.calories, 600);
  assert.equal(rescaled.proteinGrams, null);
  assert.equal(rescaled.fatGrams, null);
});

test("rescaleByGrams with no reference just records the grams", () => {
  // First grams entry on a legacy item: 300 kcal with no known weight.
  const item: RecipeItem = { title: "Oatmeal", calories: 300 };
  const rescaled = rescaleByGrams(item, null, 50);
  assert.equal(rescaled.calories, 300); // unchanged
  assert.equal(rescaled.grams, 50); // reference now established
});

test("rescaleByGrams ignores a non-positive target weight", () => {
  const item: RecipeItem = { title: "X", calories: 300, grams: 100 };
  const rescaled = rescaleByGrams(item, 100, 0);
  assert.equal(rescaled.calories, 300); // no rescale to zero
});

test("rescaleByGrams round-trips back to the original values", () => {
  // Editing an item's grams back and forth must not erode calories/macros —
  // this is the precision loss the recipe editor used to suffer from
  // (165 kcal would drift to 164 after a 100g -> 73g -> 100g round-trip).
  const item: RecipeItem = {
    title: "Chicken",
    calories: 165,
    proteinGrams: 31,
    fatGrams: 3.6,
    carbsGrams: 0,
    grams: 100,
  };
  const rescaled = rescaleByGrams(rescaleByGrams(item, 100, 73), 73, 100);
  assert.equal(rescaled.calories, 165);
  assert.equal(rescaled.proteinGrams, 31);
  assert.equal(rescaled.fatGrams, 3.6);
  assert.equal(rescaled.grams, 100);
});
