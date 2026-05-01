import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { BarChart, LineChart } from "react-native-chart-kit";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Card,
  SegmentedButtons,
  Text,
  Button,
  useTheme,
} from "react-native-paper";
import Svg, { G, Line, Rect, Text as SvgText, Circle } from "react-native-svg";
import { getAppSegmentedButtonsTheme } from "@/ui/segmentedButtons";

import { getAdjustedCalorieTarget } from "@/domain/metabolism";
import {
  DEFAULT_DATA,
  getCachedData,
  loadStoredData as readStoredData,
} from "@/data/storage";
import type { StoredData } from "@/data/storage";
import type { Weight, BodyFat, Meal } from "@/db/index";

import {
  GRAPH_MAX_DAYS_SHORT,
  GRAPH_MAX_DAYS_MEDIUM,
  GRAPH_MAX_DAYS_LONG,
} from "@/constants";

import { getMealsSince, getWeightSeries, getBodyFatSeries } from "@/db/index";
import {
  CACHE_TAGS,
  CACHE_TTL_MS,
  getCachedOrFetch,
  queryKeys,
} from "@/lib/queryCache";
import { getLocalDateKey, parseAppDate, toLocalISOString } from "@/lib/dateKey";
import { calculateBodyFatTrend, calculateWeightTrend } from "@/lib/trend";

const WEIGHT_CHART_HEIGHT = 220;
const WEIGHT_GUIDE_BOTTOM = WEIGHT_CHART_HEIGHT - 40;
const GRAPH_FOCUS_REFRESH_INTERVAL_MS = 30_000;

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Return an ISO timestamp N days before now. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toLocalISOString(d);
}

function formatDayLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
  });
}

