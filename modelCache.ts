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

function notify() {
  listeners.forEach((fn) => fn());
}

export function getModelInstance(): any {
  return _instance;
}

export function getLoadedModelKey(): string | null {
  return _loadedKey;
}

/** Store a freshly loaded model. Closes any previously cached instance. */
export function setModelCache(instance: any, key: string) {
  if (_instance && _instance !== instance) {
    try { _instance.close(); } catch {}
  }
  _instance = instance;
  _loadedKey = key;
  notify();
}

/** Evict the cached model and release native resources. */
export function clearModelCache() {
  if (_instance) {
    try { _instance.close(); } catch {}
  }
  _instance = null;
  _loadedKey = null;
  notify();
}

/** Subscribe function for useSyncExternalStore. */
export function subscribeModelCache(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Snapshot function for useSyncExternalStore — returns the loaded key. */
export function getModelKeySnapshot(): string | null {
  return _loadedKey;
}
