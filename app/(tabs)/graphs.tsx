import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFocusEffect } from "expo-router/react-navigation";
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { BarChart } from "react-native-gifted-charts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Card,
  SegmentedButtons,
  Text,
  Button,
  useTheme,
} from "react-native-paper";
import Svg, { Line, Rect, Text as SvgText, Circle } from "react-native-svg";
import { getAppSegmentedButtonsTheme } from "@/ui/segmentedButtons";

import { getAdjustedCalorieTarget } from "@/domain/metabolism";
import {
  DEFAULT_DATA,
  getCachedData,
  loadStoredData as readStoredData,
} from "@/data/storage";
import type { StoredData } from "@/data/storage";
import type { Weight, BodyFat, Meal } from "@/db/index";

import { GRAPH_MAX_DAYS_LONG } from "@/constants";

import { getMealsSince, getWeightSeries, getBodyFatSeries } from "@/db/index";
import WeightBodyFatChart, {
  buildTrendSeries,
  type AggregatedPoint,
  type TrendPoint,
} from "@/ui/weightBodyFatChart";
import {
  CACHE_TAGS,
  CACHE_TTL_MS,
  getCachedOrFetch,
  getCachedSync,
  queryKeys,
} from "@/lib/queryCache";
import { getLocalDateKey, parseAppDate, toLocalISOString } from "@/lib/dateKey";
import { calculateBodyFatTrend, calculateWeightTrend } from "@/lib/trend";

const WEIGHT_CHART_HEIGHT = 220;
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

function toStartOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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

