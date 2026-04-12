import AsyncStorage from '@react-native-async-storage/async-storage';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Dimensions, ScrollView, StyleSheet, View } from 'react-native';
import { BarChart, LineChart } from 'react-native-chart-kit';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, SegmentedButtons, Text, useTheme } from 'react-native-paper';
import { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { DEFAULT_DATA, STORAGE_KEY } from '../storage';
import type { MealEntry, StoredData } from '../storage';

const DEFAULT_CALORIE_DAYS = 7;
const WEIGHT_CHART_HEIGHT = 220;
const WEIGHT_GUIDE_BOTTOM = WEIGHT_CHART_HEIGHT - 40;

function getLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDayLabel(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'short' });
}

function formatShortDay(date: Date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatCalorieLabel(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  if (days <= 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  if (days <= 31) return d.toLocaleDateString(undefined, { day: 'numeric' });
  return formatShortDay(d);
}

function formatWeightLabel(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  if (days <= 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  if (days <= 31) return d.toLocaleDateString(undefined, { day: 'numeric' });
  if (days <= 90) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
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
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}


function averageWeight(values: number[]) {
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

function formatDateRange(start: Date, end: Date, includeYear: boolean) {
  const rangeStart = toStartOfDay(start);
  const rangeEnd = toStartOfDay(end);
  const startMonth = rangeStart.toLocaleDateString(undefined, { month: 'short' });
  const endMonth = rangeEnd.toLocaleDateString(undefined, { month: 'short' });
  const startDay = String(rangeStart.getDate()).padStart(2, '0');
  const endDay = String(rangeEnd.getDate()).padStart(2, '0');
  const sameYear = rangeStart.getFullYear() === rangeEnd.getFullYear();
  const sameMonth = sameYear && rangeStart.getMonth() === rangeEnd.getMonth();

  if (sameMonth) {
    return `${startMonth} ${startDay}~${endDay}${includeYear ? ` ${rangeEnd.getFullYear()}` : ''}`;
  }

  if (sameYear) {
    return `${startMonth} ${startDay}~${endMonth} ${endDay}${includeYear ? ` ${rangeEnd.getFullYear()}` : ''}`;
  }

  return `${startMonth} ${startDay} ${rangeStart.getFullYear()}~${endMonth} ${endDay} ${rangeEnd.getFullYear()}`;
}

function formatWeightValue(weightKg: number) {
  return `${weightKg.toFixed(2)} kg`;
}

const WEIGHT_FILTER_OPTIONS = [
  { value: '7', label: 'W' },
  { value: '90', label: '3M' },
  { value: '365', label: '1Y' },
];

function formatPointDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });
}

function formatBubbleDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function buildCalorieSeries(entries: MealEntry[], days: number) {

  const totals = new Map<string, number>();
  let earliestLoggedAt: Date | null = null;

  for (const entry of entries) {
    const when = toStartOfDay(new Date(entry.loggedAt));
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
    for (let cursor = new Date(weekStart); cursor <= end; cursor = addDays(cursor, 1)) {
      const key = getLocalDateKey(cursor);
      dailyRows.push({ date: new Date(cursor), value: Math.round(totals.get(key) ?? 0) });
    }
    return {
      labels: dailyRows.map((row) => formatCalorieLabel(getLocalDateKey(row.date), days)),
      values: dailyRows.map((row) => row.value),
    };
  }

  if (days <= 31) {
    // Cap daily view to avoid rendering thousands of bars (90d for W, 365d for M)
    const cap = 365;
    const start = toStartOfDay(addDays(end, -(cap - 1)));
    const dailyRows: Array<{ date: Date; value: number }> = [];
    for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
      const key = getLocalDateKey(cursor);
      dailyRows.push({ date: new Date(cursor), value: Math.round(totals.get(key) ?? 0) });
    }
    return {
      labels: dailyRows.map((row) => formatCalorieLabel(getLocalDateKey(row.date), days)),
      values: dailyRows.map((row) => row.value),
    };
  }

  const start = earliestLoggedAt ?? toStartOfDay(addDays(end, -(days - 1)));
  const dailyRows: Array<{ date: Date; value: number }> = [];
  for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
    const key = getLocalDateKey(cursor);
    dailyRows.push({ date: new Date(cursor), value: Math.round(totals.get(key) ?? 0) });
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
    const monthKey = `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, '0')}`;
    monthTotals.set(monthKey, (monthTotals.get(monthKey) ?? 0) + row.value);
  }

  for (const [monthKey, total] of monthTotals.entries()) {
    const [year, month] = monthKey.split('-').map(Number);
    const monthDate = new Date(year, month - 1, 1);
    monthLabels.push(monthDate.toLocaleDateString(undefined, { month: 'short' }));
    monthValues.push(Math.round(total));
  }

  return { labels: monthLabels, values: monthValues };
}

