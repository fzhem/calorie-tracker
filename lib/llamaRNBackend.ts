/**
 * llama.cpp backend wrapper for GGUF model inference.
 *
 * Provides a compatible interface with the LiteRT backend so the model loader
 * can dispatch to either engine transparently.
 *
 * llama.rn wraps llama.cpp's C API via React Native JSI.
 * API reference: https://github.com/mybigday/llama.rn
 */

import { Platform } from "react-native";
import * as LlamaRN from "llama.rn";
import type { ModelConfig } from "@/data/storage";
import { getMemoryStats } from "@/modules/rn-memory-module/src/index";

// ---------------------------------------------------------------------------
// llama.rn types (based on llama.rn v0.12.x API)
// ---------------------------------------------------------------------------

export interface LlamaRNInstance {
  completion(
    params: {
      prompt: string;
      n_predict?: number;
      temperature?: number;
      top_k?: number;
      top_p?: number;
      stop?: string[];
      [key: string]: unknown;
    },
    callback?: (token: string) => void,
  ): Promise<{ text: string; timings?: { predicted_per_second?: number } }>;

  close(): Promise<void>;

  getMemoryUsage?: () => {
    residentBytes: number;
    nativeHeapBytes: number;
    availableMemoryBytes: number;
    isLowMemory: boolean;
  } | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** llama.rn is always available — it's a core dependency. */
export function isLlamaRNAvailable(): boolean {
  return true;
}

/**
 * Load a GGUF model file using llama.rn.
 *
 * @param modelPath  Filesystem path to the .gguf model file (cleaned, no file:// prefix).
 * @param config     Model configuration (temperature, maxTokens, topK, topP).
 * @param systemPrompt  System prompt to prepend to all requests.
 */
export async function loadLlamaRNModel(
  modelPath: string,
  config: ModelConfig,
  systemPrompt: string,
): Promise<LlamaRNInstance> {
  let context: any;

  if (typeof (LlamaRN as any).initLlama === "function") {
    context = await (LlamaRN as any).initLlama({
      model: modelPath,
      n_ctx: config.maxTokens,
      n_threads: 4,
      use_mlock: true,
      embedding: false,
    });
  } else if (
    (LlamaRN as any).LlamaContext &&
    typeof (LlamaRN as any).LlamaContext.init === "function"
  ) {
    context = await (LlamaRN as any).LlamaContext.init({
      model: modelPath,
      n_ctx: config.maxTokens,
      n_threads: 4,
      use_mlock: true,
      embedding: false,
    });
  } else {
    throw new Error(
      "llama.rn API not recognized. Please check the llama.rn documentation.",
    );
  }

  const instance: LlamaRNInstance = {
    async completion(
      params: {
        prompt: string;
        n_predict?: number;
        temperature?: number;
        top_k?: number;
        top_p?: number;
        stop?: string[];
        [key: string]: unknown;
      },
      _callback?: (token: string) => void,
    ): Promise<{ text: string }> {
      if (!context?.completion) {
        throw new Error("Model context not initialized.");
      }

      const fullPrompt = systemPrompt
        ? `${systemPrompt}\n\n${params.prompt}`
        : params.prompt;

      const response = await context.completion({
        prompt: fullPrompt,
        n_predict: params.n_predict ?? config.maxTokens,
        temperature: params.temperature ?? config.temperature,
        top_k: params.top_k ?? config.topK,
        top_p: params.top_p ?? config.topP,
        stop: params.stop ?? ["</s>"],
      });

      if (typeof response === "string") {
        return { text: response };
      }
      if (response && typeof response.text === "string") {
        return { text: response.text };
      }
      return { text: JSON.stringify(response) };
    },

    async close() {
      if (context && typeof context.release === "function") {
        try {
          await context.release();
        } catch {
          // Best effort
        }
      }
      context = null;
    },

    getMemoryUsage() {
      if (Platform.OS !== "android") return null;

      // Try native getMemoryUsage first (may be exposed by newer llama.rn versions)
      try {
        if (context && typeof context.getMemoryUsage === "function") {
          const native = context.getMemoryUsage();
          if (
            native &&
            typeof native === "object" &&
            typeof native.residentBytes === "number"
          ) {
            return native;
          }
        }
      } catch {
        // Ignore
      }

      // Use our native module for exact same OS-level measurements as LiteRT.
      // Uses Debug.getNativeHeapAllocatedSize() and /proc/self/status VmRSS,
      // mirroring HybridLiteRTLM.getMemoryUsage() 1:1.
      const stats = getMemoryStats();
      if (stats) {
        return {
          residentBytes: stats.residentBytes,
          nativeHeapBytes: stats.nativeHeapBytes,
          availableMemoryBytes: stats.availableMemoryBytes,
          isLowMemory: stats.isLowMemory,
        };
      }

      // Native module not linked. This happens if the app hasn't been rebuilt
      // since adding the module (run `npx expo run:android`). Return null so
      // callers show "unavailable" rather than misleading fake values.
      return null;
    },
  };

  return instance;
}
