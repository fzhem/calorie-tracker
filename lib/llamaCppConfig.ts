/**
 * llama.cpp advanced configuration: types, defaults, normalization, and the
 * translation into llama.rn `ContextParams`.
 *
 * This module is deliberately free of any `react-native` / `llama.rn` imports
 * so it can be unit-tested under plain Node and reused without native deps.
 *
 * Each field maps 1:1 to a llama-server CLI flag / llama.rn context param.
 * llama.rn API reference: https://github.com/mybigday/llama.rn
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** `-fa` / `flash_attn_type` — flash attention mode. */
export type LlamaCppFlashAttn = "auto" | "on" | "off";

/** `-rea` / `--reasoning` — reasoning/thinking mode (llama.cpp default: auto). */
export type LlamaCppReasoning = "auto" | "on" | "off";

/**
 * `-ctk` / `-ctv` — KV cache data type for K/V.
 * Allowed values (per llama.cpp server docs):
 * f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1
 */
export type LlamaCppCacheType =
  | "f32"
  | "f16"
  | "bf16"
  | "q8_0"
  | "q4_0"
  | "q4_1"
  | "iq4_nl"
  | "q5_0"
  | "q5_1";

/**
 * llama.cpp-specific context options, mapped 1:1 to llama.rn `ContextParams`.
 * Only applied when the active backend is `llama-cpp`.
 */
export type LlamaCppAdvancedConfig = {
  /**
   * `-c` — size of the prompt context (`n_ctx`).
   * Defaults to 4096 (a concrete size); 0 means "loaded from model" but is
   * unreliable in the llama.rn binding for some GGUF variants.
   */
  nCtx: number;
  /** `-fa` — flash attention (`flash_attn_type`). */
  flashAttn: LlamaCppFlashAttn;
  /** `-rea` / `--reasoning` — reasoning/thinking mode for chat templates. */
  reasoning: LlamaCppReasoning;
  /** `-t` — number of CPU threads during generation (`n_threads`). -1 = auto. */
  nThreads: number;
  /** `-b` — logical maximum batch size (`n_batch`). */
  nBatch: number;
  /** `-ub` — physical maximum batch size (`n_ubatch`). */
  nUbatch: number;
  /** `-ctk` — KV cache data type for K (`cache_type_k`). */
  cacheTypeK: LlamaCppCacheType;
  /** `-ctv` — KV cache data type for V (`cache_type_v`). */
  cacheTypeV: LlamaCppCacheType;
  /** `--mlock` — force system to keep model in RAM rather than swapping (`use_mlock`). */
  useMlock: boolean;
  /** `--mmap` / `--no-mmap` — whether to memory-map the model (`use_mmap`). */
  useMmap: boolean;
  /**
   * `-ngl` / `--gpu-layers` — number of layers to offload to GPU (`n_gpu_layers`).
   * 0 = CPU-only. Set to a large number (e.g. 99) to offload all layers.
   * On Android requires OpenCL (Qualcomm Adreno 700+) and a Q4_0 / Q6_K model.
   * On iOS uses Metal automatically. Defaults to 99 (all layers to GPU).
   */
  nGpuLayers: number;
};

/**
 * Minimal structural view of a persisted model config. Kept local so this
 * module stays decoupled from the storage layer (and its react-native deps).
 */
