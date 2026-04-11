import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, View } from 'react-native';
import { BarChart, LineChart } from 'react-native-chart-kit';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, Text, useTheme } from 'react-native-paper';

import { DEFAULT_DATA, STORAGE_KEY } from '../storage';
import type { StoredData } from '../storage';

const DAY_WINDOW = 7;

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

function formatPointDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
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
    barPercentage: 0.7,
  }), [theme.colors.elevation.level1, theme.dark]);

  const calorieSeries = useMemo(() => buildCalorieSeries(data.entries, DAY_WINDOW), [data.entries]);
  const weightSeries = useMemo(() => latestDailyWeightPoints(data.weightHistory, DAY_WINDOW), [data.weightHistory]);
  const selectedWeightPoint =
    selectedWeightIndex !== null && selectedWeightIndex >= 0 && selectedWeightIndex < weightSeries.length
      ? weightSeries[selectedWeightIndex]
      : null;

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
          {weightSeries.length > 1 ? (
            <>
              <LineChart
                width={chartWidth}
                height={220}
                bezier
                fromZero={false}
                onDataPointClick={({ index }) => setSelectedWeightIndex(index)}
                data={{
                  labels: weightSeries.map((p) => formatDayLabel(getLocalDateKey(new Date(p.recordedAt)))),
                  datasets: [{ data: weightSeries.map((p) => p.weightKg) }],
                }}
                chartConfig={chartConfig}
                style={styles.chart}
              />
              <Text variant="bodyMedium" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}> 
                {selectedWeightPoint
                  ? `Selected: ${selectedWeightPoint.weightKg} kg on ${formatPointDate(selectedWeightPoint.recordedAt)}`
                  : 'Tap a point to see exact weight details.'}
              </Text>
            </>
          ) : (
            <Text variant="bodyMedium" style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>Add a weight in Settings to see the trend.</Text>
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
});