function formatShortDay(date: Date) {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatCalorieLabel(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  if (days <= 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  if (days <= 31) return d.toLocaleDateString(undefined, { day: "numeric" });
  return formatShortDay(d);
}

function formatWeightLabel(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  if (days <= 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  if (days <= 31) return d.toLocaleDateString(undefined, { day: "numeric" });
  if (days <= 90)
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
}

type WeightTrendPoint = {
  recordedAt: string;
  weightKg: number;
  axisLabel: string;
  bubbleLabel: string;
  isAverage: boolean;
};

function toStartOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toStartOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function toEndOfDay(date: Date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
}

function averageWeight(values: number[]) {
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 100) / 100;
}

function formatDateRange(start: Date, end: Date, includeYear: boolean) {
  const rangeStart = toStartOfDay(start);
  const rangeEnd = toStartOfDay(end);
  const startMonth = rangeStart.toLocaleDateString(undefined, {
    month: "short",
  });
  const endMonth = rangeEnd.toLocaleDateString(undefined, { month: "short" });
  const startDay = String(rangeStart.getDate()).padStart(2, "0");
  const endDay = String(rangeEnd.getDate()).padStart(2, "0");
  const sameYear = rangeStart.getFullYear() === rangeEnd.getFullYear();
  const sameMonth = sameYear && rangeStart.getMonth() === rangeEnd.getMonth();

  if (sameMonth) {
    return `${startMonth} ${startDay}~${endDay}${includeYear ? ` ${rangeEnd.getFullYear()}` : ""}`;
  }

  if (sameYear) {
    return `${startMonth} ${startDay}~${endMonth} ${endDay}${includeYear ? ` ${rangeEnd.getFullYear()}` : ""}`;
  }

  return `${startMonth} ${startDay} ${rangeStart.getFullYear()}~${endMonth} ${endDay} ${rangeEnd.getFullYear()}`;
}

function formatWeightValue(weightKg: number) {
  return `${weightKg.toFixed(2)} kg`;
}

function formatBodyFatValue(bodyFatPercentage: number) {
  return `${bodyFatPercentage.toFixed(2)}%`;
}

const WEIGHT_FILTER_OPTIONS = [
  { value: "7", label: "W" },
  { value: "90", label: "3M" },
  { value: "365", label: "1Y" },
];

function formatRelativeTime(dateStr: string) {
  const date = parseAppDate(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
}

function getWeeklyData(history: Weight[]): {
  values: Array<number | null>;
  dayLabels: string[];
  todayIndex: number;
} {
  if (history.length === 0)
    return { values: [], dayLabels: [], todayIndex: -1 };

  const latestByDay = new Map<string, number>();
  for (const point of history) {
    const key = getLocalDateKey(parseAppDate(point.recordedAt));
    // History is sorted asc by recordedAt, so later points win for same day.
    latestByDay.set(key, point.weightKg);
  }

  const latestDate = parseAppDate(history[history.length - 1].recordedAt);
  const dayLabels: string[] = [];
  const weekData: Array<number | null> = [];

  let steps = 0;
  let currentDate = new Date(latestDate);

  while (steps < 7) {
    const dateKey = getLocalDateKey(currentDate);
    const value = latestByDay.get(dateKey);

    if (typeof value === "number") {
      weekData.unshift(value);
      dayLabels.unshift(
        currentDate
          .toLocaleDateString(undefined, { weekday: "short" })
          .charAt(0),
      );
    } else {
      weekData.unshift(null);
      dayLabels.unshift(""); // Add an empty label for missing data
    }

    steps++;
    currentDate.setDate(currentDate.getDate() - 1);
  }

  // Today's index is always the last data point in this case
  const todayIndex = weekData.length - 1;

  return { values: weekData, dayLabels, todayIndex };
}

function getWeeklyCalorieData(entries: Meal[]): {
  values: Array<number | null>;
  dayLabels: string[];
  todayIndex: number;
} {
  const now = new Date();
  const latestDate = toStartOfDay(now);
  const dayLabels: string[] = [];
  const weekData = Array(7).fill(null) as Array<number | null>;

  // Build the 7-day window and a map for quick lookup
  const dateToIndex = new Map<string, number>();
  let currentDate = new Date(latestDate);
  for (let steps = 0; steps < 7; steps++) {
    const dateKey = getLocalDateKey(currentDate);
    dayLabels.unshift(
      currentDate.toLocaleDateString(undefined, { weekday: "short" }).charAt(0),
    );
    weekData.unshift(null);
    dateToIndex.set(dateKey, 6 - steps); // Index after unshifts: [0,1,2,3,4,5,6]
    currentDate.setDate(currentDate.getDate() - 1);
  }

  // Aggregate entries by their date
  for (const entry of entries) {
    const when = toStartOfDay(parseAppDate(entry.loggedAt));
    const dateKey = getLocalDateKey(when);
    const index = dateToIndex.get(dateKey);
    if (index !== undefined) {
      weekData[index] = (weekData[index] ?? 0) + entry.calories;
    }
  }

  // Today's index is always the last position (right side)
  const todayIndex = 6;
  return { values: weekData, dayLabels, todayIndex };
}

function buildTwoWeekCalorieSeries(entries: Meal[]) {
  const totals = new Map<string, number>();

  for (const entry of entries) {
    const key = getLocalDateKey(parseAppDate(entry.loggedAt));
    totals.set(key, (totals.get(key) ?? 0) + entry.calories);
  }

  const today = toStartOfDay(new Date());
  const dayOfWeek = today.getDay();
  const currentWeekStart = toStartOfDay(addDays(today, -((dayOfWeek + 6) % 7)));
  const previousWeekStart = toStartOfDay(addDays(currentWeekStart, -7));

  const rows: Array<{ date: Date; value: number }> = [];
  for (
    let cursor = new Date(previousWeekStart);
    cursor <= today;
    cursor = addDays(cursor, 1)
  ) {
    const key = getLocalDateKey(cursor);
    rows.push({
      date: new Date(cursor),
      value: Math.round(totals.get(key) ?? 0),
    });
  }

  return {
    labels: rows.map((row) => formatCalorieLabel(getLocalDateKey(row.date), 7)),
    values: rows.map((row) => row.value),
  };
}

function getCalorieStatus(
  todayCalories: number,
  targetCalories: number,
  tolerance?: number,
) {
  const safeTolerances = tolerance ?? 100;
  if (Math.abs(todayCalories - targetCalories) <= safeTolerances)
    return "On target";
  if (todayCalories > targetCalories) return "Above target";
  return "Under target";
}

function formatPointDate(value: string) {
  return parseAppDate(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    weekday: "short",
  });
}

function formatBubbleDate(value: string) {
  return parseAppDate(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function buildCalorieSeries(entries: Meal[], days: number) {
  const totals = new Map<string, number>();
  let earliestLoggedAt: Date | null = null;

  for (const entry of entries) {
    const when = toStartOfDay(parseAppDate(entry.loggedAt));
    const key = getLocalDateKey(when);
    totals.set(key, (totals.get(key) ?? 0) + entry.calories);
    if (!earliestLoggedAt || when < earliestLoggedAt) earliestLoggedAt = when;
  }

  const end = toStartOfDay(new Date());

  if (days <= 7) {
    // Show only the current week (up to today), with empty bars for previous days
    // Get the start of the week (Monday)
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0 (Sun) - 6 (Sat)
    // Start from Monday (1) or Sunday (0) depending on locale; here, Monday
    const weekStart = toStartOfDay(addDays(today, -((dayOfWeek + 6) % 7)));
    const dailyRows: Array<{ date: Date; value: number }> = [];
    for (
      let cursor = new Date(weekStart);
      cursor <= end;
      cursor = addDays(cursor, 1)
    ) {
      const key = getLocalDateKey(cursor);
      dailyRows.push({
        date: new Date(cursor),
        value: Math.round(totals.get(key) ?? 0),
      });
    }
    return {
      labels: dailyRows.map((row) =>
        formatCalorieLabel(getLocalDateKey(row.date), days),
      ),
      values: dailyRows.map((row) => row.value),
    };
  }

  if (days <= 31) {
    // Cap daily view to avoid rendering thousands of bars (90d for W, 365d for M)
    const cap = GRAPH_MAX_DAYS_LONG;
    const start = toStartOfDay(addDays(end, -(cap - 1)));
    const dailyRows: Array<{ date: Date; value: number }> = [];
    for (
      let cursor = new Date(start);
      cursor <= end;
      cursor = addDays(cursor, 1)
    ) {
      const key = getLocalDateKey(cursor);
      dailyRows.push({
        date: new Date(cursor),
        value: Math.round(totals.get(key) ?? 0),
      });
    }
    return {
      labels: dailyRows.map((row) =>
        formatCalorieLabel(getLocalDateKey(row.date), days),
      ),
      values: dailyRows.map((row) => row.value),
    };
  }

  const start = earliestLoggedAt ?? toStartOfDay(addDays(end, -(days - 1)));
  const dailyRows: Array<{ date: Date; value: number }> = [];
  for (
    let cursor = new Date(start);
    cursor <= end;
    cursor = addDays(cursor, 1)
  ) {
    const key = getLocalDateKey(cursor);
    dailyRows.push({
      date: new Date(cursor),
      value: Math.round(totals.get(key) ?? 0),
    });
  }

  if (days <= 90) {
    const labels: string[] = [];
    const values: number[] = [];

    for (let i = 0; i < dailyRows.length; i += 7) {
      const chunk = dailyRows.slice(i, i + 7);
      if (!chunk.length) continue;
      const sum = chunk.reduce((acc, row) => acc + row.value, 0);
      const rangeStart = chunk[0].date;
      const rangeEnd = chunk[chunk.length - 1].date;
      labels.push(`${formatShortDay(rangeStart)}-${rangeEnd.getDate()}`);
      values.push(sum);
    }

    return { labels, values };
  }

  const monthLabels: string[] = [];
  const monthValues: number[] = [];
  const monthTotals = new Map<string, number>();

  for (const row of dailyRows) {
    const monthKey = `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, "0")}`;
    monthTotals.set(monthKey, (monthTotals.get(monthKey) ?? 0) + row.value);
  }

  for (const [monthKey, total] of monthTotals.entries()) {
    const [year, month] = monthKey.split("-").map(Number);
    const monthDate = new Date(year, month - 1, 1);
    monthLabels.push(
      monthDate.toLocaleDateString(undefined, { month: "short" }),
    );
    monthValues.push(Math.round(total));
  }

  return { labels: monthLabels, values: monthValues };
}

function sparsifyLabels(labels: string[], maxVisible: number) {
  if (labels.length <= maxVisible || maxVisible < 2) return labels;

  const step = Math.ceil((labels.length - 1) / (maxVisible - 1));
  return labels.map((label, index) => {
    if (index === 0 || index === labels.length - 1 || index % step === 0)
      return label;
    return "";
  });
}

function buildWeightSeries(
  weightHistory: Weight[],
  days: number,
): WeightTrendPoint[] {
  const sorted = weightHistory;
  if (!sorted.length) return [];

  if (days <= 31) {
    // Keep the short-range mode readable by capping to recent daily points.
    const cap =
      days <= GRAPH_MAX_DAYS_SHORT
        ? GRAPH_MAX_DAYS_MEDIUM
        : GRAPH_MAX_DAYS_LONG;
    const cutoff = toStartOfDay(addDays(new Date(), -(cap - 1)));
    const byDay = new Map<string, WeightTrendPoint>();
    for (const point of sorted) {
      const when = toStartOfDay(new Date(point.recordedAt));
      if (when < cutoff) continue;
      const key = getLocalDateKey(when);
      byDay.set(key, {
        recordedAt: point.recordedAt,
        weightKg: point.weightKg,
        axisLabel: formatWeightLabel(key, days),
        bubbleLabel: formatBubbleDate(point.recordedAt),
        isAverage: false,
      });
    }

    return Array.from(byDay.values()).sort(
      (a, b) =>
        new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
    );
  }

  if (days <= 90) {
    const earliest = toStartOfDay(new Date(sorted[0].recordedAt));
    const bucketsByIndex = new Map<
      number,
      { rangeStart: Date; rangeEnd: Date; values: number[] }
    >();

    for (const point of sorted) {
      const when = toStartOfDay(new Date(point.recordedAt));
      const diffDays = Math.floor(
        (when.getTime() - earliest.getTime()) / 86_400_000,
      );
      const bucketIndex = Math.floor(diffDays / 7);
      const bucket = bucketsByIndex.get(bucketIndex) ?? {
        rangeStart: addDays(earliest, bucketIndex * 7),
        rangeEnd: addDays(earliest, bucketIndex * 7 + 6),
        values: [],
      };

      bucket.values.push(point.weightKg);
      bucketsByIndex.set(bucketIndex, bucket);
    }

    const buckets = Array.from(bucketsByIndex.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, bucket]) => bucket);

    return buckets.map((bucket, index) => {
      const previous = index > 0 ? buckets[index - 1] : null;
      const monthChanged =
        !previous ||
        previous.rangeEnd.getMonth() !== bucket.rangeEnd.getMonth() ||
        previous.rangeEnd.getFullYear() !== bucket.rangeEnd.getFullYear();

      return {
        recordedAt: toLocalISOString(bucket.rangeEnd),
        weightKg: averageWeight(bucket.values),
        axisLabel: monthChanged
          ? bucket.rangeEnd.toLocaleDateString(undefined, { month: "short" })
          : "",
        bubbleLabel: formatDateRange(bucket.rangeStart, bucket.rangeEnd, true),
        isAverage: true,
      };
    });
  }

  const byMonth = new Map<string, { monthStart: Date; values: number[] }>();
  for (const point of sorted) {
    const monthStart = toStartOfMonth(new Date(point.recordedAt));
    const key = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, "0")}`;
    const bucket = byMonth.get(key) ?? { monthStart, values: [] };
    bucket.values.push(point.weightKg);
    byMonth.set(key, bucket);
  }

  return Array.from(byMonth.values())
    .sort((a, b) => a.monthStart.getTime() - b.monthStart.getTime())
    .map((bucket) => ({
      recordedAt: toLocalISOString(bucket.monthStart),
      weightKg: averageWeight(bucket.values),
      axisLabel: bucket.monthStart.toLocaleDateString(undefined, {
        month: "short",
        year: "2-digit",
      }),
      bubbleLabel: bucket.monthStart.toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      }),
      isAverage: true,
    }));
}

export default function GraphsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const segmentedButtonsTheme = useMemo(
    () => getAppSegmentedButtonsTheme(theme),
    [
      theme.colors.onPrimaryContainer,
      theme.colors.outlineVariant,
      theme.colors.primaryContainer,
    ],
  );
  const [data, setData] = useState<StoredData>(
    () => getCachedData() ?? DEFAULT_DATA,
  );
  const [entries, setEntries] = useState<Meal[]>([]);
  const [weightHistory, setWeightHistory] = useState<Weight[]>([]);
  const [bodyFatHistory, setBodyFatHistory] = useState<BodyFat[]>([]);
  const hasCompletedInitialLoad = useRef(false);
  const [selectedWeightIndex, setSelectedWeightIndex] = useState<number | null>(
    null,
  );
  const [selectedBodyFatIndex, setSelectedBodyFatIndex] = useState<
    number | null
  >(null);
  const [weightDays, setWeightDays] = useState(7);
  const [bodyFatDays, setBodyFatDays] = useState(7);
  const [showCalorieChart, setShowCalorieChart] = useState(false);
  const [showWeightChart, setShowWeightChart] = useState(false);
  const [showBodyFatChart, setShowBodyFatChart] = useState(false);
  const lastGraphLoadAtRef = useRef(0);
  const calorieTimelineRef = useRef<ScrollView | null>(null);
  const weightTimelineRef = useRef<ScrollView | null>(null);
  const bodyFatTimelineRef = useRef<ScrollView | null>(null);
  const weightPointPositionsRef = useRef<Array<{ x: number; y: number }>>([]);
  const bodyFatPointPositionsRef = useRef<Array<{ x: number; y: number }>>([]);

  const loadScreenData = useCallback(() => {
    return Promise.all([
      readStoredData(),
      // Fetch meals for the last 30 days so the calorie chart has data to show
      getCachedOrFetch(
        queryKeys.recentMeals(30),
        () => getMealsSince(daysAgo(30)),
        {
          ttlMs: CACHE_TTL_MS.mealsRecent,
          tags: [CACHE_TAGS.meals],
        },
      ),
      // Cache weight + body-fat series for last 365 days (avoid querying entire history)
      getCachedOrFetch(
        queryKeys.weightSeries(365),
        () => getWeightSeries(daysAgo(365)),
        {
          ttlMs: CACHE_TTL_MS.weightSeries,
          tags: [CACHE_TAGS.weight],
        },
      ),

      getCachedOrFetch(
        queryKeys.bodyFatSeries(365),
        () => getBodyFatSeries(daysAgo(365)),
        {
          ttlMs: CACHE_TTL_MS.bodyFatSeries,
          tags: [CACHE_TAGS.bodyFat],
        },
      ),
    ]).then(([next, todaysMeals, weightData, bodyFatData]) => {
      setData(next);
      setEntries(todaysMeals);
      setWeightHistory(weightData);
      setBodyFatHistory(bodyFatData);
      lastGraphLoadAtRef.current = Date.now();
    });
  }, []);

  useEffect(() => {
    loadScreenData().finally(() => {
      hasCompletedInitialLoad.current = true;
    });
  }, [loadScreenData]);

  useFocusEffect(
    useCallback(() => {
      if (!hasCompletedInitialLoad.current) return undefined;
      const now = Date.now();
      if (now - lastGraphLoadAtRef.current < GRAPH_FOCUS_REFRESH_INTERVAL_MS) {
        return undefined;
      }
      loadScreenData();
      return undefined;
    }, [loadScreenData]),
  );

  const screenWidth = Dimensions.get("window").width;
  const chartWidth = Math.max(screenWidth - 56, 280);
  const chartAccent = theme.colors.primary;
  const chartAccentContainer = theme.colors.primaryContainer;
  const chartOnAccentContainer = theme.colors.onPrimaryContainer;
  const chartConfig = useMemo(
    () => ({
      backgroundGradientFrom: theme.colors.elevation.level1,
      backgroundGradientTo: theme.colors.elevation.level1,
      decimalPlaces: 0,
      color: (opacity = 1) => {
        if (theme.dark) return `rgba(127, 216, 165, ${opacity})`;
        return `rgba(20, 108, 67, ${opacity})`;
      },
      labelColor: (opacity = 1) => {
        if (theme.dark) return `rgba(195, 201, 196, ${opacity})`;
        return `rgba(52, 79, 64, ${opacity})`;
      },
      fillShadowGradientFrom: chartAccent,
      fillShadowGradientTo: chartAccentContainer,
      fillShadowGradientFromOpacity: 1,
      fillShadowGradientToOpacity: 0.75,
      propsForDots: {
        r: "5",
        strokeWidth: "2",
        stroke: chartAccent,
      },
      propsForBackgroundLines: {
        strokeDasharray: "",
        stroke: theme.colors.outlineVariant,
      },
      propsForLabels: {
        fontSize: 11,
      },
      barPercentage: 0.7,
    }),
    [
      chartAccent,
      chartAccentContainer,
      theme.colors.elevation.level1,
      theme.colors.outlineVariant,
      theme.dark,
    ],
  );

  const weightChartConfig = useMemo(
    () => ({
      ...chartConfig,
      fillShadowGradientFrom: chartAccent,
      fillShadowGradientTo: theme.colors.elevation.level1,
      fillShadowGradientFromOpacity: 0.16,
      fillShadowGradientToOpacity: 0,
    }),
    [chartAccent, chartConfig, theme.colors.elevation.level1],
  );

  const calorieSeries = useMemo(
    () => buildTwoWeekCalorieSeries(entries),
    [entries],
  );
  const calorieChartLabels = useMemo(
    () => sparsifyLabels(calorieSeries.labels, 14),
    [calorieSeries.labels],
  );
  const calorieChartWidth = useMemo(() => {
    const columnWidth = 32;
    return Math.max(
      chartWidth,
      calorieSeries.values.length * columnWidth + 100,
    );
  }, [calorieSeries.values.length, chartWidth]);

  // Sort once, reuse across all time ranges
  const sortedWeightHistory = useMemo(
    () =>
      [...weightHistory].sort(
        (a, b) =>
          parseAppDate(a.recordedAt).getTime() -
          parseAppDate(b.recordedAt).getTime(),
      ),
    [weightHistory],
  );

  const bodyFatAsWeightPoints = useMemo<Weight[]>(
    () =>
      bodyFatHistory.map((point: BodyFat) => ({
        id: point.id,
        recordedAt: point.recordedAt,
        weightKg: point.bodyFatPercentage,
        source: "health-connect",
        originAppId: point.originAppId,
        originAppName: point.originAppName,
        originDevice: point.originDevice,
      })),
    [bodyFatHistory],
  );

  const sortedBodyFatAsWeightPoints = useMemo(
    () =>
      [...bodyFatAsWeightPoints].sort(
        (a, b) =>
          parseAppDate(a.recordedAt).getTime() -
          parseAppDate(b.recordedAt).getTime(),
      ),
    [bodyFatAsWeightPoints],
  );

  const weightSeries = useMemo(
    () => buildWeightSeries(sortedWeightHistory, weightDays as 7 | 90 | 365),
    [sortedWeightHistory, weightDays],
  );
  const weightChartSeries = useMemo(() => {
    const points = weightSeries;
    return {
      points,
      labels: sparsifyLabels(
        points.map((point) => point.axisLabel),
        12,
      ),
      values: points.map((point) => point.weightKg),
    };
  }, [weightSeries]);
  const weightChartWidth = useMemo(() => {
    const pointWidth = weightDays <= 7 ? 44 : weightDays <= 90 ? 64 : 72;
    return Math.max(chartWidth, weightChartSeries.values.length * pointWidth);
  }, [chartWidth, weightChartSeries.values.length, weightDays]);

  const bodyFatSeries = useMemo(
    () =>
      buildWeightSeries(
        sortedBodyFatAsWeightPoints,
        bodyFatDays as 7 | 90 | 365,
      ),
    [bodyFatDays, sortedBodyFatAsWeightPoints],
  );
  const bodyFatChartSeries = useMemo(() => {
    const points = bodyFatSeries;
    return {
      points,
      labels: sparsifyLabels(
        points.map((point) => point.axisLabel),
        12,
      ),
      values: points.map((point) => point.weightKg),
    };
  }, [bodyFatSeries]);
  const bodyFatChartWidth = useMemo(() => {
    const pointWidth = bodyFatDays <= 7 ? 44 : bodyFatDays <= 90 ? 64 : 72;
    return Math.max(chartWidth, bodyFatChartSeries.values.length * pointWidth);
  }, [bodyFatChartSeries.values.length, bodyFatDays, chartWidth]);

  const selectedWeightPoint =
    selectedWeightIndex !== null &&
    selectedWeightIndex >= 0 &&
    selectedWeightIndex < weightChartSeries.points.length
      ? weightChartSeries.points[selectedWeightIndex]
      : null;
  const selectedWeightMetrics =
    selectedWeightIndex !== null &&
    selectedWeightIndex >= 0 &&
    selectedWeightIndex < weightPointPositionsRef.current.length
      ? (weightPointPositionsRef.current[selectedWeightIndex] ?? null)
      : null;

  const selectedBodyFatPoint =
    selectedBodyFatIndex !== null &&
    selectedBodyFatIndex >= 0 &&
    selectedBodyFatIndex < bodyFatChartSeries.points.length
      ? bodyFatChartSeries.points[selectedBodyFatIndex]
      : null;
  const selectedBodyFatMetrics =
    selectedBodyFatIndex !== null &&
    selectedBodyFatIndex >= 0 &&
    selectedBodyFatIndex < bodyFatPointPositionsRef.current.length
      ? (bodyFatPointPositionsRef.current[selectedBodyFatIndex] ?? null)
      : null;

  useEffect(() => {
    setSelectedWeightIndex(null);
  }, [weightDays, weightChartSeries.points.length]);

  useEffect(() => {
    setSelectedBodyFatIndex(null);
  }, [bodyFatDays, bodyFatChartSeries.points.length]);

  useEffect(() => {
    if (!showCalorieChart) return;
    const frame = requestAnimationFrame(() => {
      calorieTimelineRef.current?.scrollToEnd({ animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [calorieChartWidth, showCalorieChart]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      weightTimelineRef.current?.scrollToEnd({ animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [weightChartWidth, weightDays, showWeightChart]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      bodyFatTimelineRef.current?.scrollToEnd({ animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [bodyFatChartWidth, bodyFatDays, showBodyFatChart]);

  const handleWeightTap = useCallback(
    (tapX: number) => {
      const positions = weightPointPositionsRef.current.slice(
        0,
        weightChartSeries.points.length,
      );
      if (!positions.length) return;
      let nearestIndex = 0;
      let nearestDist = Infinity;
      positions.forEach((pos, i) => {
        const d = Math.abs(pos.x - tapX);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIndex = i;
        }
      });
      setSelectedWeightIndex((prev) =>
        prev === nearestIndex ? null : nearestIndex,
      );
    },
    [weightChartSeries.points.length],
  );

  const handleBodyFatTap = useCallback(
    (tapX: number) => {
      const positions = bodyFatPointPositionsRef.current.slice(
        0,
        bodyFatChartSeries.points.length,
      );
      if (!positions.length) return;
      let nearestIndex = 0;
      let nearestDist = Infinity;
      positions.forEach((pos, i) => {
        const d = Math.abs(pos.x - tapX);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIndex = i;
        }
      });
      setSelectedBodyFatIndex((prev) =>
        prev === nearestIndex ? null : nearestIndex,
      );
    },
    [bodyFatChartSeries.points.length],
  );

  const selectedWeightBubble = selectedWeightPoint
    ? {
        weight: `${selectedWeightPoint.isAverage ? "avg " : ""}${formatWeightValue(selectedWeightPoint.weightKg)}`,
        date: selectedWeightPoint.bubbleLabel,
      }
    : null;
  const bubbleWidth = selectedWeightBubble
    ? Math.max(
        92,
        Math.max(
          selectedWeightBubble.weight.length,
          selectedWeightBubble.date.length,
        ) *
          8 +
          24,
      )
    : 0;
  const bubbleHeight = selectedWeightBubble ? 46 : 0;
  const bubbleHalfWidth = bubbleWidth / 2;
  const bubbleX = selectedWeightMetrics
    ? Math.min(
        Math.max(8, selectedWeightMetrics.x - bubbleHalfWidth),
        weightChartWidth - bubbleWidth - 8,
      )
    : 0;
  const bubbleY = selectedWeightMetrics
    ? Math.max(10, selectedWeightMetrics.y - 54)
    : 0;

  const selectedBodyFatBubble = selectedBodyFatPoint
    ? {
        bodyFat: `${selectedBodyFatPoint.isAverage ? "avg " : ""}${formatBodyFatValue(selectedBodyFatPoint.weightKg)}`,
        date: selectedBodyFatPoint.bubbleLabel,
      }
    : null;
  const bodyFatBubbleWidth = selectedBodyFatBubble
    ? Math.max(
        92,
        Math.max(
          selectedBodyFatBubble.bodyFat.length,
          selectedBodyFatBubble.date.length,
        ) *
          8 +
          24,
      )
    : 0;
  const bodyFatBubbleHeight = selectedBodyFatBubble ? 46 : 0;
  const bodyFatBubbleHalfWidth = bodyFatBubbleWidth / 2;
  const bodyFatBubbleX = selectedBodyFatMetrics
    ? Math.min(
        Math.max(8, selectedBodyFatMetrics.x - bodyFatBubbleHalfWidth),
        bodyFatChartWidth - bodyFatBubbleWidth - 8,
      )
    : 0;
  const bodyFatBubbleY = selectedBodyFatMetrics
    ? Math.max(10, selectedBodyFatMetrics.y - 54)
    : 0;

  const latestWeightPoint =
    weightHistory.length > 0 ? weightHistory[weightHistory.length - 1] : null;
  const latestWeight = latestWeightPoint?.weightKg ?? null;
  const latestHealthConnectWeight = useMemo(() => {
    for (let i = sortedWeightHistory.length - 1; i >= 0; i -= 1) {
      const point = sortedWeightHistory[i];
      if (point.source === "health-connect") {
        return point.weightKg;
      }
    }
    return null;
  }, [sortedWeightHistory]);
  const { adjustedTarget } = useMemo(
    () => getAdjustedCalorieTarget(data, latestHealthConnectWeight),
    [data, latestHealthConnectWeight],
  );
  const latestBodyFatPoint =
    bodyFatHistory.length > 0
      ? bodyFatHistory[bodyFatHistory.length - 1]
      : null;
  const latestBodyFat = latestBodyFatPoint?.bodyFatPercentage ?? null;
  const latestCalorieEntry = useMemo(
    () =>
      entries.reduce<Meal | null>((latest, entry) => {
        if (!latest) return entry;
        return new Date(entry.loggedAt).getTime() >
          new Date(latest.loggedAt).getTime()
          ? entry
          : latest;
      }, null),
    [entries],
  );
  const todayCalorieTotal = useMemo(() => {
    const todayKey = getLocalDateKey(new Date());
    return entries
      .filter((entry) => getLocalDateKey(new Date(entry.loggedAt)) === todayKey)
      .reduce((sum, entry) => sum + entry.calories, 0);
  }, [entries]);
  const calorieStatus = useMemo(
    () =>
      getCalorieStatus(
        todayCalorieTotal,
        adjustedTarget,
        data.graphToleranceCalories,
      ),
    [todayCalorieTotal, adjustedTarget, data.graphToleranceCalories],
  );
  const calorieWeeklyData = useMemo(
    () => getWeeklyCalorieData(entries),
    [entries],
  );
  const hasWeeklyCalorieData = useMemo(
    () => calorieWeeklyData.values.some((value) => typeof value === "number"),
    [calorieWeeklyData.values],
  );
  const calorieWeeklyMax = useMemo(() => {
    const values = calorieWeeklyData.values.filter(
      (value): value is number => typeof value === "number",
    );
    if (!values.length) return null;
    const max = Math.max(...values);
    return Math.max(300, max);
  }, [calorieWeeklyData.values]);
  const weeklyData = useMemo(
    () => getWeeklyData(sortedWeightHistory),
    [sortedWeightHistory],
  );
  const hasWeeklyData = useMemo(
    () => weeklyData.values.some((value) => typeof value === "number"),
    [weeklyData.values],
  );
  const weeklyValueRange = useMemo(() => {
    const values = weeklyData.values.filter(
      (value): value is number => typeof value === "number",
    );
    if (!values.length) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max(0.2, (max - min) * 0.2);
    return { min: min - pad, max: max + pad };
  }, [weeklyData.values]);

  const bodyFatWeeklyData = useMemo(
    () => getWeeklyData(sortedBodyFatAsWeightPoints),
    [sortedBodyFatAsWeightPoints],
  );

  const weightTrend = useMemo(
    () => calculateWeightTrend(sortedWeightHistory),
    [sortedWeightHistory],
  );

  const bodyFatTrend = useMemo(
    () => calculateBodyFatTrend(sortedBodyFatAsWeightPoints),
    [sortedBodyFatAsWeightPoints],
  );
  const hasBodyFatWeeklyData = useMemo(
    () => bodyFatWeeklyData.values.some((value) => typeof value === "number"),
    [bodyFatWeeklyData.values],
  );
  const bodyFatWeeklyValueRange = useMemo(() => {
    const values = bodyFatWeeklyData.values.filter(
      (value): value is number => typeof value === "number",
    );
    if (!values.length) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max(0.2, (max - min) * 0.2);
    return { min: min - pad, max: max + pad };
  }, [bodyFatWeeklyData.values]);

  const calorieChartEl = useMemo(() => {
    return (
      <ScrollView
        ref={calorieTimelineRef}
        horizontal
        decelerationRate="fast"
        bounces={false}
        directionalLockEnabled
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
      >
        <BarChart
          width={calorieChartWidth}
          height={240}
          data={{
            labels: calorieChartLabels,
            datasets: [{ data: calorieSeries.values }],
          }}
          fromZero
          yAxisLabel=""
          yAxisSuffix=""
          withVerticalLabels
          withHorizontalLabels={false}
          showBarTops={false}
          showValuesOnTopOfBars={calorieSeries.values.length <= 12}
          chartConfig={chartConfig}
          style={{ ...styles.chart, paddingBottom: 12 }}
        />
      </ScrollView>
    );
  }, [
    calorieChartLabels,
    calorieChartWidth,
    calorieSeries.values,
    chartConfig,
  ]);

  const weightChartEl = useMemo(
    () =>
      weightChartSeries.values.length > 1 ? (
        <ScrollView
          ref={weightTimelineRef}
          horizontal
          decelerationRate="fast"
          bounces={false}
          directionalLockEnabled
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
        >
          <View
            onStartShouldSetResponder={() => true}
            onResponderRelease={(e) => handleWeightTap(e.nativeEvent.locationX)}
          >
            <LineChart
              width={weightChartWidth}
              height={WEIGHT_CHART_HEIGHT}
              fromZero={false}
              bezier
              withVerticalLabels
              withHorizontalLabels={false}
              data={{
                labels: weightChartSeries.labels,
                datasets: [
                  {
                    data: weightChartSeries.values,
                    // Keep the line visually strong regardless of internal opacity handling.
                    color: () =>
                      theme.dark
                        ? "rgba(125, 205, 168, 0.9)"
                        : "rgba(22, 88, 56, 0.9)",
                    strokeWidth: 3,
                  },
                ],
              }}
              renderDotContent={({ x, y, index }) => {
                weightPointPositionsRef.current[index] = { x, y };
                return null;
              }}
              decorator={() => {
                const allPositions = weightPointPositionsRef.current.slice(
                  0,
                  weightChartSeries.values.length,
                );
                return (
                  <G>
                    {allPositions.map((pos, index) => {
                      const value = weightChartSeries.values[index];
                      if (value === undefined) return null;
                      const above = index % 2 === 1;
                      return (
                        <SvgText
                          key={`wlabel-${index}`}
                          x={pos.x}
                          y={above ? pos.y - 10 : pos.y + 18}
                          fill={chartAccent}
                          fontSize="9"
                          fontWeight="500"
                          textAnchor="middle"
                        >
                          {value.toFixed(2)}
                        </SvgText>
                      );
                    })}
                    {selectedWeightMetrics && selectedWeightBubble ? (
                      <G>
                        <Line
                          x1={String(selectedWeightMetrics.x)}
                          y1="0"
                          x2={String(selectedWeightMetrics.x)}
                          y2={String(WEIGHT_GUIDE_BOTTOM)}
                          stroke={chartAccent}
                          strokeWidth="1"
                          strokeDasharray="4 4"
                        />
                        <Rect
                          x={bubbleX}
                          y={bubbleY}
                          width={bubbleWidth}
                          height={bubbleHeight}
                          rx={12}
                          fill={chartAccentContainer}
                        />
                        <SvgText
                          x={bubbleX + bubbleWidth / 2}
                          y={bubbleY + 18}
                          fill={chartOnAccentContainer}
                          fontSize="11"
                          fontWeight="500"
                          textAnchor="middle"
                        >
                          {selectedWeightBubble.date}
                        </SvgText>
                        <SvgText
                          x={bubbleX + bubbleWidth / 2}
                          y={bubbleY + 34}
                          fill={chartOnAccentContainer}
                          fontSize="12"
                          fontWeight="600"
                          textAnchor="middle"
                        >
                          {selectedWeightBubble.weight}
                        </SvgText>
                      </G>
                    ) : null}
                  </G>
                );
              }}
              chartConfig={weightChartConfig}
              style={styles.chart}
            />
          </View>
        </ScrollView>
      ) : (
        <Text
          variant="bodyMedium"
          style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}
        >
          No weight recorded in this period.
        </Text>
      ),
    [
      bubbleHeight,
      bubbleWidth,
      bubbleX,
      bubbleY,
      weightChartConfig,
      handleWeightTap,
      selectedWeightBubble,
      selectedWeightMetrics,
      theme.dark,
      weightChartSeries.labels,
      weightChartSeries.values,
      weightChartWidth,
    ],
  );

  const bodyFatChartEl = useMemo(
    () =>
      bodyFatChartSeries.values.length > 1 ? (
        <ScrollView
          ref={bodyFatTimelineRef}
          horizontal
          decelerationRate="fast"
          bounces={false}
          directionalLockEnabled
          nestedScrollEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
        >
          <View
            onStartShouldSetResponder={() => true}
            onResponderRelease={(e) =>
              handleBodyFatTap(e.nativeEvent.locationX)
            }
          >
            <LineChart
              width={bodyFatChartWidth}
              height={WEIGHT_CHART_HEIGHT}
              fromZero={false}
              bezier
              withVerticalLabels
              withHorizontalLabels={false}
              data={{
                labels: bodyFatChartSeries.labels,
                datasets: [
                  {
                    data: bodyFatChartSeries.values,
                    color: () =>
                      theme.dark
                        ? "rgba(125, 205, 168, 0.9)"
                        : "rgba(22, 88, 56, 0.9)",
                    strokeWidth: 3,
                  },
                ],
              }}
              renderDotContent={({ x, y, index }) => {
                bodyFatPointPositionsRef.current[index] = { x, y };
                return null;
              }}
              decorator={() => {
                const allPositions = bodyFatPointPositionsRef.current.slice(
                  0,
                  bodyFatChartSeries.values.length,
                );
                return (
                  <G>
                    {allPositions.map((pos, index) => {
                      const value = bodyFatChartSeries.values[index];
                      if (value === undefined) return null;
                      const above = index % 2 === 1;
                      return (
                        <SvgText
                          key={`bf-label-${index}`}
                          x={pos.x}
                          y={above ? pos.y - 10 : pos.y + 18}
                          fill={chartAccent}
                          fontSize="9"
                          fontWeight="500"
                          textAnchor="middle"
                        >
                          {value.toFixed(2)}
                        </SvgText>
                      );
                    })}
                    {selectedBodyFatMetrics && selectedBodyFatBubble ? (
                      <G>
                        <Line
                          x1={String(selectedBodyFatMetrics.x)}
                          y1="0"
                          x2={String(selectedBodyFatMetrics.x)}
                          y2={String(WEIGHT_GUIDE_BOTTOM)}
                          stroke={chartAccent}
                          strokeWidth="1"
                          strokeDasharray="4 4"
                        />
                        <Rect
                          x={bodyFatBubbleX}
                          y={bodyFatBubbleY}
                          width={bodyFatBubbleWidth}
                          height={bodyFatBubbleHeight}
                          rx={12}
                          fill={chartAccentContainer}
                        />
                        <SvgText
                          x={bodyFatBubbleX + bodyFatBubbleWidth / 2}
                          y={bodyFatBubbleY + 18}
                          fill={chartOnAccentContainer}
                          fontSize="11"
                          fontWeight="500"
                          textAnchor="middle"
                        >
                          {selectedBodyFatBubble.date}
                        </SvgText>
                        <SvgText
                          x={bodyFatBubbleX + bodyFatBubbleWidth / 2}
                          y={bodyFatBubbleY + 34}
                          fill={chartOnAccentContainer}
                          fontSize="12"
                          fontWeight="600"
                          textAnchor="middle"
                        >
                          {selectedBodyFatBubble.bodyFat}
                        </SvgText>
                      </G>
                    ) : null}
                  </G>
                );
              }}
              chartConfig={weightChartConfig}
              style={styles.chart}
            />
          </View>
        </ScrollView>
      ) : (
        <Text
          variant="bodyMedium"
          style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}
        >
          No body fat recorded in this period.
        </Text>
      ),
    [
      bodyFatBubbleHeight,
      bodyFatBubbleWidth,
      bodyFatBubbleX,
      bodyFatBubbleY,
      bodyFatChartSeries.labels,
      bodyFatChartSeries.values,
      bodyFatChartWidth,
      handleBodyFatTap,
      selectedBodyFatBubble,
      selectedBodyFatMetrics,
      theme.dark,
      weightChartConfig,
    ],
  );

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, backgroundColor: theme.colors.background },
      ]}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        {!showCalorieChart ? (
          <Pressable onPress={() => setShowCalorieChart(true)}>
            <Card
              style={[
                styles.weightTile,
                { backgroundColor: theme.colors.surfaceVariant },
              ]}
              mode="elevated"
            >
              <Card.Content>
                <View style={styles.weightTileContent}>
                  <View style={styles.weightTileLeft}>
                    <Text
                      variant="labelMedium"
                      style={{
                        fontWeight: "700",
                        color: theme.colors.onSurface,
                        marginBottom: 4,
                      }}
                    >
                      Calorie Intake
                    </Text>
                    <Text
                      variant="displaySmall"
                      style={{
                        fontWeight: "700",
                        color: theme.colors.primary,
                        marginBottom: 8,
                      }}
                    >
                      {Math.round(todayCalorieTotal)} kcal
                    </Text>
                    <Text
                      variant="labelSmall"
                      style={{
                        color:
                          calorieStatus === "Above target"
                            ? theme.colors.error
                            : calorieStatus === "Under target"
                              ? theme.colors.primary
                              : theme.colors.onSurfaceVariant,
                        fontWeight: "600",
                      }}
                    >
                      {calorieStatus}
                    </Text>
                  </View>
                  <View style={styles.weightTileRight}>
                    <Text
                      variant="labelSmall"
                      style={{ color: theme.colors.onSurfaceVariant }}
                    >
                      {latestCalorieEntry
                        ? formatRelativeTime(latestCalorieEntry.loggedAt)
                        : "No data"}
                    </Text>
                    {hasWeeklyCalorieData && calorieWeeklyMax ? (
                      <View style={styles.weekMiniWrap}>
                        <Svg width={126} height={56}>
                          {calorieWeeklyData.values.map((value, index) => {
                            if (typeof value !== "number") return null;
                            const barWidth = 10;
                            const x = 1 + index * 18;
                            const usableHeight = 34;
                            const barHeight = Math.max(
                              2,
                              (value / calorieWeeklyMax) * usableHeight,
                            );
                            const y = 38 - barHeight;
                            const isToday =
                              index === calorieWeeklyData.todayIndex;
                            const barColor = chartAccent;
                            return (
                              <Rect
                                key={`mini-cal-bar-${index}`}
                                x={x}
                                y={y}
                                width={barWidth}
                                height={barHeight}
                                rx={2}
                                fill={isToday ? barColor : "transparent"}
                                stroke={barColor}
                                strokeWidth="1.5"
                              />
                            );
                          })}
                        </Svg>
                        <View style={styles.weekMiniAxis}>
                          {calorieWeeklyData.dayLabels.map((label, index) => (
                            <Text
                              key={`mini-cal-axis-${index}`}
                              variant="labelSmall"
                              style={[
                                styles.weekMiniAxisLabel,
                                { color: theme.colors.onSurfaceVariant },
                              ]}
                            >
                              {label}
                            </Text>
                          ))}
                        </View>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Card.Content>
            </Card>
          </Pressable>
        ) : (
          <Card style={styles.card} mode="elevated">
            <Card.Title
              title="Intake Trend"
              titleVariant="titleLarge"
              right={() => (
                <Button
                  icon="close"
                  onPress={() => setShowCalorieChart(false)}
                  mode="text"
                  style={{ marginRight: 16 }}
                >
                  Close
                </Button>
              )}
            />
            <Card.Content>
              <Text
                variant="bodyMedium"
                style={[
                  styles.supportingText,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                Logged calorie totals for previous week and this week.
              </Text>
              {calorieChartEl}
            </Card.Content>
          </Card>
        )}

        {!showWeightChart ? (
          <Pressable onPress={() => setShowWeightChart(true)}>
            <Card
              style={[
                styles.weightTile,
                { backgroundColor: theme.colors.surfaceVariant },
              ]}
              mode="elevated"
            >
              <Card.Content>
                <View style={styles.weightTileContent}>
                  <View style={styles.weightTileLeft}>
                    <Text
                      variant="labelMedium"
                      style={{
                        fontWeight: "700",
                        color: theme.colors.onSurface,
                        marginBottom: 4,
                      }}
                    >
                      Weight
                    </Text>
                    <Text
                      variant="displaySmall"
                      style={{
                        fontWeight: "700",
                        color: theme.colors.primary,
                        marginBottom: 8,
                      }}
                    >
                      {latestWeight ? `${latestWeight} kg` : "— kg"}
                    </Text>
                    {weightHistory.length > 0 ? (
                      <Text
                        variant="labelSmall"
                        style={{
                          color:
                            weightTrend === "gaining"
                              ? theme.colors.error
                              : weightTrend === "losing"
                                ? theme.colors.primary
                                : theme.colors.onSurfaceVariant,
                          fontWeight: "600",
                        }}
                      >
                        {weightTrend === "gaining"
                          ? "↑ Gaining"
                          : weightTrend === "losing"
                            ? "↓ Losing"
                            : "→ Maintaining"}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.weightTileRight}>
                    <Text
                      variant="labelSmall"
                      style={{ color: theme.colors.onSurfaceVariant }}
                    >
                      {latestWeightPoint
                        ? formatRelativeTime(latestWeightPoint.recordedAt)
                        : "No data"}
                    </Text>
                    {hasWeeklyData && weeklyValueRange ? (
                      <View style={styles.weekMiniWrap}>
                        <Svg width={126} height={56}>
                          {(() => {
                            const lines = [];
                            for (
                              let index = 0;
                              index < weeklyData.values.length;
                              index += 1
                            ) {
                              const value = weeklyData.values[index];
                              if (typeof value !== "number") continue;

                              let nextIndex = index + 1;
                              while (
                                nextIndex < weeklyData.values.length &&
                                typeof weeklyData.values[nextIndex] !== "number"
                              ) {
                                nextIndex += 1;
                              }
                              if (nextIndex >= weeklyData.values.length)
                                continue;

                              const nextValue = weeklyData.values[
                                nextIndex
                              ] as number;
                              const x1 = 6 + index * 19;
                              const x2 = 6 + nextIndex * 19;
                              const y1 =
                                4 +
                                ((weeklyValueRange.max - value) /
                                  (weeklyValueRange.max -
                                    weeklyValueRange.min || 1)) *
                                  32;
                              const y2 =
                                4 +
                                ((weeklyValueRange.max - nextValue) /
                                  (weeklyValueRange.max -
                                    weeklyValueRange.min || 1)) *
                                  32;
                              lines.push(
                                <Line
                                  key={`mini-line-${index}-${nextIndex}`}
                                  x1={String(x1)}
                                  y1={String(y1)}
                                  x2={String(x2)}
                                  y2={String(y2)}
                                  stroke={chartAccent}
                                  strokeWidth="1.5"
                                />,
                              );
                            }
                            return lines;
                          })()}
                          {weeklyData.values.map((value, index) => {
                            if (typeof value !== "number") return null;
                            const x = 6 + index * 19;
                            const y =
                              4 +
                              ((weeklyValueRange.max - value) /
                                (weeklyValueRange.max - weeklyValueRange.min ||
                                  1)) *
                                32;
                            const isToday = index === weeklyData.todayIndex;
                            const dotColor = chartAccent;
                            return (
                              <Circle
                                key={`mini-dot-${index}`}
                                cx={String(x)}
                                cy={String(y)}
                                r={isToday ? "3.5" : "2.5"}
                                fill={isToday ? dotColor : "transparent"}
                                stroke={dotColor}
                                strokeWidth="1.5"
                              />
                            );
                          })}
                        </Svg>
                        <View style={styles.weekMiniAxis}>
                          {weeklyData.dayLabels.map((label, index) => (
                            <Text
                              key={`mini-axis-${index}`}
                              variant="labelSmall"
                              style={[
                                styles.weekMiniAxisLabel,
                                { color: theme.colors.onSurfaceVariant },
                              ]}
                            >
                              {label}
                            </Text>
                          ))}
                        </View>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Card.Content>
            </Card>
          </Pressable>
        ) : (
          <Card style={styles.card} mode="elevated">
            <Card.Title
              title="Weight Trend"
              titleVariant="titleLarge"
              right={() => (
                <Button
                  icon="close"
                  onPress={() => setShowWeightChart(false)}
                  mode="text"
                  style={{ marginRight: 16 }}
                >
                  Close
                </Button>
              )}
            />
            <Card.Content>
              <Text
                variant="bodyMedium"
                style={[
                  styles.supportingText,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                Daily weight points from manual input or Health Connect.
              </Text>
              <SegmentedButtons
                value={String(weightDays)}
                onValueChange={(v) => {
                  startTransition(() => {
                    setWeightDays(Number(v));
                    setSelectedWeightIndex(null);
                  });
                }}
                buttons={WEIGHT_FILTER_OPTIONS}
                style={[
                  styles.filterButtons,
                  styles.segmentedControl,
                  { backgroundColor: theme.colors.elevation.level2 },
                ]}
                theme={segmentedButtonsTheme}
              />
              {weightChartEl}
            </Card.Content>
          </Card>
        )}

        {!showBodyFatChart ? (
          <Pressable onPress={() => setShowBodyFatChart(true)}>
            <Card
              style={[
                styles.weightTile,
                { backgroundColor: theme.colors.surfaceVariant },
              ]}
              mode="elevated"
            >
              <Card.Content>
                <View style={styles.weightTileContent}>
                  <View style={styles.weightTileLeft}>
                    <Text
                      variant="labelMedium"
                      style={{
                        fontWeight: "700",
                        color: theme.colors.onSurface,
                        marginBottom: 4,
                      }}
                    >
                      Body Fat
                    </Text>
                    <Text
                      variant="displaySmall"
                      style={{
                        fontWeight: "700",
                        color: theme.colors.primary,
                        marginBottom: 8,
                      }}
                    >
                      {latestBodyFat !== null ? `${latestBodyFat}%` : "— %"}
                    </Text>
                    {sortedBodyFatAsWeightPoints.length > 1 ? (
                      <Text
                        variant="labelSmall"
                        style={{
                          color:
                            bodyFatTrend === "gaining"
                              ? theme.colors.error
                              : bodyFatTrend === "losing"
                                ? theme.colors.primary
                                : theme.colors.onSurfaceVariant,
                          fontWeight: "600",
                        }}
                      >
                        {bodyFatTrend === "gaining"
                          ? "↑ Gaining"
                          : bodyFatTrend === "losing"
                            ? "↓ Losing"
                            : "→ Maintaining"}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.weightTileRight}>
                    <Text
                      variant="labelSmall"
                      style={{ color: theme.colors.onSurfaceVariant }}
                    >
                      {latestBodyFatPoint
                        ? formatRelativeTime(latestBodyFatPoint.recordedAt)
                        : "No data"}
                    </Text>
                    {hasBodyFatWeeklyData && bodyFatWeeklyValueRange ? (
                      <View style={styles.weekMiniWrap}>
                        <Svg width={126} height={56}>
                          {(() => {
                            const lines = [];
                            for (
                              let index = 0;
                              index < bodyFatWeeklyData.values.length;
                              index += 1
                            ) {
                              const value = bodyFatWeeklyData.values[index];
                              if (typeof value !== "number") continue;

                              let nextIndex = index + 1;
                              while (
                                nextIndex < bodyFatWeeklyData.values.length &&
                                typeof bodyFatWeeklyData.values[nextIndex] !==
                                  "number"
                              ) {
                                nextIndex += 1;
                              }
                              if (nextIndex >= bodyFatWeeklyData.values.length)
                                continue;

                              const nextValue = bodyFatWeeklyData.values[
                                nextIndex
                              ] as number;
                              const x1 = 6 + index * 19;
                              const x2 = 6 + nextIndex * 19;
                              const y1 =
                                4 +
                                ((bodyFatWeeklyValueRange.max - value) /
                                  (bodyFatWeeklyValueRange.max -
                                    bodyFatWeeklyValueRange.min || 1)) *
                                  32;
                              const y2 =
                                4 +
                                ((bodyFatWeeklyValueRange.max - nextValue) /
                                  (bodyFatWeeklyValueRange.max -
                                    bodyFatWeeklyValueRange.min || 1)) *
                                  32;
                              lines.push(
                                <Line
                                  key={`mini-bf-line-${index}-${nextIndex}`}
                                  x1={String(x1)}
                                  y1={String(y1)}
                                  x2={String(x2)}
                                  y2={String(y2)}
                                  stroke={chartAccent}
                                  strokeWidth="1.5"
                                />,
                              );
                            }
                            return lines;
                          })()}
                          {bodyFatWeeklyData.values.map((value, index) => {
                            if (typeof value !== "number") return null;
                            const x = 6 + index * 19;
                            const y =
                              4 +
                              ((bodyFatWeeklyValueRange.max - value) /
                                (bodyFatWeeklyValueRange.max -
                                  bodyFatWeeklyValueRange.min || 1)) *
                                32;
                            const isToday =
                              index === bodyFatWeeklyData.todayIndex;
                            const dotColor = chartAccent;
                            return (
                              <Circle
                                key={`mini-bf-dot-${index}`}
                                cx={String(x)}
                                cy={String(y)}
                                r={isToday ? "3.5" : "2.5"}
                                fill={isToday ? dotColor : "transparent"}
                                stroke={dotColor}
                                strokeWidth="1.5"
                              />
                            );
                          })}
                        </Svg>
                        <View style={styles.weekMiniAxis}>
                          {bodyFatWeeklyData.dayLabels.map((label, index) => (
                            <Text
                              key={`mini-bf-axis-${index}`}
                              variant="labelSmall"
                              style={[
                                styles.weekMiniAxisLabel,
                                { color: theme.colors.onSurfaceVariant },
                              ]}
                            >
                              {label}
                            </Text>
                          ))}
                        </View>
                      </View>
                    ) : null}
                  </View>
                </View>
              </Card.Content>
            </Card>
          </Pressable>
        ) : (
          <Card style={styles.card} mode="elevated">
            <Card.Title
              title="Body Fat Trend"
              titleVariant="titleLarge"
              right={() => (
                <Button
                  icon="close"
                  onPress={() => setShowBodyFatChart(false)}
                  mode="text"
                  style={{ marginRight: 16 }}
                >
                  Close
                </Button>
              )}
            />
            <Card.Content>
              <Text
                variant="bodyMedium"
                style={[
                  styles.supportingText,
                  { color: theme.colors.onSurfaceVariant },
                ]}
              >
                Body fat percentage points from Health Connect.
              </Text>
              <SegmentedButtons
                value={String(bodyFatDays)}
                onValueChange={(v) => {
                  startTransition(() => {
                    setBodyFatDays(Number(v));
                    setSelectedBodyFatIndex(null);
                  });
                }}
                buttons={WEIGHT_FILTER_OPTIONS}
                style={[
                  styles.filterButtons,
                  styles.segmentedControl,
                  { backgroundColor: theme.colors.elevation.level2 },
                ]}
                theme={segmentedButtonsTheme}
              />
              {bodyFatChartEl}
            </Card.Content>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 16, gap: 16 },
  card: { borderRadius: 24 },
  segmentedControl: {
    borderRadius: 14,
    overflow: "hidden",
  },
  supportingText: { marginBottom: 10 },
  chartPage: { overflow: "hidden" },
  chart: { borderRadius: 18, marginLeft: -10, marginBottom: 6 },
  emptyText: {},
  filterButtons: { marginBottom: 14 },
  weightTile: {
    borderRadius: 12,
    overflow: "hidden",
  },
  weightTileContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
  },
  weightTileLeft: {
    flex: 1,
  },
  weightTileRight: {
    alignItems: "flex-end",
    gap: 8,
  },
  weekMiniWrap: {
    width: 126,
    alignItems: "stretch",
  },
  weekMiniAxis: {
    marginTop: -2,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  weekMiniAxisLabel: {
    width: 14,
    textAlign: "center",
    fontSize: 10,
    lineHeight: 12,
  },
});