function sparsifyLabels(labels: string[], maxVisible: number) {
  if (labels.length <= maxVisible || maxVisible < 2) return labels;

  const step = Math.ceil((labels.length - 1) / (maxVisible - 1));
  return labels.map((label, index) => {
    if (index === 0 || index === labels.length - 1 || index % step === 0) return label;
    return '';
  });
}

function buildWeightSeries(weightHistory: StoredData['weightHistory'], days: number): WeightTrendPoint[] {
  const sorted = [...weightHistory].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  if (!sorted.length) return [];

  if (days <= 31) {
    // Keep the short-range mode readable by capping to recent daily points.
    const cap = days <= 7 ? 90 : 365;
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
      (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
    );
  }

  if (days <= 90) {
    const earliest = toStartOfDay(new Date(sorted[0].recordedAt));
    const bucketsByIndex = new Map<number, { rangeStart: Date; rangeEnd: Date; values: number[] }>();

    for (const point of sorted) {
      const when = toStartOfDay(new Date(point.recordedAt));
      const diffDays = Math.floor((when.getTime() - earliest.getTime()) / 86_400_000);
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
      const monthChanged = !previous
        || previous.rangeEnd.getMonth() !== bucket.rangeEnd.getMonth()
        || previous.rangeEnd.getFullYear() !== bucket.rangeEnd.getFullYear();

      return {
        recordedAt: bucket.rangeEnd.toISOString(),
        weightKg: averageWeight(bucket.values),
        axisLabel: monthChanged ? bucket.rangeEnd.toLocaleDateString(undefined, { month: 'short' }) : '',
        bubbleLabel: formatDateRange(bucket.rangeStart, bucket.rangeEnd, true),
        isAverage: true,
      };
    });
  }

  const byMonth = new Map<string, { monthStart: Date; values: number[] }>();
  for (const point of sorted) {
    const monthStart = toStartOfMonth(new Date(point.recordedAt));
    const key = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;
    const bucket = byMonth.get(key) ?? { monthStart, values: [] };
    bucket.values.push(point.weightKg);
    byMonth.set(key, bucket);
  }

  return Array.from(byMonth.values())
    .sort((a, b) => a.monthStart.getTime() - b.monthStart.getTime())
    .map((bucket) => ({
      recordedAt: bucket.monthStart.toISOString(),
      weightKg: averageWeight(bucket.values),
      axisLabel: bucket.monthStart.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
      bubbleLabel: bucket.monthStart.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
      isAverage: true,
    }));
}

