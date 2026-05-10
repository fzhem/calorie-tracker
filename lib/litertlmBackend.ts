/**
 * LiteRTLM backend implementation for the unified LLM abstraction.
 *
 * Wraps react-native-litert-lm's createLLM / LiteRTLMInstance
 * to conform to the LLMInstance interface.
 */

import {
  createLLM as createLiteRTLM,
  type LiteRTLMInstance,
  type Backend,
} from "react-native-litert-lm";
import type {
  LLMInstance,
  LLMLoadModelOptions,
  LLMConfig,
  LLMMemoryUsage,
} from "@/lib/llm";
import {
  DEFAULT_MODEL_TEMPERATURE,
  DEFAULT_MODEL_MAX_TOKENS,
  DEFAULT_MODEL_TOP_K,
  DEFAULT_MODEL_TOP_P,
  DEFAULT_MODEL_BACKEND,
} from "@/constants";

export class LiteRTLM implements LLMInstance {
  private inner: LiteRTLMInstance | null = null;
  private config: LLMConfig;
  private _enableMemoryTracking: boolean;

  constructor(config?: LLMConfig) {
    this.config = config ?? {};
    this._enableMemoryTracking = this.config.enableMemoryTracking ?? false;
  }

  async loadModel(path: string, options: LLMLoadModelOptions): Promise<void> {
    if (this.inner) {
      try {
        this.inner.close();
      } catch {}
      this.inner = null;
    }

    // Remove 'file:///' prefix if present
    let cleanedPath = path.startsWith("file:///")
      ? path.replace("file:///", "/")
      : path;

    this.inner = createLiteRTLM({
      enableMemoryTracking: this._enableMemoryTracking,
    });
    await this.inner.loadModel(cleanedPath, {
      systemPrompt: options.systemPrompt,
      backend: (options.backend ?? DEFAULT_MODEL_BACKEND) as Backend,
      maxTokens: options.maxTokens ?? DEFAULT_MODEL_MAX_TOKENS,
      temperature: options.temperature ?? DEFAULT_MODEL_TEMPERATURE,
      topK: options.topK ?? DEFAULT_MODEL_TOP_K,
      topP: options.topP ?? DEFAULT_MODEL_TOP_P,
    });
  }

  async sendMessage(prompt: string): Promise<string> {
    if (!this.inner) throw new Error("Model not loaded");
    return this.inner.sendMessage(prompt);
  }

  close(): void {
    if (this.inner) {
      try {
        this.inner.close();
      } catch {}
      this.inner = null;
    }
  }

  getMemoryUsage(): LLMMemoryUsage | null {
    if (!this.inner) return null;
    try {
      if (typeof (this.inner as any).getMemoryUsage === "function") {
        const usage = (this.inner as any).getMemoryUsage();
        if (
          usage &&
          typeof usage === "object" &&
          typeof usage.residentBytes === "number" &&
          typeof usage.nativeHeapBytes === "number" &&
          typeof usage.availableMemoryBytes === "number" &&
          typeof usage.isLowMemory === "boolean"
        ) {
          return usage as LLMMemoryUsage;
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}
