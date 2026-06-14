/**
 * Architecture detection utilities for on-device inference.
 *
 * LiteRT (LLM on-device inference) only supports arm64-v8a architecture.
 * llama.cpp (llama.cpp via JSI) supports a wider range of architectures
 * including arm64-v8a, armeabi-v7a, and x86_64.
 *
 * This module provides utilities to detect the device architecture and
 * determine which inference backends are supported.
 */

import { Platform } from "react-native";
import { supportedAbisSync } from "react-native-device-info";

export type SupportedArchitecture = "arm64-v8a" | "unknown";
export type DeviceArchitecture =
  | SupportedArchitecture
  | "armeabi-v7a"
  | "x86_64"
  | "x86";

let cachedArchitecture: DeviceArchitecture | null = null;

/**
 * Detect the device CPU architecture.
 *
 * Uses react-native-device-info's supportedAbisSync() to get the list of supported ABIs.
 */
export function detectArchitecture(): DeviceArchitecture {
  if (cachedArchitecture) {
    return cachedArchitecture;
  }

  if (Platform.OS !== "android") {
    cachedArchitecture = "unknown";
    return cachedArchitecture;
  }

  try {
    const abis = supportedAbisSync();
    // Priority: arm64-v8a > armeabi-v7a > x86_64 > x86
    if (abis.includes("arm64-v8a")) {
      cachedArchitecture = "arm64-v8a";
    } else if (abis.includes("armeabi-v7a")) {
      cachedArchitecture = "armeabi-v7a";
    } else if (abis.includes("x86_64")) {
      cachedArchitecture = "x86_64";
    } else if (abis.includes("x86")) {
      cachedArchitecture = "x86";
    } else {
      cachedArchitecture = "unknown";
    }
  } catch (error) {
    console.warn("Failed to detect architecture:", error);
    cachedArchitecture = "unknown";
  }
  return cachedArchitecture;
}

/**
 * Check if the device architecture supports LiteRT.
 * Currently only arm64-v8a (64-bit ARM) is supported.
 */
export function isLiteRTSupported(arch: DeviceArchitecture): boolean {
  return arch === "arm64-v8a";
}

/**
 * Check if the device architecture supports llama.cpp.
 * llama.cpp (llama.cpp via JSI) supports ARM 64-bit, ARM 32-bit, and x86_64.
 */
export function isLlamaCppSupported(arch: DeviceArchitecture): boolean {
  return arch === "arm64-v8a" || arch === "armeabi-v7a" || arch === "x86_64";
}

/**
 * @deprecated Use isLlamaCppSupported instead.
 */
export const isLlamaRNSupported = isLlamaCppSupported;

/**
 * Get user-friendly architecture name for UI display.
 */
export function getArchitectureLabel(arch: DeviceArchitecture): string {
  const labels: Record<DeviceArchitecture, string> = {
    "arm64-v8a": "ARM 64-bit",
    "armeabi-v7a": "ARM 32-bit",
    x86: "Intel 32-bit",
    x86_64: "Intel 64-bit",
    unknown: "Unknown",
  };
  return labels[arch];
}

/**
 * Get detailed explanation for why LiteRT is not supported on this architecture.
 */
export function getLiteRTUnsupportedReason(arch: DeviceArchitecture): string {
  if (arch === "arm64-v8a") {
    return "";
  }

  const reasons: Record<Exclude<DeviceArchitecture, "arm64-v8a">, string> = {
    "armeabi-v7a":
      "LiteRT is not available on 32-bit ARM devices. Please use an arm64-v8a device, or switch to llama.cpp backend in Settings.",
    x86_64:
      "LiteRT is not available on 64-bit Intel devices. Please use an arm64-v8a device, or switch to llama.cpp backend in Settings.",
    x86: "LiteRT is not available on 32-bit Intel devices. Please use an arm64-v8a device.",
    unknown:
      "Unable to determine device architecture. AI meal estimation may not be available.",
  };

  return reasons[arch as Exclude<DeviceArchitecture, "arm64-v8a">];
}

/**
 * Get explanation for why llama.cpp is not supported on this architecture.
 */
export function getLlamaCppUnsupportedReason(arch: DeviceArchitecture): string {
  if (isLlamaCppSupported(arch)) {
    return "";
  }

  const reasons: Record<
    Exclude<DeviceArchitecture, "arm64-v8a" | "armeabi-v7a" | "x86_64">,
    string
  > = {
    x86: "llama.cpp is not available on 32-bit Intel devices. Please use an arm64-v8a device.",
    unknown:
      "Unable to determine device architecture. AI meal estimation may not be available.",
  };

  return reasons[arch as "x86" | "unknown"] ?? reasons.unknown;
}

/**
 * @deprecated Use getLlamaCppUnsupportedReason instead.
 */
export const getLlamaRNUnsupportedReason = getLlamaCppUnsupportedReason;

/**
 * Check if a given inference backend is supported on the device.
 */
export function isBackendSupported(
  backend: "litert" | "llama-cpp",
  arch: DeviceArchitecture,
): boolean {
  if (backend === "litert") return isLiteRTSupported(arch);
  return isLlamaCppSupported(arch);
}

/**
 * Get unsupported reason for a given backend.
 */
export function getBackendUnsupportedReason(
  backend: "litert" | "llama-cpp",
  arch: DeviceArchitecture,
): string {
  if (backend === "litert") return getLiteRTUnsupportedReason(arch);
  return getLlamaCppUnsupportedReason(arch);
}

/**
 * Reset cached architecture (useful for testing).
 */
export function resetArchitectureCache(): void {
  cachedArchitecture = null;
}
