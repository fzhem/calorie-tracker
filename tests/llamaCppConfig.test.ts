import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LLAMA_CPP_CONFIG,
  normalizeLlamaCppConfig,
  buildLlamaCppInitParams,
  type LlamaCppAdvancedConfig,
  type ModelConfigLike,
} from "../lib/llamaCppConfig";

/** Build a minimal config object that satisfies ModelConfigLike. */
function makeConfig(
  overrides: Partial<LlamaCppAdvancedConfig> = {},
): ModelConfigLike {
  return { llamaCpp: { ...DEFAULT_LLAMA_CPP_CONFIG, ...overrides } };
}

test("DEFAULT_LLAMA_CPP_CONFIG matches the llama.cpp server defaults", () => {
  // Source: https://github.com/ggml-org/llama.cpp/tree/master/tools/server
  // nCtx: concrete 2048 (not llama.cpp's 0) — see buildLlamaCppInitParams for
  // why the "0 = loaded from model" fallback is unreliable in llama.rn.
  // Reduced from 4096 to 2048 for faster inference in nutrition estimation use cases.
  assert.equal(DEFAULT_LLAMA_CPP_CONFIG.nCtx, 2048);
  assert.equal(DEFAULT_LLAMA_CPP_CONFIG.nBatch, 2048); // -b default 2048
  assert.equal(DEFAULT_LLAMA_CPP_CONFIG.nUbatch, 512); // -ub default 512
  assert.equal(DEFAULT_LLAMA_CPP_CONFIG.nThreads, -1); // -t default -1 (auto)
  assert.equal(DEFAULT_LLAMA_CPP_CONFIG.cacheTypeK, "f16"); // -ctk default f16
  assert.equal(DEFAULT_LLAMA_CPP_CONFIG.cacheTypeV, "f16"); // -ctv default f16
  assert.equal(DEFAULT_LLAMA_CPP_CONFIG.useMlock, false); // --mlock default off
  assert.equal(DEFAULT_LLAMA_CPP_CONFIG.useMmap, true); // --mmap default on
  // Flash-attn starts on 'auto'.
  assert.equal(DEFAULT_LLAMA_CPP_CONFIG.flashAttn, "auto");
  assert.equal(DEFAULT_LLAMA_CPP_CONFIG.nGpuLayers, 0); // -ngl default: CPU-only
});

test("normalization deep-merges partial overrides onto defaults", () => {
  const normalized = normalizeLlamaCppConfig({
    flashAttn: "on",
    nThreads: 6,
  });
  assert.equal(normalized.flashAttn, "on");
  assert.equal(normalized.nThreads, 6);
  // Untouched fields fall back to defaults.
  assert.equal(normalized.cacheTypeK, DEFAULT_LLAMA_CPP_CONFIG.cacheTypeK);
  assert.equal(normalized.reasoning, DEFAULT_LLAMA_CPP_CONFIG.reasoning);
});

test("normalization rejects unknown enum values and keeps defaults", () => {
  const normalized = normalizeLlamaCppConfig({
    flashAttn: "weird" as never,
    cacheTypeK: "q3_K" as never,
  });
  assert.equal(normalized.flashAttn, DEFAULT_LLAMA_CPP_CONFIG.flashAttn);
  assert.equal(normalized.cacheTypeK, DEFAULT_LLAMA_CPP_CONFIG.cacheTypeK);
});

test("normalization clamps ctx/batch to >= 0/1", () => {
  const normalized = normalizeLlamaCppConfig({
    nCtx: -50,
    nBatch: 0,
    nUbatch: 0,
  });
  assert.equal(normalized.nCtx, 0); // clamps to 0; builder guards against passing 0
  assert.equal(normalized.nBatch, 1);
  assert.equal(normalized.nUbatch, 1);
});

test("normalization treats threads < 1 as auto (-1) and does not cap positives", () => {
  // llama.cpp imposes no upper bound on -t.
  assert.equal(normalizeLlamaCppConfig({ nThreads: 99 }).nThreads, 99);
  assert.equal(normalizeLlamaCppConfig({ nThreads: 0 }).nThreads, -1);
  assert.equal(normalizeLlamaCppConfig({ nThreads: -5 }).nThreads, -1);
  assert.equal(normalizeLlamaCppConfig({ nThreads: -1 }).nThreads, -1); // preserved
  assert.equal(normalizeLlamaCppConfig({ nThreads: 8 }).nThreads, 8);
});

test("normalization accepts bf16 cache types", () => {
  const normalized = normalizeLlamaCppConfig({
    cacheTypeK: "bf16",
    cacheTypeV: "bf16",
  });
  assert.equal(normalized.cacheTypeK, "bf16");
  assert.equal(normalized.cacheTypeV, "bf16");
});

test("normalization copes with undefined/null input and returns full defaults", () => {
  assert.deepEqual(
    normalizeLlamaCppConfig(undefined),
    DEFAULT_LLAMA_CPP_CONFIG,
  );
  assert.deepEqual(normalizeLlamaCppConfig(null), DEFAULT_LLAMA_CPP_CONFIG);
});

// ── buildLlamaCppInitParams mapping ─────────────────────────────────────────

test("buildLlamaCppInitParams maps every llama.cpp field to its llama.rn counterpart", () => {
  const params = buildLlamaCppInitParams("/models/gemma.gguf", {
    llamaCpp: {
      nCtx: 8192,
      flashAttn: "on",
      nThreads: 6,
      nBatch: 1024,
      nUbatch: 512,
      cacheTypeK: "q8_0",
      cacheTypeV: "bf16",
      useMlock: true,
      useMmap: false,
      nGpuLayers: 16,
    },
  });

  assert.equal(params.model, "/models/gemma.gguf");
  assert.equal(params.n_ctx, 8192);
  assert.equal(params.flash_attn_type, "on");
  assert.equal(params.n_threads, 6);
  assert.equal(params.n_batch, 1024);
  assert.equal(params.n_ubatch, 512);
  assert.equal(params.cache_type_k, "q8_0");
  assert.equal(params.cache_type_v, "bf16");
  assert.equal(params.use_mlock, true);
  assert.equal(params.use_mmap, false);
  assert.equal(params.n_gpu_layers, 16);
});

test("buildLlamaCppInitParams never passes n_ctx 0 (unreliable in llama.rn)", () => {
  // llama.cpp `-c 0` means "loaded from model", but the llama.rn binding does
  // not reliably resolve that for all GGUF variants — 0 can yield a
  // near-empty context, so we substitute the concrete default (2048) instead.
  assert.equal(
    buildLlamaCppInitParams("/models/m.gguf", makeConfig({ nCtx: 0 })).n_ctx,
    2048,
  );
  assert.equal(
    buildLlamaCppInitParams("/models/m.gguf", makeConfig()).n_ctx,
    2048,
  );
  // An explicit non-zero value is honoured as-is.
  assert.equal(
    buildLlamaCppInitParams("/models/m.gguf", makeConfig({ nCtx: 8192 })).n_ctx,
    8192,
  );
});

test("defaults reproduce the user's Gemma example when set explicitly", () => {
  const params = buildLlamaCppInitParams("/models/gemma.gguf", {
    llamaCpp: {
      ...DEFAULT_LLAMA_CPP_CONFIG,
      flashAttn: "on",
    },
  });
  assert.equal(params.flash_attn_type, "on");
});
