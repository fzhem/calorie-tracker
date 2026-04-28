/**
 * Lightweight in-memory query cache with TTL-based invalidation.
 *
 * Every cached entry has an expiry timestamp. Expired entries are lazily
 * evicted on the next read or write.  Explicit invalidation is available
 * for call-sites that know data has changed (e.g. after a Health Connect
 * sync or manual weight entry).
 */

type CacheEntry<T> = {
  data: T;
  expiry: number;
};

const store = new Map<string, CacheEntry<unknown>>();

const DEFAULT_TTL_MS = 30_000; // 30 seconds

// ── Helpers ────────────────────────────────────────────────────────────────

function now() {
  return Date.now();
}

function isAlive<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return entry !== undefined && entry.expiry > now();
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Returns a cached value if one exists and hasn't expired, otherwise
 * calls `fetchFn`, caches the result, and returns it.
 */
export async function getCachedOrFetch<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const existing = store.get(key);
  if (isAlive(existing)) {
    return existing.data as T;
  }

  const data = await fetchFn();
  store.set(key, { data, expiry: now() + ttlMs });
  return data;
}

/**
 * Synchronous version for when the data is already in memory.
 * Returns `null` when the key is missing or expired.
 */
export function getCachedSync<T>(key: string): T | null {
  const entry = store.get(key);
  if (isAlive(entry)) return entry.data as T;
  return null;
}

/**
 * Remove a specific cache entry.  If `key` is omitted **all** entries
 * are cleared — use sparingly.
 */
export function invalidateCache(key?: string): void {
  if (key) {
    store.delete(key);
  } else {
    store.clear();
  }
}

/**
 * Remove every entry whose key starts with the given prefix.
 * Useful when multiple cache entries belong to the same domain
 * (e.g. all weight-related keys).
 */
export function invalidateCachePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) {
      store.delete(key);
    }
  }
}

/**
 * How many entries are currently in the cache (debugging/metrics).
 */
export function cacheSize(): number {
  return store.size;
}
