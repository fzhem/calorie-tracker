import test from "node:test";
import assert from "node:assert/strict";

import {
  CACHE_TAGS,
  cacheSize,
  getCachedOrFetch,
  getCachedSync,
  invalidateBodyFatCaches,
  invalidateCache,
  invalidateCacheTag,
  invalidateMealCaches,
  invalidateWeightCaches,
  queryKeys,
} from "../lib/queryCache";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.beforeEach(() => {
  invalidateCache();
});

test.afterEach(() => {
  invalidateCache();
});

test("getCachedOrFetch reuses cached values until ttl expires", async () => {
  let fetchCount = 0;

  const first = await getCachedOrFetch(
    queryKeys.recentMeals(30),
    async () => {
      fetchCount += 1;
      return { total: 1 };
    },
    { ttlMs: 15, tags: [CACHE_TAGS.meals] },
  );

  const second = await getCachedOrFetch(
    queryKeys.recentMeals(30),
    async () => {
      fetchCount += 1;
      return { total: 2 };
    },
    { ttlMs: 15, tags: [CACHE_TAGS.meals] },
  );

  await sleep(20);

  const third = await getCachedOrFetch(
    queryKeys.recentMeals(30),
    async () => {
      fetchCount += 1;
      return { total: 3 };
    },
    { ttlMs: 15, tags: [CACHE_TAGS.meals] },
  );

  assert.deepEqual(first, { total: 1 });
  assert.deepEqual(second, { total: 1 });
  assert.deepEqual(third, { total: 3 });
  assert.equal(fetchCount, 2);
});

test("domain invalidation helpers only clear matching tagged entries", async () => {
  await getCachedOrFetch(queryKeys.recentMeals(30), async () => ["meal"], {
    tags: [CACHE_TAGS.meals],
  });
  await getCachedOrFetch(queryKeys.weightSeries(365), async () => ["weight"], {
    tags: [CACHE_TAGS.weight],
  });
  await getCachedOrFetch(
    queryKeys.bodyFatSeries(365),
    async () => ["body-fat"],
    { tags: [CACHE_TAGS.bodyFat] },
  );

  invalidateMealCaches();

  assert.equal(getCachedSync(queryKeys.recentMeals(30)), null);
  assert.deepEqual(getCachedSync(queryKeys.weightSeries(365)), ["weight"]);
  assert.deepEqual(getCachedSync(queryKeys.bodyFatSeries(365)), ["body-fat"]);

  invalidateWeightCaches();
  invalidateBodyFatCaches();

  assert.equal(cacheSize(), 0);
});

test("tag invalidation clears all keys associated with that tag", async () => {
  await getCachedOrFetch(queryKeys.recentMeals(7), async () => [1], {
    tags: [CACHE_TAGS.meals],
  });
  await getCachedOrFetch(queryKeys.recentMeals(30), async () => [2], {
    tags: [CACHE_TAGS.meals],
  });
  await getCachedOrFetch(queryKeys.latestWeight, async () => 72, {
    tags: [CACHE_TAGS.weight],
  });

  invalidateCacheTag(CACHE_TAGS.meals);

  assert.equal(getCachedSync(queryKeys.recentMeals(7)), null);
  assert.equal(getCachedSync(queryKeys.recentMeals(30)), null);
  assert.equal(getCachedSync(queryKeys.latestWeight), 72);
});
