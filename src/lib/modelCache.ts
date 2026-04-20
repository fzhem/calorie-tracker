/**
 * Module-level singleton for the active LLM instance.
 *
 * Keeps at most one model loaded at a time. Calling setModelCache when
 * a different instance is already loaded will close the old one first.
 * Compatible with React's useSyncExternalStore.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

let _instance: any = null;
let _loadedKey: string | null = null;
let _memoryUsageRSS: number | null = null;

function notify() {
  listeners.forEach((fn) => fn());
}

export function getModelInstance(): any {
  return _instance;
}

export function getLoadedModelKey(): string | null {
  return _loadedKey;
}

/**
 * Get the current memory usage (RSS) of the loaded model in bytes.
 * Returns null if memory tracking is not enabled or no model is loaded.
 */
export function getModelMemoryUsageBytes(): number | null {
  if (!_instance) return null;
  try {
    if (typeof _instance.getMemoryUsage === "function") {
      const usage = _instance.getMemoryUsage();
      // usage is an object like { residentBytes, nativeHeapBytes, availableMemoryBytes, isLowMemory }
      if (
        usage &&
        typeof usage === "object" &&
        typeof usage.residentBytes === "number"
      ) {
        return usage.residentBytes;
      }
      return null;
    }
    return _memoryUsageRSS;
  } catch {
    return null;
  }
}

/** Store a freshly loaded model. Closes any previously cached instance. */
export function setModelCache(instance: any, key: string) {
  if (_instance && _instance !== instance) {
    try {
      _instance.close();
    } catch {}
  }
  _instance = instance;
  _loadedKey = key;
  _memoryUsageRSS = null;
  // Try to get initial memory usage
  if (instance && typeof instance.getMemoryUsage === "function") {
    try {
      const usage = instance.getMemoryUsage();
      if (
        usage &&
        typeof usage === "object" &&
        typeof usage.residentBytes === "number"
      ) {
        _memoryUsageRSS = usage.residentBytes;
      }
    } catch {}
  }
  notify();
}

/** Evict the cached model and release native resources. */
export function clearModelCache() {
  if (_instance) {
    try {
      _instance.close();
    } catch {}
  }
  _instance = null;
  _loadedKey = null;
  _memoryUsageRSS = null;
  notify();
}

/** Subscribe function for useSyncExternalStore. */
export function subscribeModelCache(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Snapshot function for useSyncExternalStore — returns the loaded key. */
export function getModelKeySnapshot(): string | null {
  return _loadedKey;
}
