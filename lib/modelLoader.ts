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
 * Normalizes the config to ensure consistent stringification.
 *
 * Exported so callers (e.g. the Log screen's "model in memory" indicator)
 * can construct the exact same key `ensureModelLoaded` produces, instead of
 * duplicating the format and drifting out of sync.
 */
export function buildModelKey(params: EnsureModelParams): string {
  const config = params.modelConfig ?? DEFAULT_CONFIG;
  // Create a normalized copy with all fields to ensure consistent JSON stringification
  const normalized: ModelConfig = {
    temperature: config.temperature ?? DEFAULT_CONFIG.temperature,
    maxTokens: config.maxTokens ?? DEFAULT_CONFIG.maxTokens,
    topK: config.topK ?? DEFAULT_CONFIG.topK,
    topP: config.topP ?? DEFAULT_CONFIG.topP,
    backend: config.backend ?? DEFAULT_CONFIG.backend,
    enableSpeculativeDecoding:
      config.enableSpeculativeDecoding ??
      DEFAULT_CONFIG.enableSpeculativeDecoding,
    llamaCpp: config.llamaCpp ?? DEFAULT_CONFIG.llamaCpp,
  };
  return `${params.inferenceBackend}::${params.modelPath}::${params.systemPrompt}::${JSON.stringify(normalized)}`;
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
    const text = await unified.instance.sendMessage(prompt);
    return text;
  } else if (unified.kind === "llama-cpp") {
    const result = await unified.instance.completion({
      prompt,
    });
    const text = result?.text ?? "";
    return text;
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
  const key = buildModelKey(params);
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
