import {
  getCachedData,
  saveStoredData,
  DEFAULT_DATA,
  loadStoredData,
} from "@/data/storage";
import type {
  StoredData,
  FavouriteQuickAdd,
  ModelConfig,
  GoalPhase,
  GoalAdjustmentType,
  MetabolismSex,
  ActivityLevel,
} from "@/data/storage";
import type { Meal, Weight, BodyFat, Recipe } from "@/db/index";
import {
  getAllMeals,
  getAllWeights,
  getAllBodyFats,
  getAllRecipes,
  importMealsBulk,
  importWeightsBulk,
  importBodyFatsBulk,
  importRecipesBulk,
} from "@/db/index";

export type ExportPayload = {
  settings: StoredData;
  meals: Meal[];
  weightHistory: Weight[];
  bodyFatHistory: BodyFat[];
  recipes: Recipe[];
};

export type ImportSummary = {
  meals: { imported: number; failed: number };
  weightHistory: { imported: number; failed: number };
  bodyFatHistory: { imported: number; failed: number };
  recipes: { imported: number; failed: number };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNullableFiniteNumber(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return value as null | undefined;
  return asFiniteNumber(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isValidDateLike(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function sanitizeMeal(entry: unknown): Meal | null {
  if (!isRecord(entry)) return null;

  const title = asString(entry.title);
  const loggedAt = asString(entry.loggedAt);
  const calories = asFiniteNumber(entry.calories);
  const id = asString(entry.id);
  const proteinGrams = asNullableFiniteNumber(entry.proteinGrams);
  const fatGrams = asNullableFiniteNumber(entry.fatGrams);
  const carbsGrams = asNullableFiniteNumber(entry.carbsGrams);
  const fibreGrams = asNullableFiniteNumber(entry.fibreGrams);

  if (!title || !loggedAt || calories === null) return null;
  if (title.trim().length === 0 || calories < 0 || !isValidDateLike(loggedAt)) {
    return null;
  }
  if (proteinGrams !== undefined && proteinGrams !== null && proteinGrams < 0) {
    return null;
  }
  if (fatGrams !== undefined && fatGrams !== null && fatGrams < 0) {
    return null;
  }
  if (carbsGrams !== undefined && carbsGrams !== null && carbsGrams < 0) {
    return null;
  }
  if (fibreGrams !== undefined && fibreGrams !== null && fibreGrams < 0) {
    return null;
  }

  return {
    id: id ?? undefined,
    title,
    loggedAt,
    calories,
    proteinGrams: proteinGrams ?? null,
    fatGrams: fatGrams ?? null,
    carbsGrams: carbsGrams ?? null,
    fibreGrams: fibreGrams ?? null,
  } as Meal;
}

function sanitizeWeight(entry: unknown): Omit<Weight, "id"> | null {
  if (!isRecord(entry)) return null;

  const recordedAt = asString(entry.recordedAt);
  const weightKg = asFiniteNumber(entry.weightKg);
  const source = asString(entry.source);
  const originAppId = asString(entry.originAppId);
  const originAppName = asString(entry.originAppName);
  const originDevice = asString(entry.originDevice);

  if (!recordedAt || weightKg === null || !source) return null;
  if (weightKg <= 0 || !isValidDateLike(recordedAt)) return null;
  if (source !== "manual" && source !== "health-connect") return null;

  return {
    recordedAt,
    weightKg,
    source,
    originAppId: originAppId ?? null,
    originAppName: originAppName ?? null,
    originDevice: originDevice ?? null,
  };
}

function sanitizeBodyFat(entry: unknown): Omit<BodyFat, "id"> | null {
  if (!isRecord(entry)) return null;

  const recordedAt = asString(entry.recordedAt);
  const bodyFatPercentage = asFiniteNumber(entry.bodyFatPercentage);
  const source = asString(entry.source);
  const originAppId = asString(entry.originAppId);
  const originAppName = asString(entry.originAppName);
  const originDevice = asString(entry.originDevice);

  if (!recordedAt || bodyFatPercentage === null || !source) return null;
  if (
    bodyFatPercentage <= 0 ||
    bodyFatPercentage > 100 ||
    !isValidDateLike(recordedAt)
  ) {
    return null;
  }
  if (source !== "health-connect") return null;

  return {
    recordedAt,
    bodyFatPercentage,
    source,
    originAppId: originAppId ?? null,
    originAppName: originAppName ?? null,
    originDevice: originDevice ?? null,
  };
}

function sanitizeMeals(entries: unknown[]): { valid: Meal[]; invalid: number } {
  const valid: Meal[] = [];
  let invalid = 0;
  for (const entry of entries) {
    const row = sanitizeMeal(entry);
    if (row) {
      valid.push(row);
    } else {
      invalid += 1;
    }
  }
  return { valid, invalid };
}

function sanitizeWeights(entries: unknown[]): {
  valid: Omit<Weight, "id">[];
  invalid: number;
} {
  const valid: Omit<Weight, "id">[] = [];
  let invalid = 0;
  for (const entry of entries) {
    const row = sanitizeWeight(entry);
    if (row) {
      valid.push(row);
    } else {
      invalid += 1;
    }
  }
  return { valid, invalid };
}

function sanitizeBodyFats(entries: unknown[]): {
  valid: Omit<BodyFat, "id">[];
  invalid: number;
} {
  const valid: Omit<BodyFat, "id">[] = [];
  let invalid = 0;
  for (const entry of entries) {
    const row = sanitizeBodyFat(entry);
    if (row) {
      valid.push(row);
    } else {
      invalid += 1;
    }
  }
  return { valid, invalid };
}

export async function exportUserData(): Promise<string> {
  const settings = getCachedData() ?? (await loadStoredData());
  if (!settings) throw new Error("No data to export.");

  const [meals, weightHistory, bodyFatHistory, recipes] = await Promise.all([
    getAllMeals(),
    getAllWeights(),
    getAllBodyFats(),
    getAllRecipes(),
  ]);

  const payload: ExportPayload = {
    settings,
    meals,
    weightHistory,
    bodyFatHistory,
    recipes,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Imports user data from a JSON string and saves it to both storage and SQLite.
 * Throws if the data is invalid or cannot be parsed.
 */
export async function importUserData(
  json: string,
  onProgress?: (value: number, label: string) => void,
): Promise<ImportSummary> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON format.");
  }

  const summary: ImportSummary = {
    meals: { imported: 0, failed: 0 },
    weightHistory: { imported: 0, failed: 0 },
    bodyFatHistory: { imported: 0, failed: 0 },
    recipes: { imported: 0, failed: 0 },
  };

  // ── Detect format ──────────────────────────────────────────────
  // Flat format (app's actual export): settings at root, meals under "entries"
  // ExportPayload format: { settings, meals, weightHistory, bodyFatHistory }

  if (Array.isArray(parsed.entries)) {
    // ── Flat export format ──────────────────────────────────────
    const data = parsed as Record<string, any>;

    const settings: StoredData = {
      ...DEFAULT_DATA,
      favouriteQuickAdds:
        (data.favouriteQuickAdds as FavouriteQuickAdd[]) ?? [],
      modelPath: (data.modelPath as string | null) ?? null,
      systemPrompt: (data.systemPrompt as string) ?? DEFAULT_DATA.systemPrompt,
      quickLogMacrosExpanded: (data.quickLogMacrosExpanded as boolean) ?? false,
      baseTarget: (data.baseTarget as number) ?? DEFAULT_DATA.baseTarget,
      caloriesPerKg:
        (data.caloriesPerKg as number) ?? DEFAULT_DATA.caloriesPerKg,
      goalPhase: (data.goalPhase as GoalPhase) ?? DEFAULT_DATA.goalPhase,
      cutAdjustmentType:
        (data.cutAdjustmentType as GoalAdjustmentType) ??
        DEFAULT_DATA.cutAdjustmentType,
      cutCalorieAdjustment:
        (data.cutCalorieAdjustment as number) ??
        DEFAULT_DATA.cutCalorieAdjustment,
      cutPercentPerWeek:
        (data.cutPercentPerWeek as number) ?? DEFAULT_DATA.cutPercentPerWeek,
      bulkAdjustmentType:
        (data.bulkAdjustmentType as GoalAdjustmentType) ??
        DEFAULT_DATA.bulkAdjustmentType,
      bulkCalorieAdjustment:
        (data.bulkCalorieAdjustment as number) ??
        DEFAULT_DATA.bulkCalorieAdjustment,
      bulkPercentPerWeek:
        (data.bulkPercentPerWeek as number) ?? DEFAULT_DATA.bulkPercentPerWeek,
      metabolismSex:
        (data.metabolismSex as MetabolismSex) ?? DEFAULT_DATA.metabolismSex,
      metabolismAgeYears: (data.metabolismAgeYears as number | null) ?? null,
      metabolismHeightCm: (data.metabolismHeightCm as number | null) ?? null,
      activityLevel:
        (data.activityLevel as ActivityLevel) ?? DEFAULT_DATA.activityLevel,
      manualWeightKg: (data.manualWeightKg as number | null) ?? null,
      lastWeightSyncAt: (data.lastWeightSyncAt as string | null) ?? null,
      lastBodyFatSyncAt: (data.lastBodyFatSyncAt as string | null) ?? null,
      proteinGoalGrams: (data.proteinGoalGrams as number | null) ?? null,
      fatGoalGrams: (data.fatGoalGrams as number | null) ?? null,
      carbsGoalGrams: (data.carbsGoalGrams as number | null) ?? null,
      fibreGoalGrams: (data.fibreGoalGrams as number | null) ?? null,
      calorieTolerancePercent:
        (data.calorieTolerancePercent as number) ??
        DEFAULT_DATA.calorieTolerancePercent,
      graphToleranceCalories:
        (data.graphToleranceCalories as number) ??
        DEFAULT_DATA.graphToleranceCalories,
      perModelConfig:
        (data.perModelConfig as Record<string, ModelConfig>) ?? {},
      healthConnectAutoSync: (data.healthConnectAutoSync as boolean) ?? false,
    };

    onProgress?.(0.1, "Importing settings…");
    await saveStoredData(settings, { immediate: true });

    if (Array.isArray(data.entries)) {
      onProgress?.(0.25, "Importing meals…");
      const meals = sanitizeMeals(data.entries);
      const mealsResult = await importMealsBulk(meals.valid);
      summary.meals.imported = mealsResult.imported;
      summary.meals.failed = meals.invalid + mealsResult.failed;
    }
    if (Array.isArray(data.weightHistory)) {
      onProgress?.(0.5, "Importing weight history…");
      const weights = sanitizeWeights(data.weightHistory);
      const weightsResult = await importWeightsBulk(weights.valid);
      summary.weightHistory.imported = weightsResult.imported;
      summary.weightHistory.failed = weights.invalid + weightsResult.failed;
    }
    if (Array.isArray(data.bodyFatHistory)) {
      onProgress?.(0.75, "Importing body fat history…");
      const bodyFats = sanitizeBodyFats(data.bodyFatHistory);
      const bodyFatsResult = await importBodyFatsBulk(bodyFats.valid);
      summary.bodyFatHistory.imported = bodyFatsResult.imported;
      summary.bodyFatHistory.failed = bodyFats.invalid + bodyFatsResult.failed;
    }
    if (Array.isArray(data.recipes)) {
      onProgress?.(0.85, "Importing recipes…");
      const recipesResult = await importRecipesBulk(data.recipes as Recipe[]);
      summary.recipes.imported = recipesResult.imported;
      summary.recipes.failed = recipesResult.failed;
    }
    onProgress?.(1.0, "Done");
    return summary;
  }

  // ── ExportPayload (nested) format ────────────────────────────
  const payload = parsed as ExportPayload;

  if (payload.settings) {
    onProgress?.(0.1, "Importing settings…");
    await saveStoredData(payload.settings, { immediate: true });
  }
  if (Array.isArray(payload.meals)) {
    onProgress?.(0.25, "Importing meals…");
    const meals = sanitizeMeals(payload.meals);
    const mealsResult = await importMealsBulk(meals.valid);
    summary.meals.imported = mealsResult.imported;
    summary.meals.failed = meals.invalid + mealsResult.failed;
  }
  if (Array.isArray(payload.weightHistory)) {
    onProgress?.(0.5, "Importing weight history…");
    const weights = sanitizeWeights(payload.weightHistory);
    const weightsResult = await importWeightsBulk(weights.valid);
    summary.weightHistory.imported = weightsResult.imported;
    summary.weightHistory.failed = weights.invalid + weightsResult.failed;
  }
  if (Array.isArray(payload.bodyFatHistory)) {
    onProgress?.(0.75, "Importing body fat history…");
    const bodyFats = sanitizeBodyFats(payload.bodyFatHistory);
    const bodyFatsResult = await importBodyFatsBulk(bodyFats.valid);
    summary.bodyFatHistory.imported = bodyFatsResult.imported;
    summary.bodyFatHistory.failed = bodyFats.invalid + bodyFatsResult.failed;
  }
  if (Array.isArray(payload.recipes)) {
    onProgress?.(0.85, "Importing recipes…");
    const recipesResult = await importRecipesBulk(payload.recipes as Recipe[]);
    summary.recipes.imported = recipesResult.imported;
    summary.recipes.failed = recipesResult.failed;
  }
  onProgress?.(1.0, "Done");

  return summary;
}
