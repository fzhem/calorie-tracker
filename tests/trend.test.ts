import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateBodyFatTrend,
  calculateWeightTrend,
  type TrendPoint,
} from "../lib/trend";

function makePoint(day: number, value: number): TrendPoint {
  const dayText = String(day).padStart(2, "0");
  return {
    recordedAt: `2026-05-${dayText}T08:00:00.000+00:00`,
    weightKg: value,
  };
}

test("calculateWeightTrend uses the latest points and detects recent loss", () => {
  const history: TrendPoint[] = [
    makePoint(1, 80.0),
    makePoint(2, 80.0),
    makePoint(3, 80.0),
    makePoint(4, 80.0),
    makePoint(5, 80.0),
    makePoint(6, 79.7),
    makePoint(7, 79.2),
    makePoint(8, 78.8),
  ];

  assert.equal(calculateWeightTrend(history), "losing");
});

test("calculateWeightTrend returns maintaining for tiny fluctuations", () => {
  const history: TrendPoint[] = [
    makePoint(1, 70.0),
    makePoint(2, 70.03),
    makePoint(3, 69.99),
    makePoint(4, 70.01),
    makePoint(5, 70.02),
  ];

  assert.equal(calculateWeightTrend(history), "maintaining");
});

test("calculateWeightTrend returns null when fewer than 2 points exist", () => {
  const history: TrendPoint[] = [makePoint(1, 70.0)];

  assert.equal(calculateWeightTrend(history), null);
});

test("calculateBodyFatTrend detects recent body-fat decrease", () => {
  const history: TrendPoint[] = [
    makePoint(1, 26.0),
    makePoint(2, 25.9),
    makePoint(3, 25.7),
    makePoint(4, 25.5),
    makePoint(5, 25.2),
  ];

  assert.equal(calculateBodyFatTrend(history), "losing");
});
