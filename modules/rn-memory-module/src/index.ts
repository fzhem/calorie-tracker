import { NativeModules } from "react-native";

export interface MemoryUsage {
  nativeHeapBytes: number;
  residentBytes: number;
  availableMemoryBytes: number;
  isLowMemory: boolean;
}

export function getMemoryUsage(): Promise<MemoryUsage | null> {
  const mod = NativeModules.RNMemoryModule;
  if (!mod?.getMemoryUsage) return Promise.resolve(null);
  return mod.getMemoryUsage().catch(() => null);
}
