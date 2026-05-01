import test from "node:test";
import assert from "node:assert/strict";

import {
  getLocalDateKey,
  parseAppDate,
  toLocalISOString,
} from "../lib/dateKey";

test("getLocalDateKey returns YYYY-MM-DD with zero padding", () => {
  const date = new Date(2026, 0, 3, 8, 5, 2, 9);

  assert.equal(getLocalDateKey(date), "2026-01-03");
});

test("toLocalISOString returns local date-time components with an explicit timezone offset", () => {
  const date = new Date(2026, 4, 1, 9, 7, 5, 4);

  assert.match(
    toLocalISOString(date),
    /^2026-05-01T09:07:05\.004[+-]\d{2}:\d{2}$/,
  );
});

test("date key and timestamp prefix stay aligned for local-day bucketing", () => {
  const date = new Date(2026, 10, 30, 23, 59, 59, 999);

  const dayKey = getLocalDateKey(date);
  const timestampPrefix = toLocalISOString(date).slice(0, 10);

  assert.equal(timestampPrefix, dayKey);
});

test("local day key flips at midnight boundary", () => {
  const beforeMidnight = new Date(2026, 4, 1, 23, 59, 59, 999);
  const afterMidnight = new Date(2026, 4, 2, 0, 0, 0, 0);

  assert.equal(getLocalDateKey(beforeMidnight), "2026-05-01");
  assert.equal(getLocalDateKey(afterMidnight), "2026-05-02");
});

test("parseAppDate round-trips offset-bearing timestamps to the same instant", () => {
  const timestamp = toLocalISOString(new Date(2026, 6, 14, 20, 54, 0, 0));

  assert.equal(
    parseAppDate(timestamp).toISOString(),
    new Date(timestamp).toISOString(),
  );
});
