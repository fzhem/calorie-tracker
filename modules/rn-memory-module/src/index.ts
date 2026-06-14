/**
 * Native memory tracking module.
 *
 * Provides exact same OS-level memory measurements as LiteRT:
 * - nativeHeapBytes: Debug.getNativeHeapAllocatedSize() on Android
 * - residentBytes: /proc/self/status VmRSS on Android
 * - availableMemoryBytes: ActivityManager.MemoryInfo.availMem
 * - totalMemoryBytes: ActivityManager.MemoryInfo.totalMem
 * - isLowMemory: ActivityManager.MemoryInfo.lowMemory
 */

import { requireNativeModule } from "expo-modules-core";

interface MemoryStats {
  nativeHeapBytes: number;
  residentBytes: number;
  availableMemoryBytes: number;
  totalMemoryBytes: number;
  isLowMemory: boolean;
}

interface RnMemoryModule {
  getNativeHeapBytes(): number;
  getResidentBytes(): number;
  getAvailableMemoryBytes(): number;
  getTotalMemoryBytes(): number;
  isLowMemory(): boolean;
  getMemoryStats(): MemoryStats;
}

let nativeModule: RnMemoryModule | null = null;

try {
  nativeModule = requireNativeModule("RnMemoryModule");
} catch {
  // Native module not available (e.g., on iOS or in Expo Go)
}

/**
 * Get the app's current native heap allocated size in bytes.
 * Uses Debug.getNativeHeapAllocatedSize() — the same API LiteRT uses.
 */
export function getNativeHeapBytes(): number {
  if (!nativeModule) return 0;
  return nativeModule.getNativeHeapBytes();
}

/**
 * Get the app's current resident set size (RSS) in bytes.
 * Reads from /proc/self/status VmRSS for the most accurate measurement.
 */
export function getResidentBytes(): number {
  if (!nativeModule) return 0;
  return nativeModule.getResidentBytes();
}

/**
 * Get available system memory in bytes.
 */
export function getAvailableMemoryBytes(): number {
  if (!nativeModule) return 0;
  return nativeModule.getAvailableMemoryBytes();
}

/**
 * Get total system memory in bytes.
 */
export function getTotalMemoryBytes(): number {
  if (!nativeModule) return 0;
  return nativeModule.getTotalMemoryBytes();
}

/**
 * Check if the system considers memory low.
 */
export function isLowMemory(): boolean {
  if (!nativeModule) return false;
  return nativeModule.isLowMemory();
}

/**
 * Get all memory stats in one native call (avoids multiple JNI crossings).
 */
export function getMemoryStats(): MemoryStats | null {
  if (!nativeModule) return null;
  return nativeModule.getMemoryStats();
}
