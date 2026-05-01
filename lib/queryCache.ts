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
  tags: string[];
};

const store = new Map<string, CacheEntry<unknown>>();

const DEFAULT_TTL_MS = 30_000; // 30 seconds

export const CACHE_TAGS = {
  meals: "meals",
  weight: "weight",
  bodyFat: "bodyFat",
  settings: "settings",
} as const;

export const CACHE_TTL_MS = {
  // Meals: frequently updated by user; shorter TTL
  mealsRecent: 60_000, // 1 min
  dayMeals: 5 * 60_000, // 5 min
  // Weight/Body Fat: stable data, infrequent updates; much longer TTL
  weightSeries: 45 * 60_000, // 45 min
  bodyFatSeries: 45 * 60_000, // 45 min
  latestWeight: 10 * 60_000, // 10 min
  latestBodyFat: 10 * 60_000, // 10 min
} as const;

type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

type CacheOptions = {
  ttlMs?: number;
  tags?: CacheTag[];
};

export const queryKeys = {
  recentMeals(days: number) {
    return `meals:recent:${days}d`;
  },
  dayMeals(dateKey: string) {
    return `meals:day:${dateKey}`;
  },
  weightSeries(days: number) {
    return `weight:series:${days}d`;
  },
  bodyFatSeries(days: number) {
    return `bodyFat:series:${days}d`;
  },
  latestWeight: "weight:latest",
  latestBodyFat: "bodyFat:latest",
} as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function now() {
  return Date.now();
}

function isAlive<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return entry !== undefined && entry.expiry > now();
}

function resolveCacheOptions(ttlOrOptions: number | CacheOptions | undefined) {
  if (typeof ttlOrOptions === "number") {
    return { ttlMs: ttlOrOptions, tags: [] as CacheTag[] };
  }

  return {
    ttlMs: ttlOrOptions?.ttlMs ?? DEFAULT_TTL_MS,
    tags: ttlOrOptions?.tags ?? [],
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Returns a cached value if one exists and hasn't expired, otherwise
 * calls `fetchFn`, caches the result, and returns it.
 */
export async function getCachedOrFetch<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlOrOptions: number | CacheOptions = DEFAULT_TTL_MS,
): Promise<T> {
  const { ttlMs, tags } = resolveCacheOptions(ttlOrOptions);
  const existing = store.get(key);
  if (isAlive(existing)) {
    return existing.data as T;
  }

  const data = await fetchFn();
  store.set(key, { data, expiry: now() + ttlMs, tags });
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

export function invalidateCacheTag(tag: CacheTag): void {
  for (const [key, entry] of store.entries()) {
    if (entry.tags.includes(tag)) {
      store.delete(key);
    }
  }
}

export function invalidateCacheTags(tags: CacheTag[]): void {
  for (const [key, entry] of store.entries()) {
    if (tags.some((tag) => entry.tags.includes(tag))) {
      store.delete(key);
    }
  }
}

export function invalidateMealCaches(): void {
  invalidateCacheTag(CACHE_TAGS.meals);
}

export function invalidateWeightCaches(): void {
  invalidateCacheTag(CACHE_TAGS.weight);
}

export function invalidateBodyFatCaches(): void {
  invalidateCacheTag(CACHE_TAGS.bodyFat);
}

/**
 * How many entries are currently in the cache (debugging/metrics).
 */
export function cacheSize(): number {
  return store.size;
}
