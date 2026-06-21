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
import type { ModelConfig, LlamaCppAdvancedConfig } from "@/data/storage";
import { DEFAULT_LLAMA_CPP_CONFIG } from "@/data/storage";
import { buildLlamaCppInitParams } from "@/lib/llamaCppConfig";
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

// ---------------------------------------------------------------------------
// initLlama() param construction lives in lib/llamaCppConfig.ts (pure, tested).
// ---------------------------------------------------------------------------

/**
 * Load a GGUF model file using llama.rn.
 *
 * @param modelPath  Filesystem path to the .gguf model file (cleaned, no file:// prefix).
 * @param config     Model configuration (temperature, maxTokens, topK, topP + llamaCpp advanced).
 * @param systemPrompt  System prompt to prepend to all requests.
 */
export async function loadLlamaRNModel(
  modelPath: string,
  config: ModelConfig,
  systemPrompt: string,
): Promise<LlamaRNInstance> {
  const llamaCpp: LlamaCppAdvancedConfig = {
    ...DEFAULT_LLAMA_CPP_CONFIG,
    ...(config.llamaCpp ?? {}),
  };

  const initParams = buildLlamaCppInitParams(modelPath, config);

  let context: any;
  if (typeof (LlamaRN as any).initLlama === "function") {
    context = await (LlamaRN as any).initLlama(initParams);
  } else if (
    (LlamaRN as any).LlamaContext &&
    typeof (LlamaRN as any).LlamaContext.init === "function"
  ) {
    context = await (LlamaRN as any).LlamaContext.init(initParams);
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

      // Sampler params only — context-level flags (reasoning) are already
      // set at initLlama() time.
      const completionParams: Record<string, unknown> = {
        n_predict: params.n_predict ?? config.maxTokens,
        temperature: params.temperature ?? config.temperature,
        top_k: params.top_k ?? config.topK,
        top_p: params.top_p ?? config.topP,
        stop: params.stop ?? ["</s>"],
      };

      // Prefer chat-formatted completion so instruction-tuned GGUF models
      // (Gemma, Llama, Qwen, ...) actually follow the JSON instruction. Raw
      // text completion skips the model's chat template — there's no
      // "assistant turn" marker, so chat models often emit EOS immediately
      // and return empty text. Using `messages` runs the model's jinja
      // template (e.g. Gemma's <start_of_turn>model\n marker).
      //
      // We fall back to raw prompt completion for base models that have no
      // chat template.
      const supportsChat =
        typeof context.isJinjaSupported === "function" &&
        context.isJinjaSupported();

      let response: any;
      try {
        if (supportsChat) {
          const messages: Array<{ role: string; content: string }> = [];
          if (systemPrompt) {
            messages.push({ role: "system", content: systemPrompt });
          }
          messages.push({ role: "user", content: params.prompt });
          response = await context.completion({
            ...completionParams,
            messages,
          });
        } else {
          // No jinja template — do raw text completion.
          const fullPrompt = systemPrompt
            ? `${systemPrompt}\n\n${params.prompt}`
            : params.prompt;
          response = await context.completion({
            ...completionParams,
            prompt: fullPrompt,
          });
        }
      } catch {
        // Chat template rendering failed (e.g. malformed jinja) → fall back
        // to raw text completion.
        const fullPrompt = systemPrompt
          ? `${systemPrompt}\n\n${params.prompt}`
          : params.prompt;
        response = await context.completion({
          ...completionParams,
          prompt: fullPrompt,
        });
      }

      // Prefer `content` (filters out reasoning/tool-call wrapping) then `text`.
      const outText =
        (response &&
          typeof response.content === "string" &&
          response.content) ||
        (response && typeof response.text === "string" && response.text) ||
        "";
      return { text: outText };
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
