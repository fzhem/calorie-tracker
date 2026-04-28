import { getCachedData, saveStoredData, DEFAULT_DATA } from "../data/storage";
import type {
  StoredData,
  FavouriteQuickAdd,
  ModelConfig,
  GoalPhase,
  GoalAdjustmentType,
  MetabolismSex,
  ActivityLevel,
} from "../data/storage";
import type { Meal, Weight, BodyFat } from "../db/index";
import {
  getAllMeals,
  getAllWeights,
  getAllBodyFats,
  importMealsBulk,
  importWeightsBulk,
  importBodyFatsBulk,
} from "../db/index";

export type ExportPayload = {
  settings: StoredData;
  meals: Meal[];
  weightHistory: Weight[];
  bodyFatHistory: BodyFat[];
};

export async function exportUserData(): Promise<string> {
  const settings = getCachedData();
  if (!settings) throw new Error("No data to export.");

  const [meals, weightHistory, bodyFatHistory] = await Promise.all([
    getAllMeals(),
    getAllWeights(),
    getAllBodyFats(),
  ]);

  const payload: ExportPayload = {
    settings,
    meals,
    weightHistory,
    bodyFatHistory,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Imports user data from a JSON string and saves it to both storage and SQLite.
 * Throws if the data is invalid or cannot be parsed.
 */
export async function importUserData(json: string) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Invalid JSON format.");
  }

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
      fiberGoalGrams: (data.fiberGoalGrams as number | null) ?? null,
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

    await saveStoredData(settings);

    if (Array.isArray(data.entries)) {
      await importMealsBulk(data.entries as Meal[]);
    }
    if (Array.isArray(data.weightHistory)) {
      await importWeightsBulk(data.weightHistory);
    }
    if (Array.isArray(data.bodyFatHistory)) {
      await importBodyFatsBulk(data.bodyFatHistory);
    }
    return;
  }

  // ── ExportPayload (nested) format ────────────────────────────
  const payload = parsed as ExportPayload;

  if (payload.settings) {
    await saveStoredData(payload.settings);
  }
  if (Array.isArray(payload.meals)) {
    await importMealsBulk(payload.meals);
  }
  if (Array.isArray(payload.weightHistory)) {
    await importWeightsBulk(payload.weightHistory);
  }
  if (Array.isArray(payload.bodyFatHistory)) {
    await importBodyFatsBulk(payload.bodyFatHistory);
  }
}
