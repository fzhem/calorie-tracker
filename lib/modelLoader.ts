import { createLLM, type LiteRTLMInstance } from "react-native-litert-lm";
import type { ModelConfig } from "@/data/storage";
import { DEFAULT_MODEL_CONFIG } from "@/data/storage";
import {
  getModelInstance,
  getLoadedModelKey,
  setModelCache,
} from "@/lib/modelCache";

/**
 * Parameters for loading/ensuring a model is ready.
 */
export type EnsureModelParams = {
  /** Cleaned filesystem path to the .gguf model file */
  modelPath: string;
  /** System prompt baked into the model context */
  systemPrompt: string;
  /** Per-model config overrides (falls back to DEFAULT_MODEL_CONFIG) */
  modelConfig?: ModelConfig;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ModelConfig = DEFAULT_MODEL_CONFIG;

/**
 * Build a deterministic cache key.
 */
function buildKey(params: EnsureModelParams): string {
  const config = params.modelConfig ?? DEFAULT_CONFIG;
  return `${params.modelPath}::${params.systemPrompt}::${JSON.stringify(config)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure a model is loaded and ready for use.
 */
export async function ensureModelLoaded(
  params: EnsureModelParams,
): Promise<LiteRTLMInstance> {
  const key = buildKey(params);
  const existing = getModelInstance();
  const existingKey = getLoadedModelKey();

  // Exact match → reuse
  if (existing && existingKey === key) {
    return existing;
  }

  // No compatible instance – load fresh (setModelCache will close the old one)
  const config = params.modelConfig ?? DEFAULT_CONFIG;
  const model = createLLM({ enableMemoryTracking: true });
  await model.loadModel(params.modelPath, {
    systemPrompt: params.systemPrompt,
    backend: "cpu",
    multimodal: true,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    topK: config.topK,
    topP: config.topP,
    enableSpeculativeDecoding: config.enableSpeculativeDecoding ?? false,
  });
  setModelCache(model, key);
  return model;
}
