import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getFibreKcalPerGram,
  getFibreIncludedInCarbs,
  getMacroCalories,
  getMacroCalorieMismatch,
  FIBRE_KCAL_PER_GRAM_BY_APPROACH,
  FIBRE_INCLUDED_IN_CARBS_BY_APPROACH,
} from "../domain/fibreCalories";
import {
  FIBRE_CALORIE_APPROACH_FDA,
  FIBRE_CALORIE_APPROACH_NET,
  FIBRE_CALORIE_APPROACH_EU,
} from "../constants";

// Reference food A (rolled oats, per 100g): 13P / 67C (USDA: total, incl.
// 10g fibre) / 7F.
//
// Expected totals (see the approach table in the PR discussion):
//   FDA — 13*4 + 67*4 + 7*9 = 383        (fibre inside C, charged as carb)
//   NET — 13*4 + 57*4 + 7*9 = 343        (fibre subtracted, contributes 0)
//   EU  — 13*4 + 67*4 + 10*2 + 7*9 = 403 (C excludes fibre; fibre @ 2 kcal/g)
const OATS = {
  proteinGrams: 13,
  carbsGrams: 67,
  fibreGrams: 10,
  fatGrams: 7,
};

// Reference food B (prunes, per ~40g serving): 0.7P / 18.3C / 3.3 fibre / 0F.
// EU convention (carb excludes fibre), labelled 82 kcal. Regression case for
// the bug where EU was wrongly subtracting fibre from an already-exclusive
// carbs figure, producing 69 kcal instead of ~83.
const PRUNES = {
  proteinGrams: 0.7,
  carbsGrams: 18.3,
  fibreGrams: 3.3,
  fatGrams: 0,
};

test("fibre kcal/g factors match the documented approach table", () => {
  assert.equal(FIBRE_KCAL_PER_GRAM_BY_APPROACH[FIBRE_CALORIE_APPROACH_FDA], 4);
  assert.equal(FIBRE_KCAL_PER_GRAM_BY_APPROACH[FIBRE_CALORIE_APPROACH_NET], 0);
  assert.equal(FIBRE_KCAL_PER_GRAM_BY_APPROACH[FIBRE_CALORIE_APPROACH_EU], 2);
});

test("fibre-included-in-carbs flag matches label conventions", () => {
  assert.equal(
    FIBRE_INCLUDED_IN_CARBS_BY_APPROACH[FIBRE_CALORIE_APPROACH_FDA],
    true,
  );
  assert.equal(
    FIBRE_INCLUDED_IN_CARBS_BY_APPROACH[FIBRE_CALORIE_APPROACH_NET],
    true,
  );
  assert.equal(
    FIBRE_INCLUDED_IN_CARBS_BY_APPROACH[FIBRE_CALORIE_APPROACH_EU],
    false,
  );
});

test("getFibreKcalPerGram falls back to EU for null/undefined approach", () => {
  assert.equal(getFibreKcalPerGram(null), 2);
  assert.equal(getFibreKcalPerGram(undefined), 2);
  assert.equal(getFibreKcalPerGram(FIBRE_CALORIE_APPROACH_FDA), 4);
});

test("getFibreIncludedInCarbs falls back to EU for null/undefined approach", () => {
  assert.equal(getFibreIncludedInCarbs(null), false);
  assert.equal(getFibreIncludedInCarbs(undefined), false);
  assert.equal(getFibreIncludedInCarbs(FIBRE_CALORIE_APPROACH_FDA), true);
});

test("getMacroCalories reproduces the oats example for each approach", () => {
  assert.equal(getMacroCalories(OATS, FIBRE_CALORIE_APPROACH_FDA), 383);
  assert.equal(getMacroCalories(OATS, FIBRE_CALORIE_APPROACH_NET), 343);
  assert.equal(getMacroCalories(OATS, FIBRE_CALORIE_APPROACH_EU), 403);
});

test("getMacroCalories returns null when no macros are present", () => {
  for (const approach of [
    FIBRE_CALORIE_APPROACH_FDA,
    FIBRE_CALORIE_APPROACH_NET,
    FIBRE_CALORIE_APPROACH_EU,
  ] as const) {
    assert.equal(getMacroCalories({}, approach), null);
    assert.equal(getMacroCalories({ proteinGrams: null }, approach), null);
  }
});

test("FDA approach with no fibre is identical to the legacy 4-4-9 maths", () => {
  // Fibre absent: behaviour must not regress for users who never set fibre.
  const noFibre = { proteinGrams: 13, carbsGrams: 67, fatGrams: 7 };
  assert.equal(getMacroCalories(noFibre, FIBRE_CALORIE_APPROACH_FDA), 383);
  // And with fibre present under FDA, total is unchanged (fibre charged as carb).
  assert.equal(getMacroCalories(OATS, FIBRE_CALORIE_APPROACH_FDA), 383);
});

