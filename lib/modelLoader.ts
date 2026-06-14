import { createLLM, type LiteRTLMInstance } from "react-native-litert-lm";
import { loadLlamaRNModel } from "@/lib/llamaRNBackend";
import type { LlamaRNInstance } from "@/lib/llamaRNBackend";
import type { ModelConfig } from "@/data/storage";
import { DEFAULT_MODEL_CONFIG } from "@/data/storage";
import { BACKEND_LLAMA_CPP } from "@/constants";
import type { InferenceBackend } from "@/constants";
import {
  getModelInstance,
  getLoadedModelKey,
  setModelCache,
} from "@/lib/modelCache";

// ---------------------------------------------------------------------------
// Unified instance type – wraps both backends
// ---------------------------------------------------------------------------

export type UnifiedModelInstance =
  | { kind: "litert"; instance: LiteRTLMInstance }
  | { kind: "llama-cpp"; instance: LlamaRNInstance };

/**
 * Parameters for loading/ensuring a model is ready.
 */
export type EnsureModelParams = {
  /** Cleaned filesystem path to the model file (no file:/// prefix) */
  modelPath: string;
  /** System prompt baked into the model context */
  systemPrompt: string;
  /** Per-model config overrides (falls back to DEFAULT_MODEL_CONFIG) */
  modelConfig?: ModelConfig;
  /** Which inference backend to use */
  inferenceBackend: InferenceBackend;
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ModelConfig = DEFAULT_MODEL_CONFIG;

/**
 * Build a deterministic cache key that includes the backend type.
 */
function buildKey(params: EnsureModelParams): string {
  const config = params.modelConfig ?? DEFAULT_CONFIG;
  return `${params.inferenceBackend}::${params.modelPath}::${params.systemPrompt}::${JSON.stringify(config)}`;
}

/**
 * Send a message using the appropriate backend's API.
 *
 * LiteRT uses `instance.sendMessage(prompt)` → returns a string.
 * llama.cpp uses `instance.completion({ prompt })` → returns `{ text }`.
 */
export async function sendMessage(
  unified: UnifiedModelInstance,
  prompt: string,
): Promise<string> {
  if (unified.kind === "litert") {
    return unified.instance.sendMessage(prompt);
  } else if (unified.kind === "llama-cpp") {
    const result = await unified.instance.completion({
      prompt,
    });
    return result?.text ?? "";
  }
  throw new Error(`Unknown model kind: ${(unified as any).kind}`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure a model is loaded and ready for use.
 *
 * Dispatches to LiteRT or llama.cpp based on `params.inferenceBackend`.
 */
export async function ensureModelLoaded(
  params: EnsureModelParams,
): Promise<UnifiedModelInstance> {
  const key = buildKey(params);
  const existing = getModelInstance();
  const existingKey = getLoadedModelKey();

  // Exact match → reuse
  if (existing && existingKey === key) {
    return existing as UnifiedModelInstance;
  }

  // No compatible instance – load fresh
  const config = params.modelConfig ?? DEFAULT_CONFIG;

  if (params.inferenceBackend === BACKEND_LLAMA_CPP) {
    const instance = await loadLlamaRNModel(
      params.modelPath,
      config,
      params.systemPrompt,
    );
    const unified: UnifiedModelInstance = { kind: "llama-cpp", instance };
    setModelCache(unified, key);
    return unified;
  }

  // Default: LiteRT backend
  const model = createLLM({ enableMemoryTracking: true });
  await model.loadModel(params.modelPath, {
    systemPrompt: params.systemPrompt,
    backend: config.backend,
    multimodal: true,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    topK: config.topK,
    topP: config.topP,
    enableSpeculativeDecoding: config.enableSpeculativeDecoding ?? false,
  });
  const unified: UnifiedModelInstance = { kind: "litert", instance: model };
  setModelCache(unified, key);
  return unified;
}
