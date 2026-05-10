/**
 * Unified LLM abstraction layer.
 *
 * Supports both LiteRTLM (react-native-litert-lm) and
 * llama.cpp (llama.rn) backends under a single interface.
 *
 * Model file extensions determine which backend to use:
 *   .litertlm  → LiteRTLM
 *   .gguf      → llama.rn
 */

import { Platform } from "react-native";
import { getNativeMemoryUsage, refreshMemoryCache } from "./nativeMemory";
import {
  DEFAULT_MODEL_TEMPERATURE,
  DEFAULT_MODEL_MAX_TOKENS,
  DEFAULT_MODEL_TOP_K,
  DEFAULT_MODEL_TOP_P,
} from "@/constants";

// ── Common types ────────────────────────────────────────────────

export interface LLMConfig {
  enableMemoryTracking?: boolean;
}

export interface LLMLoadModelOptions {
  systemPrompt: string;
  backend?: string;
  maxTokens?: number;
  temperature?: number;
  topK?: number;
  topP?: number;
  /** For llama.rn: number of layers to offload to GPU */
  nGpuLayers?: number;
  /** For llama.rn: context size */
  nCtx?: number;
  /** For llama.rn: batch size */
  nBatch?: number;
  /** For llama.rn: thread count */
  nThreads?: number;
}

export interface LLMMemoryUsage {
  residentBytes: number;
  nativeHeapBytes: number;
  availableMemoryBytes: number;
  isLowMemory: boolean;
}

export interface LLMInstance {
  loadModel(path: string, options: LLMLoadModelOptions): Promise<void>;
  sendMessage(prompt: string): Promise<string>;
  close(): void;
  getMemoryUsage(): LLMMemoryUsage | null;
}

// ── Model type detection ────────────────────────────────────────

export type ModelBackend = "litertlm" | "llamacpp";

export function detectModelBackend(modelPath: string): ModelBackend {
  const lower = modelPath.toLowerCase();
  if (lower.endsWith(".gguf")) return "llamacpp";
  return "litertlm"; // default (covers .litertlm and unknown)
}

// ── Factory ─────────────────────────────────────────────────────

export async function createLLM(config?: LLMConfig): Promise<LLMInstance> {
  // Return a lazy proxy that detects the backend at loadModel time
  return new LazyLLMProxy(config);
}

// ── Lazy proxy that picks the right backend when loadModel is called ──

class LazyLLMProxy implements LLMInstance {
  private inner: LLMInstance | null = null;
  private config: LLMConfig;

  constructor(config?: LLMConfig) {
    this.config = config ?? {};
  }

  async loadModel(path: string, options: LLMLoadModelOptions): Promise<void> {
    const backend = detectModelBackend(path);
    if (backend === "llamacpp") {
      this.inner = new LlamaCppLLM(this.config);
    } else {
      const { LiteRTLM } = await import("@/lib/litertlmBackend");
      this.inner = new LiteRTLM(this.config);
    }
    return this.inner.loadModel(path, options);
  }

  async sendMessage(prompt: string): Promise<string> {
    if (!this.inner) throw new Error("Model not loaded. Call loadModel first.");
    return this.inner.sendMessage(prompt);
  }

  close(): void {
    this.inner?.close();
    this.inner = null;
  }

  getMemoryUsage(): LLMMemoryUsage | null {
    return this.inner?.getMemoryUsage() ?? null;
  }
}

// ── llama.rn backend ────────────────────────────────────────────

class LlamaCppLLM implements LLMInstance {
  private context: any = null;
  private config: LLMConfig;
  private systemPrompt: string = "";
  private temperature: number = DEFAULT_MODEL_TEMPERATURE;
  private topK: number = DEFAULT_MODEL_TOP_K;
  private topP: number = DEFAULT_MODEL_TOP_P;
  private maxTokens: number = DEFAULT_MODEL_MAX_TOKENS;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async loadModel(path: string, options: LLMLoadModelOptions): Promise<void> {
    const { initLlama } = await import("llama.rn");

    let cleanedPath = path;
    if (cleanedPath.startsWith("file:///")) {
      cleanedPath = cleanedPath.replace("file:///", "/");
    } else if (cleanedPath.startsWith("file://")) {
      cleanedPath = cleanedPath.slice(7);
    }

    // Store system prompt and generation params for use in sendMessage
    this.systemPrompt = options.systemPrompt ?? "";
    this.temperature = options.temperature ?? DEFAULT_MODEL_TEMPERATURE;
    this.topK = options.topK ?? DEFAULT_MODEL_TOP_K;
    this.topP = options.topP ?? DEFAULT_MODEL_TOP_P;
    this.maxTokens = options.maxTokens ?? DEFAULT_MODEL_MAX_TOKENS;

    const n_ctx =
      options.nCtx ?? (options.maxTokens ? options.maxTokens + 512 : 4096);
    const n_batch = options.nBatch ?? 512;
    const n_threads = options.nThreads ?? (Platform.OS === "android" ? 4 : 2);
    const n_gpu_layers =
      options.nGpuLayers ?? (Platform.OS === "android" ? 0 : 0);

    this.context = await initLlama(
      {
        model: cleanedPath,
        n_ctx,
        n_batch,
        n_threads,
        n_gpu_layers,
      },
      undefined, // no progress callback needed here
    );

    refreshMemoryCache();
  }

  async sendMessage(prompt: string): Promise<string> {
    if (!this.context) throw new Error("Model not loaded");

    const stopWords = [
      "</s>",
      "<|end|>",
      "<|eot_id|>",
      "<|end_of_text|>",
      "<|im_end|>",
      "ахархой",
      "<|END_OF_TURN_TOKEN|>",
      "<|end_of_turn|>",
      "<|endoftext|>",
    ];

    const result = await this.context.completion({
      messages: [
        {
          role: "system",
          content:
            this.systemPrompt,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: this.temperature,
      top_k: this.topK,
      top_p: this.topP,
      n_predict: this.maxTokens,
      stop: stopWords,
    });

    // result is NativeCompletionResult with a `text` field
    return result.text ?? "";
  }

  close(): void {
    if (this.context) {
      try {
        this.context.release();
      } catch {}
      this.context = null;
    }
  }

  getMemoryUsage(): LLMMemoryUsage | null {
    return getNativeMemoryUsage();
  }
}