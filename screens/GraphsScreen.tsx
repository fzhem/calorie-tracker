import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, GestureResponderEvent, ScrollView, StyleSheet, View } from 'react-native';
import { BarChart, LineChart } from 'react-native-chart-kit';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, SegmentedButtons, Text, useTheme } from 'react-native-paper';
import { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { DEFAULT_DATA, STORAGE_KEY } from '../storage';
import type { StoredData } from '../storage';

const DAY_WINDOW = 7;
const WEIGHT_CHART_HEIGHT = 220;

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

function formatWeightLabel(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  if (days <= 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  if (days <= 31) return d.toLocaleDateString(undefined, { day: 'numeric' });
  if (days <= 90) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.toLocaleDateString(undefined, { month: 'short' });
}

function thinWeightPoints(weightPoints: StoredData['weightHistory'], maxPoints: number) {
  if (weightPoints.length <= maxPoints) return weightPoints;

  const lastIndex = weightPoints.length - 1;
  const selectedIndexes = new Set<number>();

  for (let i = 0; i < maxPoints; i++) {
    const index = Math.round((i * lastIndex) / Math.max(maxPoints - 1, 1));
    selectedIndexes.add(index);
  }

  return weightPoints.filter((_, index) => selectedIndexes.has(index));
}

function getWeightMaxPoints(days: number) {
  if (days <= 7) return 7;
  if (days <= 31) return 5;
  if (days <= 90) return 6;
  return 6;
}

function formatWeightValue(weightKg: number) {
  return `${weightKg.toFixed(1)} kg`;
}

const WEIGHT_FILTER_OPTIONS = [
  { value: '7', label: '1W' },
  { value: '30', label: '1M' },
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
  });
}

function buildCalorieSeries(entries: StoredData['entries'], days: number) {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const key = getLocalDateKey(new Date(entry.loggedAt));
    totals.set(key, (totals.get(key) ?? 0) + entry.calories);
  }
  const end = new Date();
  const labels: string[] = [];
  const values: number[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const key = getLocalDateKey(addDays(end, -offset));
    labels.push(formatDayLabel(key));
    values.push(Math.round(totals.get(key) ?? 0));
  }
  return { labels, values };
}

function latestDailyWeightPoints(weightHistory: StoredData['weightHistory'], days: number) {
  const byDay = new Map<string, StoredData['weightHistory'][number]>();
  for (const point of [...weightHistory].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  )) {
    byDay.set(getLocalDateKey(new Date(point.recordedAt)), point);
  }
  const end = new Date();
  const rows: StoredData['weightHistory'] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const point = byDay.get(getLocalDateKey(addDays(end, -offset)));
    if (point) rows.push(point);
  }
  return rows;
}

export default function GraphsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [data, setData] = useState<StoredData>(DEFAULT_DATA);
  const [selectedWeightIndex, setSelectedWeightIndex] = useState<number | null>(null);
  const [weightDays, setWeightDays] = useState(30);
  const weightPointPositionsRef = useRef<Array<{ x: number; y: number }>>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored) {
        const parsed = JSON.parse(stored) as StoredData;
        setData({ ...DEFAULT_DATA, ...parsed, entries: parsed.entries ?? [], weightHistory: parsed.weightHistory ?? [] });
      }
    });
  }, []);

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

  const calorieSeries = useMemo(() => buildCalorieSeries(data.entries, DAY_WINDOW), [data.entries]);
  const weightSeries = useMemo(() => latestDailyWeightPoints(data.weightHistory, weightDays), [data.weightHistory, weightDays]);
  const weightChartSeries = useMemo(() => {
    const points = thinWeightPoints(weightSeries, getWeightMaxPoints(weightDays));
    return {
      points,
      labels: points.map((point) => formatWeightLabel(getLocalDateKey(new Date(point.recordedAt)), weightDays)),
      values: points.map((point) => point.weightKg),
    };
  }, [weightDays, weightSeries]);

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

  const selectedWeightBubble = selectedWeightPoint
    ? {
        weight: formatWeightValue(selectedWeightPoint.weightKg),
        date: formatBubbleDate(selectedWeightPoint.recordedAt),
      }
    : null;
  const bubbleWidth = selectedWeightBubble
    ? Math.max(92, Math.max(selectedWeightBubble.weight.length, selectedWeightBubble.date.length) * 8 + 24)
    : 0;
  const bubbleHeight = selectedWeightBubble ? 46 : 0;
  const bubbleHalfWidth = bubbleWidth / 2;
  const bubbleX = selectedWeightMetrics
    ? Math.min(Math.max(8, selectedWeightMetrics.x - bubbleHalfWidth), chartWidth - bubbleWidth - 8)
    : 0;
  const bubbleY = selectedWeightMetrics ? Math.max(10, selectedWeightMetrics.y - 54) : 0;

  const handleWeightChartPress = (event: GestureResponderEvent) => {
    const positions = weightPointPositionsRef.current.slice(0, weightChartSeries.points.length);
    if (positions.length === 0) return;

    const tapX = event.nativeEvent.locationX;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    positions.forEach((position, index) => {
      const distance = Math.abs(position.x - tapX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    setSelectedWeightIndex(nearestIndex);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.card} mode="elevated">
          <Card.Title title="Weekly Intake" titleVariant="titleLarge" />
          <Card.Content>
          <Text variant="bodyMedium" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}>Seven-day view of logged calories.</Text>
          <BarChart
            width={chartWidth}
            height={240}
            data={{ labels: calorieSeries.labels, datasets: [{ data: calorieSeries.values }] }}
            fromZero
            yAxisLabel=""
            yAxisSuffix=""
            showValuesOnTopOfBars
            chartConfig={chartConfig}
            style={styles.chart}
          />
          </Card.Content>
        </Card>

        <Card style={styles.card} mode="elevated">
          <Card.Title title="Weight Trend" titleVariant="titleLarge" />
          <Card.Content>
          <Text variant="bodyMedium" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}>Daily weight points from manual input or Health Connect.</Text>
          <SegmentedButtons
            value={String(weightDays)}
            onValueChange={(v) => { setWeightDays(Number(v)); setSelectedWeightIndex(null); }}
            buttons={WEIGHT_FILTER_OPTIONS}
            style={styles.filterButtons}
          />
          {weightSeries.length > 1 ? (
            <>
              <View
                onStartShouldSetResponder={() => true}
                onResponderRelease={handleWeightChartPress}
              >
                <LineChart
                  width={chartWidth}
                  height={WEIGHT_CHART_HEIGHT}
                  bezier
                  fromZero={false}
                  onDataPointClick={({ index }) => setSelectedWeightIndex(index)}
                  data={{
                    labels: weightChartSeries.labels,
                    datasets: [{ data: weightChartSeries.values }],
                  }}
                  renderDotContent={({ x, y, index }) => {
                    weightPointPositionsRef.current[index] = { x, y };
                    return null;
                  }}
                  decorator={() => (
                    selectedWeightMetrics && selectedWeightBubble ? (
                      <G>
                        <Line
                          x1={String(selectedWeightMetrics.x)}
                          y1="0"
                          x2={String(selectedWeightMetrics.x)}
                          y2={String(WEIGHT_CHART_HEIGHT)}
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
                    ) : null
                  )}
                  chartConfig={chartConfig}
                  style={styles.chart}
                />
              </View>
            </>
          ) : (
            <Text variant="bodyMedium" style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>No weight recorded in this period.</Text>
          )}
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
  chart: { borderRadius: 18, marginLeft: -10, marginBottom: 6 },
  emptyText: {},
  filterButtons: { marginBottom: 14 },
});