export interface ModelConfigLike {
  llamaCpp?: Partial<LlamaCppAdvancedConfig>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Defaults mirror the llama.cpp server CLI where the binding reliably
 * supports them.
 * Source: https://github.com/ggml-org/llama.cpp/tree/master/tools/server
 *   -b   batch-size  default 2048
 *   -ub  ubatch-size default 512
 *   -t   threads     default -1  (-1 = auto)
 *   -ctk cache-type-k default f16
 *   -ctv cache-type-v default f16
 *   -rea reasoning   default auto
 *   --mlock            default disabled
 *   --mmap             default enabled
 *
 * NOTE on -c / n_ctx: llama.cpp's default is 0 ("loaded from model"), but the
 * llama.rn binding does NOT reliably resolve that fallback — for many GGUF
 * variants (e.g. QAT builds whose n_ctx_train metadata is missing/unread), 0
 * yields a near-empty context that the prompt immediately fills, producing
 * `context_full` + zero generated tokens. We therefore ship a concrete
 * default (2048). Users can still type 0 explicitly if they know their model
 * exposes n_ctx_train.
 * (spec decoding is off by default; flash-attn is not a server default but
 *  starts on 'auto' here.)
 */
export const DEFAULT_LLAMA_CPP_CONFIG: LlamaCppAdvancedConfig = {
  nCtx: 2048,
  flashAttn: "auto",
  reasoning: "auto",
  nThreads: -1,
  nBatch: 2048,
  nUbatch: 512,
  cacheTypeK: "f16",
  cacheTypeV: "f16",
  useMlock: false,
  useMmap: true,
  // 0 = CPU-only inference (best performance on tested devices).
  // Raise this value to offload layers to GPU when benchmarking shows a gain.
  nGpuLayers: 0,
};

const VALID_FLASH_ATTN: readonly LlamaCppFlashAttn[] = ["auto", "on", "off"];
const VALID_REASONING: readonly LlamaCppReasoning[] = ["auto", "on", "off"];
const VALID_CACHE_TYPES: readonly LlamaCppCacheType[] = [
  "f32",
  "f16",
  "bf16",
  "q8_0",
  "q4_0",
  "q4_1",
  "iq4_nl",
  "q5_0",
  "q5_1",
];

const isValidFlashAttn = (v: unknown): v is LlamaCppFlashAttn =>
  typeof v === "string" && (VALID_FLASH_ATTN as readonly string[]).includes(v);
const isValidReasoning = (v: unknown): v is LlamaCppReasoning =>
  typeof v === "string" && (VALID_REASONING as readonly string[]).includes(v);
const isValidCacheType = (v: unknown): v is LlamaCppCacheType =>
  typeof v === "string" && (VALID_CACHE_TYPES as readonly string[]).includes(v);

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Merge a stored partial llama.cpp config onto the defaults, validating enums
 * and clamping numbers so corrupted/migrated storage never crashes native
 * `initLlama()`.
 */
export function normalizeLlamaCppConfig(
  overrides?: Partial<LlamaCppAdvancedConfig> | null,
): LlamaCppAdvancedConfig {
  const merged: LlamaCppAdvancedConfig = { ...DEFAULT_LLAMA_CPP_CONFIG };
  if (!overrides || typeof overrides !== "object") return merged;

  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;

  merged.nCtx = Math.max(0, Math.round(num(overrides.nCtx, merged.nCtx)));
  merged.flashAttn = isValidFlashAttn(overrides.flashAttn)
    ? overrides.flashAttn
    : merged.flashAttn;
  merged.reasoning = isValidReasoning(overrides.reasoning)
    ? overrides.reasoning
    : merged.reasoning;
  // -t: -1 means auto (the llama.cpp default). 0 / negative-non-(-1) coerce
  // to -1; positive values pass through uncapped (llama.cpp imposes no max).
  let nThreads = Math.round(num(overrides.nThreads, merged.nThreads));
  if (nThreads < 1) nThreads = -1;
  merged.nThreads = nThreads;
  merged.nBatch = Math.max(1, Math.round(num(overrides.nBatch, merged.nBatch)));
  merged.nUbatch = Math.max(
    1,
    Math.round(num(overrides.nUbatch, merged.nUbatch)),
  );
  merged.cacheTypeK = isValidCacheType(overrides.cacheTypeK)
    ? overrides.cacheTypeK
    : merged.cacheTypeK;
  merged.cacheTypeV = isValidCacheType(overrides.cacheTypeV)
    ? overrides.cacheTypeV
    : merged.cacheTypeV;
  merged.useMlock =
    typeof overrides.useMlock === "boolean"
      ? overrides.useMlock
      : merged.useMlock;
  merged.useMmap =
    typeof overrides.useMmap === "boolean" ? overrides.useMmap : merged.useMmap;
  merged.nGpuLayers = Math.max(
    0,
    Math.round(num(overrides.nGpuLayers, merged.nGpuLayers)),
  );
  return merged;
}

// ---------------------------------------------------------------------------
// initLlama() param construction
// ---------------------------------------------------------------------------

/**
 * Build the llama.rn `ContextParams` object from our config, mapping every
 * field to the corresponding llama.cpp/llama.rn option.
 *
 * @param modelPath  Cleaned filesystem path to the .gguf file.
 * @param config     Persisted model config (reads the `llamaCpp` overrides).
 */
export function buildLlamaCppInitParams(
  modelPath: string,
  config: ModelConfigLike,
): Record<string, unknown> {
  const llamaCpp: LlamaCppAdvancedConfig = {
    ...DEFAULT_LLAMA_CPP_CONFIG,
    ...(config.llamaCpp ?? {}),
  };

  const params: Record<string, unknown> = {
    model: modelPath,
    embedding: false,
    // n_ctx: a concrete size is required for reliable inference. llama.cpp's
    // "0 = loaded from model" fallback is NOT reliably honoured by the llama.rn
    // binding (some GGUF builds resolve 0 to a near-empty context, causing
    // `context_full` + zero output), so we never let it fall through to 0.
    n_ctx: llamaCpp.nCtx > 0 ? llamaCpp.nCtx : DEFAULT_LLAMA_CPP_CONFIG.nCtx,
    n_threads: llamaCpp.nThreads,
    n_batch: llamaCpp.nBatch,
    n_ubatch: llamaCpp.nUbatch,
    // n_gpu_layers: omitted — CPU-only by design (no GPU/OpenCL support).
    flash_attn_type: llamaCpp.flashAttn,
    cache_type_k: llamaCpp.cacheTypeK,
    cache_type_v: llamaCpp.cacheTypeV,
    use_mlock: llamaCpp.useMlock,
    use_mmap: llamaCpp.useMmap,
    // reasoning: "auto" = model decides, "on" = force, "off" = disable.
    // Passed to init so the jinja template can use it for enable_thinking.
    reasoning: llamaCpp.reasoning,
    // n_gpu_layers > 0 offloads that many layers to GPU (Metal on iOS, OpenCL
    // on Android Qualcomm Adreno 700+ with Q4_0/Q6_K models). llama.cpp falls
    // back to CPU silently when the device or quantisation is unsupported.
    n_gpu_layers: llamaCpp.nGpuLayers,
  };

  return params;
}
