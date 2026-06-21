/**
 * Memory management utilities for model selection and usage.
 *
 * Memory thresholds based on TOTAL device RAM:
 * - Warning (50-60%): Show warning icon on model in settings
 * - Block (>60%): Grey out model in download and offline tabs, disable Estimate Calories
 */

import { getTotalMemorySync } from "react-native-device-info";

export const MB = 2 ** 20;
export const GB = 2 ** 30;

/** Model memory requirements in bytes */
export const MODEL_MEMORY_REQUIREMENTS: Record<string, number> = {
  GEMMA_4_E2B_IT: 2 * GB, // 2 GB
  GEMMA_4_E4B_IT: 4 * GB, // 4 GB
  // IBM Granite 4.0 H Micro (Q4_0 GGUF): ~1.73 GB on disk, rounded up to 2 GB RAM.
  GRANITE_4_0_H_MICRO: 2 * GB, // 2 GB
};

export type MemoryStatus = "ok" | "warning" | "blocked";

export type MemoryCheckResult = {
  status: MemoryStatus;
  totalMemoryBytes: number;
  modelMemoryBytes: number;
  usagePercent: number;
  threshold50Percent: number;
  threshold60Percent: number;
};

/**
 * Get total device memory synchronously.
 */
export function getTotalMemoryBytesSync(): number {
  return getTotalMemorySync();
}

/**
 * Check if a model can be used based on total device memory.
 */
export function checkModelMemory(modelKey: string): MemoryCheckResult {
  const modelMemoryBytes = MODEL_MEMORY_REQUIREMENTS[modelKey] ?? 0;
  const totalMem = getTotalMemoryBytesSync();

  const threshold50Percent = Math.round(totalMem * 0.5);
  const threshold60Percent = Math.round(totalMem * 0.6);
  const usagePercent =
    totalMem > 0 ? Math.round((modelMemoryBytes / totalMem) * 100) : 100;

  let status: MemoryStatus = "ok";
  if (modelMemoryBytes > threshold60Percent) {
    status = "blocked";
  } else if (modelMemoryBytes > threshold50Percent) {
    status = "warning";
  }

  return {
    status,
    totalMemoryBytes: totalMem,
    modelMemoryBytes,
    usagePercent,
    threshold50Percent,
    threshold60Percent,
  };
}

/**
 * Check memory status for all built-in models.
 * Returns a Promise with the memory warning level.
 */
export function getMemoryWarningLevel(): {
  hasBlocked: boolean;
  hasWarning: boolean;
  highestUsagePercent: number;
  totalMemoryGB: number;
} {
  const totalMem = getTotalMemoryBytesSync();
  const totalGB = totalMem / GB;

  let hasBlocked = false;
  let hasWarning = false;
  let highestUsagePercent = 0;

  for (const modelKey of Object.keys(MODEL_MEMORY_REQUIREMENTS)) {
    const result = checkModelMemory(modelKey);
    if (result.status === "blocked") hasBlocked = true;
    if (result.status === "warning") hasWarning = true;
    if (result.usagePercent > highestUsagePercent) {
      highestUsagePercent = result.usagePercent;
    }
  }

  return {
    hasBlocked,
    hasWarning,
    highestUsagePercent,
    totalMemoryGB: Math.round(totalGB * 10) / 10,
  };
}

export function formatModelMemoryRequirement(modelKey: string): string {
  const bytes = MODEL_MEMORY_REQUIREMENTS[modelKey] ?? 0;
  const gb = bytes / 2 ** 30;
  if (gb >= 1) {
    return `${gb} GB`;
  }
  const mb = bytes / 2 ** 20;
  return `${Math.round(mb)} MB`;
}
