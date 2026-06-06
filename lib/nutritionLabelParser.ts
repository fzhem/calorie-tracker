import type { LiteRTLMInstance } from "react-native-litert-lm";
import type { ScannedLabelData } from "@/ui/nutritionLabelScanner";
import {
  isLiteRTSupported,
  getLiteRTUnsupportedReason,
  type DeviceArchitecture,
} from "@/lib/architectureUtils";
import { ensureModelLoaded } from "@/lib/modelLoader";
import type { ModelConfig } from "@/data/storage";
import { DEFAULT_MODEL_CONFIG } from "@/data/storage";

/**
 * Configuration needed to load the model for label parsing.
 */
export type LabelModelConfig = {
  deviceArchitecture: DeviceArchitecture | null;
  modelPath: string | null;
  systemPrompt?: string;
  perModelConfig: Record<string, ModelConfig>;
};

/**
 * Ensure the model is loaded and ready for label image parsing.
 * Handles architecture checking, model path validation, and model
 * loading/caching — all the boilerplate previously in log.tsx.
 *
 * @returns A ready-to-use model instance.
 * @throws Descriptive error messages for any issues.
 */
export async function ensureLabelModelLoaded(
  config: LabelModelConfig,
): Promise<LiteRTLMInstance> {
  const { deviceArchitecture, modelPath, systemPrompt, perModelConfig } =
    config;

  // 1. Architecture check
  if (!deviceArchitecture || !isLiteRTSupported(deviceArchitecture)) {
    throw new Error(
      deviceArchitecture
        ? getLiteRTUnsupportedReason(deviceArchitecture)
        : "Device architecture not supported",
    );
  }

  // 2. Model path check
  if (!modelPath) {
    throw new Error(
      "No model file selected. Please configure a model in settings.",
    );
  }

  // 3. Clean and prepare model path
  const cleanedModelPath = modelPath.startsWith("file:///")
    ? modelPath.replace("file:///", "/")
    : modelPath;

  const modelConfig =
    perModelConfig?.[cleanedModelPath] ?? DEFAULT_MODEL_CONFIG;

  // 4. Load model if not already cached (reuses modelCache singleton)
  const model = await ensureModelLoaded({
    modelPath: cleanedModelPath,
    systemPrompt: systemPrompt ?? "",
    modelConfig,
  });

  return model;
}

/**
 * Scale scanned label data by a portions multiplier.
 * Returns a `QuickAddItem`-like object ready to be added as a meal entry.
 */
export function scaleScannedData(
  labelData: ScannedLabelData,
  portions: number,
): {
  title: string;
  calories: number;
  proteinGrams: number | null;
  carbsGrams: number | null;
  fatGrams: number | null;
  fibreGrams: number | null;
} {
  const scaledCalories = Math.round(labelData.calories * portions);
  const scaledProtein = Math.round(labelData.protein * portions * 10) / 10;
  const scaledCarbs = Math.round(labelData.carbs * portions * 10) / 10;
  const scaledFat = Math.round(labelData.fat * portions * 10) / 10;
  const scaledFibre = Math.round(labelData.fibre * portions * 10) / 10;

  return {
    title: labelData.title,
    calories: scaledCalories,
    proteinGrams: scaledProtein || null,
    carbsGrams: scaledCarbs || null,
    fatGrams: scaledFat || null,
    fibreGrams: scaledFibre || null,
  };
}

export async function parseNutritionLabelImage(
  model: LiteRTLMInstance,
  imageUri: string,
): Promise<ScannedLabelData> {
  try {
    // Strip the file:// prefix — sendMessageWithImage expects a plain filesystem path
    const imagePath = imageUri.replace(/^file:\/\//, "");

    const prompt = `You are a nutrition assistant.

    Return JSON only.

    IMPORTANT: Report calories in **kcal** (kilocalories), NOT in kJ (kilojoules). If the label shows kJ, convert to kcal (divide by ~4.184).

    Format:
    {
      "title": "product name",
      "servingSize": "serving size as listed (e.g., '1 cup', '100g')",
      "calories": number (kcal),
      "protein": number (grams),
      "carbs": number (grams),
      "fat": number (grams),
      "fibre": number (grams)
    }`;

    const response = await model.sendMessageWithImage(prompt, imagePath);

    if (!response) {
      throw new Error("No response from model");
    }

    // Parse the JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Model response did not contain valid JSON");
    }

    const raw = JSON.parse(jsonMatch[0]);

    // Unwrap items array if the model returns { items: [...] }
    const parsed =
      Array.isArray(raw.items) && raw.items.length > 0 ? raw.items[0] : raw;

    // Defensive: if the model returned calories in kJ (~4.184× kcal), convert
    if (typeof parsed.calories === "number" && parsed.calories > 2000) {
      parsed.calories = Math.round(parsed.calories / 4.184);
    }

    // Validate required fields
    if (
      typeof parsed.servingSize !== "string" ||
      typeof parsed.calories !== "number" ||
      typeof parsed.protein !== "number" ||
      typeof parsed.carbs !== "number" ||
      typeof parsed.fat !== "number"
    ) {
      throw new Error("Model response missing required fields");
    }

    return {
      title:
        typeof parsed.title === "string"
          ? parsed.title.trim()
          : "Unknown Product",
      servingSize: parsed.servingSize.trim(),
      servingsPerContainer: parsed.servingsPerContainer ?? undefined,
      calories: Math.round(parsed.calories),
      protein: Math.round(parsed.protein * 10) / 10,
      carbs: Math.round(parsed.carbs * 10) / 10,
      fat: Math.round(parsed.fat * 10) / 10,
      fibre: Math.round((parsed.fibre ?? 0) * 10) / 10,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Could not parse label data. Try a clearer photo.");
    }
    throw error;
  }
}
