import { NativeModules } from "react-native";

export interface NativeMemoryUsage {
  nativeHeapBytes: number;
  residentBytes: number;
  availableMemoryBytes: number;
  isLowMemory: boolean;
}

let cached: NativeMemoryUsage | null = null;
let pending: Promise<void> | null = null;

async function refresh(): Promise<void> {
  try {
    const result = await NativeModules.RNMemoryModule?.getMemoryUsage();
    if (result && typeof result.nativeHeapBytes === "number") {
      cached = {
        nativeHeapBytes: result.nativeHeapBytes,
        residentBytes: result.residentBytes ?? result.nativeHeapBytes,
        availableMemoryBytes: result.availableMemoryBytes ?? 0,
        isLowMemory: !!result.isLowMemory,
      };
    }
  } catch {}
}

export function getNativeMemoryUsage(): NativeMemoryUsage | null {
  if (!pending) {
    pending = refresh();
  }
  return cached;
}

export async function refreshMemoryCache(): Promise<void> {
  pending = refresh();
  await pending;
}