test("prunes regression: EU estimate matches the labelled 82 kcal (not 69)", () => {
  // Pre-fix the EU formula wrongly subtracted fibre from an already-exclusive
  // carbs figure: 0.7*4 + (18.3-3.3)*4 + 3.3*2 = 69.4 → 69 kcal.
  // Post-fix: 0.7*4 + 18.3*4 + 3.3*2 = 82.6 → 83 kcal, matching the label.
  assert.equal(getMacroCalories(PRUNES, FIBRE_CALORIE_APPROACH_EU), 82.6);
  assert.equal(
    Math.round(getMacroCalories(PRUNES, FIBRE_CALORIE_APPROACH_EU)!),
    83,
  );
});

test("prunes regression: at 82 logged kcal the EU mismatch warning is suppressed", () => {
  // This was the user-reported bug — the warning fired. After the fix it must
  // not, because the estimate (~83) is within the default 12% tolerance of 82.
  const result = getMacroCalorieMismatch(82, PRUNES, {
    approach: FIBRE_CALORIE_APPROACH_EU,
    tolerancePercent: 12,
  });
  assert.equal(result, null);
});

test("fibre without carbs still contributes at the approach rate (no negatives)", () => {
  // Only fibre reported. Must not go negative under any approach.
  const fibreOnly = { fibreGrams: 10 };
  assert.equal(getMacroCalories(fibreOnly, FIBRE_CALORIE_APPROACH_FDA), 40);
  assert.equal(getMacroCalories(fibreOnly, FIBRE_CALORIE_APPROACH_NET), 0);
  assert.equal(getMacroCalories(fibreOnly, FIBRE_CALORIE_APPROACH_EU), 20);

  // More fibre than carbs under a subtracting approach (FDA/NET): clamp the
  // non-fibre carbs bucket at 0 so the result can't go negative.
  const moreFibreThanCarbs = { carbsGrams: 5, fibreGrams: 10 };
  assert.equal(
    getMacroCalories(moreFibreThanCarbs, FIBRE_CALORIE_APPROACH_NET),
    0,
  );
  assert.equal(
    getMacroCalories(moreFibreThanCarbs, FIBRE_CALORIE_APPROACH_FDA),
    40,
  );
  // Under EU the carbs figure is used as-is (fibre is separate), so both
  // contribute: 5*4 + 10*2 = 40.
  assert.equal(
    getMacroCalories(moreFibreThanCarbs, FIBRE_CALORIE_APPROACH_EU),
    40,
  );
});

test("getMacroCalorieMismatch returns null when within tolerance", () => {
  // EU estimate for oats is 403; 403 logged calories is exactly on target.
  const result = getMacroCalorieMismatch(403, OATS, {
    approach: FIBRE_CALORIE_APPROACH_EU,
    tolerancePercent: 12,
  });
  assert.equal(result, null);
});

test("getMacroCalorieMismatch reports the approach-specific estimate when out of tolerance", () => {
  // Logged 500 but EU estimate is 403 → 97 kcal over, well outside 12% (≈60).
  const result = getMacroCalorieMismatch(500, OATS, {
    approach: FIBRE_CALORIE_APPROACH_EU,
    tolerancePercent: 12,
  });
  assert.ok(result);
  assert.equal(result!.macroCalories, 403);
  assert.equal(result!.delta, 97);

  // Same food logged at 500 under FDA: estimate is 383, delta 117.
  const fdaResult = getMacroCalorieMismatch(500, OATS, {
    approach: FIBRE_CALORIE_APPROACH_FDA,
    tolerancePercent: 12,
  });
  assert.ok(fdaResult);
  assert.equal(fdaResult!.macroCalories, 383);
  assert.equal(fdaResult!.delta, 117);
});

test("switching approach changes the mismatch verdict for the same input", () => {
  // Logged 360 kcal with a tight 5% tolerance (~18 kcal band).
  // Under NET (est 343) it's within tolerance (delta 17).
  // Under FDA (est 383) it's outside tolerance (delta 23).
  assert.equal(
    getMacroCalorieMismatch(360, OATS, {
      approach: FIBRE_CALORIE_APPROACH_NET,
      tolerancePercent: 5,
    }),
    null,
  );
  const fda = getMacroCalorieMismatch(360, OATS, {
    approach: FIBRE_CALORIE_APPROACH_FDA,
    tolerancePercent: 5,
  });
  assert.ok(fda);
  assert.equal(fda!.macroCalories, 383);
});

test("getMacroCalorieMismatch returns null when no macros are supplied", () => {
  assert.equal(
    getMacroCalorieMismatch(
      500,
      {},
      {
        approach: FIBRE_CALORIE_APPROACH_EU,
        tolerancePercent: 12,
      },
    ),
    null,
  );
});
