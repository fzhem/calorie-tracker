/**
 * Architecture detection utilities for LiteRT support.
 *
 * LiteRT (LLM on-device inference) only supports arm64-v8a architecture.
 * This module provides utilities to detect the device architecture and
 * determine if LiteRT is supported.
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
    return ""; // It's supported
  }

  const reasons: Record<Exclude<DeviceArchitecture, "arm64-v8a">, string> = {
    "armeabi-v7a":
      "LiteRT is not available on 32-bit ARM devices. Please use an arm64-v8a device.",
    x86_64:
      "LiteRT is not available on 64-bit Intel devices. Please use an arm64-v8a device.",
    x86: "LiteRT is not available on 32-bit Intel devices. Please use an arm64-v8a device.",
    unknown:
      "Unable to determine device architecture. AI meal estimation may not be available.",
  };

  return reasons[arch as Exclude<DeviceArchitecture, "arm64-v8a">];
}

/**
 * Reset cached architecture (useful for testing).
 */
export function resetArchitectureCache(): void {
  cachedArchitecture = null;
}
