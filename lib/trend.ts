import {
  TREND_RECENT_POINTS,
  TREND_EMA_ALPHA,
  TREND_EMA_GAMMA,
} from "@/constants";
import { parseAppDate } from "@/lib/dateKey";

export type TrendPoint = {
  recordedAt: string;
  weightKg: number;
};

export type WeightTrend = "gaining" | "losing" | "maintaining";

export function calculateEMA(
  values: number[],
  smoothingFactor: number = 0.2,
): number[] {
  if (values.length === 0) return [];

  const ema: number[] = [];
  ema[0] = values[0];

  for (let i = 1; i < values.length; i++) {
    ema[i] = smoothingFactor * values[i] + (1 - smoothingFactor) * ema[i - 1];
  }

  return ema;
}

export function calculateTrendWithEMA(
  history: TrendPoint[],
  smoothingFactor: number,
  threshold: number,
): WeightTrend | null {
  if (history.length < 2) return null;

  const sorted = [...history].sort(
    (a, b) =>
      parseAppDate(a.recordedAt).getTime() -
      parseAppDate(b.recordedAt).getTime(),
  );

  const values = sorted.map((p) => p.weightKg);
  const ema = calculateEMA(values, smoothingFactor);
  const change = ema[ema.length - 1] - ema[0];

  if (change > threshold) return "gaining";
  if (change < -threshold) return "losing";
  return "maintaining";
}

export function calculateWeightTrend(
  history: TrendPoint[],
): WeightTrend | null {
  const recent = history.slice(-TREND_RECENT_POINTS);
  return calculateTrendWithEMA(recent, TREND_EMA_ALPHA, TREND_EMA_GAMMA);
}

export function calculateBodyFatTrend(
  history: TrendPoint[],
): WeightTrend | null {
  const recent = history.slice(-TREND_RECENT_POINTS);
  return calculateTrendWithEMA(recent, TREND_EMA_ALPHA, TREND_EMA_GAMMA);
}