export default function GraphsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [data, setData] = useState<StoredData>(DEFAULT_DATA);
  const [selectedWeightIndex, setSelectedWeightIndex] = useState<number | null>(null);
  const [calorieDays, setCalorieDays] = useState(DEFAULT_CALORIE_DAYS);
  const [weightDays, setWeightDays] = useState(7);
  const calorieTimelineRef = useRef<ScrollView | null>(null);
  const weightTimelineRef = useRef<ScrollView | null>(null);
  const weightPointPositionsRef = useRef<Array<{ x: number; y: number }>>([]);

  const loadStoredData = useCallback(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored) {
        const parsed = JSON.parse(stored) as StoredData;
        setData({ ...DEFAULT_DATA, ...parsed, entries: parsed.entries ?? [], weightHistory: parsed.weightHistory ?? [] });
      }
    });
  }, []);

  useEffect(() => {
    loadStoredData();
  }, [loadStoredData]);

  useFocusEffect(
    useCallback(() => {
      loadStoredData();
      return undefined;
    }, [loadStoredData]),
  );

  const screenWidth = Dimensions.get('window').width;
  const chartWidth = Math.max(screenWidth - 56, 280);
  const chartConfig = useMemo(() => ({
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
    fillShadowGradientFrom: theme.dark ? '#7fd8a5' : '#4caf50',
    fillShadowGradientTo: theme.dark ? '#2b5f44' : '#2e7d32',
    fillShadowGradientFromOpacity: 1,
    fillShadowGradientToOpacity: 0.75,
    propsForDots: { r: '5', strokeWidth: '2', stroke: theme.dark ? '#7fd8a5' : '#146c43' },
    propsForBackgroundLines: {
      strokeDasharray: '',
      stroke: theme.dark ? '#2a322d' : '#d7e1d8',
    },
    propsForLabels: {
      fontSize: 11,
    },
    barPercentage: 0.7,
  }), [theme.colors.elevation.level1, theme.dark]);

  const weightChartConfig = useMemo(() => ({
    ...chartConfig,
    fillShadowGradientFrom: theme.dark ? '#7fd8a5' : '#4caf50',
    fillShadowGradientTo: theme.colors.elevation.level1,
    fillShadowGradientFromOpacity: 0.16,
    fillShadowGradientToOpacity: 0,
  }), [chartConfig, theme.colors.elevation.level1, theme.dark]);

  const allCalorieSeries = useMemo(() => ({
    7: buildCalorieSeries(data.entries, 7),
    90: buildCalorieSeries(data.entries, 90),
    365: buildCalorieSeries(data.entries, 365),
  }), [data.entries]);

  const calorieSeries = allCalorieSeries[calorieDays as 7 | 90 | 365] ?? allCalorieSeries[7];
  const calorieChartLabels = useMemo(() => {
    if (calorieDays <= 7) return sparsifyLabels(calorieSeries.labels, 14);
    if (calorieDays <= 90) return sparsifyLabels(calorieSeries.labels, 10);
    return sparsifyLabels(calorieSeries.labels, 12);
  }, [calorieDays, calorieSeries.labels]);
  const calorieChartWidth = useMemo(() => {
    const columnWidth = calorieDays <= 7 ? 32 : calorieDays <= 90 ? 42 : 56;
    return Math.max(chartWidth, calorieSeries.values.length * columnWidth);
  }, [calorieDays, calorieSeries.values.length, chartWidth]);

  const allWeightSeries = useMemo(() => ({
    7: buildWeightSeries(data.weightHistory, 7),
    90: buildWeightSeries(data.weightHistory, 90),
    365: buildWeightSeries(data.weightHistory, 365),
  }), [data.weightHistory]);

  const weightSeries = allWeightSeries[weightDays as 7 | 90 | 365] ?? allWeightSeries[7];
  const weightChartSeries = useMemo(() => {
    const points = weightSeries;
    return {
      points,
      labels: sparsifyLabels(points.map((point) => point.axisLabel), 12),
      values: points.map((point) => point.weightKg),
    };
  }, [weightSeries]);
  const weightChartWidth = useMemo(() => {
    const pointWidth = weightDays <= 7 ? 44 : weightDays <= 90 ? 64 : 72;
    return Math.max(chartWidth, weightChartSeries.values.length * pointWidth);
  }, [chartWidth, weightChartSeries.values.length, weightDays]);

  const selectedWeightPoint =
    selectedWeightIndex !== null && selectedWeightIndex >= 0 && selectedWeightIndex < weightChartSeries.points.length
      ? weightChartSeries.points[selectedWeightIndex]
      : null;
  const selectedWeightMetrics =
    selectedWeightIndex !== null && selectedWeightIndex >= 0 && selectedWeightIndex < weightPointPositionsRef.current.length
      ? weightPointPositionsRef.current[selectedWeightIndex] ?? null
      : null;

  useEffect(() => {
    setSelectedWeightIndex(null);
  }, [weightDays, weightChartSeries.points.length]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      calorieTimelineRef.current?.scrollToEnd({ animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [calorieChartWidth, calorieDays]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      weightTimelineRef.current?.scrollToEnd({ animated: false });
    });
    return () => cancelAnimationFrame(frame);
  }, [weightChartWidth, weightDays]);

  const handleWeightTap = useCallback((tapX: number) => {
    const positions = weightPointPositionsRef.current.slice(0, weightChartSeries.points.length);
    if (!positions.length) return;
    let nearestIndex = 0;
    let nearestDist = Infinity;
    positions.forEach((pos, i) => {
      const d = Math.abs(pos.x - tapX);
      if (d < nearestDist) { nearestDist = d; nearestIndex = i; }
    });
    setSelectedWeightIndex((prev) => (prev === nearestIndex ? null : nearestIndex));
  }, [weightChartSeries.points.length]);

  const selectedWeightBubble = selectedWeightPoint
    ? {
        weight: `${selectedWeightPoint.isAverage ? 'avg ' : ''}${formatWeightValue(selectedWeightPoint.weightKg)}`,
        date: selectedWeightPoint.bubbleLabel,
      }
    : null;
  const bubbleWidth = selectedWeightBubble
    ? Math.max(92, Math.max(selectedWeightBubble.weight.length, selectedWeightBubble.date.length) * 8 + 24)
    : 0;
  const bubbleHeight = selectedWeightBubble ? 46 : 0;
  const bubbleHalfWidth = bubbleWidth / 2;
  const bubbleX = selectedWeightMetrics
    ? Math.min(Math.max(8, selectedWeightMetrics.x - bubbleHalfWidth), weightChartWidth - bubbleWidth - 8)
    : 0;
  const bubbleY = selectedWeightMetrics ? Math.max(10, selectedWeightMetrics.y - 54) : 0;

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
          data={{ labels: calorieChartLabels, datasets: [{ data: calorieSeries.values }] }}
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
  }, [calorieChartLabels, calorieChartWidth, calorieSeries.values, chartConfig]);

  const weightChartEl = useMemo(() => weightChartSeries.values.length > 1 ? (
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
            datasets: [{
              data: weightChartSeries.values,
              // Keep the line visually strong regardless of internal opacity handling.
              color: () => theme.dark ? 'rgba(125, 205, 168, 0.9)' : 'rgba(22, 88, 56, 0.9)',
              strokeWidth: 3,
            }],
          }}
          renderDotContent={({ x, y, index }) => {
            weightPointPositionsRef.current[index] = { x, y };
            return null;
          }}
          decorator={() => {
            const allPositions = weightPointPositionsRef.current.slice(0, weightChartSeries.values.length);
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
                      fill={theme.dark ? '#7fd8a5' : '#146c43'}
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
                  stroke={theme.dark ? '#7fd8a5' : '#146c43'}
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
                <Rect
                  x={bubbleX}
                  y={bubbleY}
                  width={bubbleWidth}
                  height={bubbleHeight}
                  rx={12}
                  fill={theme.dark ? '#173326' : '#146c43'}
                />
                <SvgText
                  x={bubbleX + bubbleWidth / 2}
                  y={bubbleY + 18}
                  fill="#ffffff"
                  fontSize="11"
                  fontWeight="500"
                  textAnchor="middle"
                >
                  {selectedWeightBubble.date}
                </SvgText>
                <SvgText
                  x={bubbleX + bubbleWidth / 2}
                  y={bubbleY + 34}
                  fill="#ffffff"
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
    <Text variant="bodyMedium" style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>No weight recorded in this period.</Text>
  ), [bubbleHeight, bubbleWidth, bubbleX, bubbleY, weightChartConfig, handleWeightTap, selectedWeightBubble, selectedWeightMetrics, theme.dark, weightChartSeries.labels, weightChartSeries.values, weightChartWidth]);

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.card} mode="elevated">
          <Card.Title title="Intake Trend" titleVariant="titleLarge" />
          <Card.Content>
          <Text variant="bodyMedium" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}>Logged calorie totals in the selected timeframe.</Text>
          <SegmentedButtons
            value={String(calorieDays)}
            onValueChange={(v) => setCalorieDays(Number(v))}
            buttons={WEIGHT_FILTER_OPTIONS}
            style={styles.filterButtons}
          />
          {calorieChartEl}
          </Card.Content>
        </Card>

        <Card style={styles.card} mode="elevated">
          <Card.Title title="Weight Trend" titleVariant="titleLarge" />
          <Card.Content>
          <Text variant="bodyMedium" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}>Daily weight points from manual input or Health Connect.</Text>
          <SegmentedButtons
            value={String(weightDays)}
            onValueChange={(v) => {
              startTransition(() => {
                setWeightDays(Number(v));
                setSelectedWeightIndex(null);
              });
            }}
            buttons={WEIGHT_FILTER_OPTIONS}
            style={styles.filterButtons}
          />
          {weightChartEl}
          </Card.Content>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 16, gap: 16 },
  card: { borderRadius: 24 },
  supportingText: { marginBottom: 10 },
  chartPage: { overflow: 'hidden' },
  chart: { borderRadius: 18, marginLeft: -10, marginBottom: 6 },
  emptyText: {},
  filterButtons: { marginBottom: 14 },
});