function sparsifyLabels(labels: string[], maxVisible: number) {
  if (labels.length <= maxVisible || maxVisible < 2) return labels;

  const step = Math.ceil((labels.length - 1) / (maxVisible - 1));
  return labels.map((label, index) => {
    if (index === 0 || index === labels.length - 1 || index % step === 0)
      return label;
    return "";
  });
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
  const [weightDays, setWeightDays] = useState(7);
  const [bodyFatDays, setBodyFatDays] = useState(7);
  const [showCalorieChart, setShowCalorieChart] = useState(false);
  const [showWeightChart, setShowWeightChart] = useState(false);
  const [showBodyFatChart, setShowBodyFatChart] = useState(false);
  const lastGraphLoadAtRef = useRef(0);

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
      // Bypass throttle if any primary cache key has been invalidated (e.g. after import)
      const cachesMissing =
        getCachedSync(queryKeys.weightSeries(365)) === null ||
        getCachedSync(queryKeys.bodyFatSeries(365)) === null ||
        getCachedSync(queryKeys.recentMeals(30)) === null;
      if (
        !cachesMissing &&
        now - lastGraphLoadAtRef.current < GRAPH_FOCUS_REFRESH_INTERVAL_MS
      ) {
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

  // Gifted charts theme colors
  const giftedLabelColor = theme.dark
    ? "rgba(195, 201, 196, 0.8)"
    : "rgba(52, 79, 64, 0.8)";

  const calorieSeries = useMemo(
    () => buildTwoWeekCalorieSeries(entries),
    [entries],
  );
  const calorieChartLabels = useMemo(
    () => sparsifyLabels(calorieSeries.labels, 14),
    [calorieSeries.labels],
  );
  const calorieBarData = useMemo(
    () =>
      calorieSeries.values.map((value, index) => ({
        value,
        label: calorieChartLabels[index],
        frontColor: chartAccent,
        topLabelComponent: () => (
          <Text
            style={{
              color: chartAccent,
              fontSize: 9,
              fontWeight: "600",
              width: 60,
              textAlign: "center",
            }}
            numberOfLines={1}
          >
            {value}
          </Text>
        ),
      })),
    [calorieSeries.values, calorieChartLabels, chartAccent],
  );

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

  // Build TrendPoint arrays once (just convert Weight[] → TrendPoint[])
  const weightTrendPoints = useMemo<TrendPoint[]>(
    () =>
      sortedWeightHistory.map((w) => ({
        recordedAt: w.recordedAt,
        value: w.weightKg,
      })),
    [sortedWeightHistory],
  );

  const bodyFatTrendPoints = useMemo<TrendPoint[]>(
    () =>
      sortedBodyFatAsWeightPoints.map((w) => ({
        recordedAt: w.recordedAt,
        value: w.weightKg,
      })),
    [sortedBodyFatAsWeightPoints],
  );

  // Pre-compute all three time ranges so switching tabs is instant.
  // Lazy: only compute the currently selected one on first render,
  // then the others settle in a microtask.
  const [weightChartCache, setWeightChartCache] = useState<
    Record<number, AggregatedPoint[]>
  >({});
  const [bodyFatChartCache, setBodyFatChartCache] = useState<
    Record<number, AggregatedPoint[]>
  >({});

  useEffect(() => {
    if (!weightTrendPoints.length) return;
    const pending: Record<number, AggregatedPoint[]> = {};
    // Always compute the currently selected tab first
    pending[weightDays] = buildTrendSeries(weightTrendPoints, weightDays);
    // Defer the other two
    const otherDays = [7, 90, 365].filter((d) => d !== weightDays);
    for (const d of otherDays) {
      pending[d] = buildTrendSeries(weightTrendPoints, d);
    }
    setWeightChartCache(pending);
  }, [weightTrendPoints, weightDays]);

  useEffect(() => {
    if (!bodyFatTrendPoints.length) return;
    const pending: Record<number, AggregatedPoint[]> = {};
    pending[bodyFatDays] = buildTrendSeries(bodyFatTrendPoints, bodyFatDays);
    const otherDays = [7, 90, 365].filter((d) => d !== bodyFatDays);
    for (const d of otherDays) {
      pending[d] = buildTrendSeries(bodyFatTrendPoints, d);
    }
    setBodyFatChartCache(pending);
  }, [bodyFatTrendPoints, bodyFatDays]);

  const weightChartData = weightChartCache[weightDays] ?? [];
  const bodyFatChartData = bodyFatChartCache[bodyFatDays] ?? [];

  const calorieChartEl = useMemo(() => {
    return (
      <BarChart
        data={calorieBarData}
        height={240}
        width={chartWidth}
        noOfSections={4}
        isAnimated
        scrollToEnd
        barWidth={22}
        spacing={18}
        initialSpacing={12}
        endSpacing={12}
        frontColor={chartAccent}
        color={chartAccent}
        showValuesAsTopLabel={false}
        showFractionalValues={false}
        roundToDigits={0}
        yAxisThickness={0}
        xAxisThickness={0}
        rulesLength={0}
        hideYAxisText
        xAxisLabelTextStyle={{
          color: giftedLabelColor,
          fontSize: 10,
        }}
        yAxisTextStyle={{
          color: giftedLabelColor,
          fontSize: 10,
        }}
      />
    );
  }, [calorieBarData, chartWidth, chartAccent, giftedLabelColor]);

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
                Weight points from manual input or Health Connect.
              </Text>
              <SegmentedButtons
                value={String(weightDays)}
                onValueChange={(v) => {
                  startTransition(() => {
                    setWeightDays(Number(v));
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
              {weightChartData.length > 0 ? (
                <View style={styles.chartSpace}>
                  <WeightBodyFatChart
                    data={weightChartData}
                    unit="kg"
                    accentColor={chartAccent}
                    onSurfaceVariant={theme.colors.onSurfaceVariant}
                    backgroundColor={theme.colors.surface}
                    surfaceColor={chartAccentContainer}
                    onPrimaryContainer={chartOnAccentContainer}
                  />
                </View>
              ) : (
                <Text
                  variant="bodySmall"
                  style={{
                    color: theme.colors.onSurfaceVariant,
                    textAlign: "center",
                    paddingVertical: 20,
                  }}
                >
                  No weight data recorded yet.
                </Text>
              )}
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
                Body fat percentage points from manual input orHealth Connect.
              </Text>
              <SegmentedButtons
                value={String(bodyFatDays)}
                onValueChange={(v) => {
                  startTransition(() => {
                    setBodyFatDays(Number(v));
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
              {bodyFatChartData.length > 0 ? (
                <View style={styles.chartSpace}>
                  <WeightBodyFatChart
                    data={bodyFatChartData}
                    unit="%"
                    accentColor={chartAccent}
                    onSurfaceVariant={theme.colors.onSurfaceVariant}
                    backgroundColor={theme.colors.surface}
                    surfaceColor={chartAccentContainer}
                    onPrimaryContainer={chartOnAccentContainer}
                  />
                </View>
              ) : (
                <Text
                  variant="bodySmall"
                  style={{
                    color: theme.colors.onSurfaceVariant,
                    textAlign: "center",
                    paddingVertical: 20,
                  }}
                >
                  No body fat data recorded yet.
                </Text>
              )}
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
  chartSpace: { marginTop: 8, marginBottom: 4 },
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
