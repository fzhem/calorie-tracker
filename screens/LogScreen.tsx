import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, ProgressBar, Surface, Text, TextInput, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DEFAULT_DATA, STORAGE_KEY } from '../storage';
import type { StoredData } from '../storage';

type QuickAddItem = {
  title: string;
  calories: number;
};

type SortMode = 'newest' | 'oldest';

function getLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function parseNumberInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function LogScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [data, setData] = useState<StoredData>(DEFAULT_DATA);
  const [isReady, setIsReady] = useState(false);
  const [mealTitle, setMealTitle] = useState('');
  const [mealCalories, setMealCalories] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('newest');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored) {
          const parsed = JSON.parse(stored) as StoredData;
          setData({ ...DEFAULT_DATA, ...parsed, entries: parsed.entries ?? [], weightHistory: parsed.weightHistory ?? [] });
        }
      })
      .catch(() => Alert.alert('Storage error', 'Saved data could not be loaded.'))
      .finally(() => setIsReady(true));
  }, []);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() =>
      Alert.alert('Storage error', 'Changes could not be saved.'),
    );
  }, [data, isReady]);

  const todayKey = getLocalDateKey(new Date());
  const todayEntries = useMemo(
    () => data.entries.filter((e) => getLocalDateKey(new Date(e.loggedAt)) === todayKey),
    [data.entries, todayKey],
  );
  const sortedTodayEntries = useMemo(() => {
    const list = [...todayEntries];
    list.sort((a, b) => {
      const aTime = new Date(a.loggedAt).getTime();
      const bTime = new Date(b.loggedAt).getTime();
      return sortMode === 'newest' ? bTime - aTime : aTime - bTime;
    });
    return list;
  }, [sortMode, todayEntries]);
  const recentQuickAdds = useMemo(() => {
    const unique = new Map<string, QuickAddItem>();
    for (const entry of data.entries) {
      const key = `${entry.title.toLowerCase()}-${entry.calories}`;
      if (!unique.has(key)) {
        unique.set(key, { title: entry.title, calories: entry.calories });
      }
      if (unique.size >= 8) break;
    }
    return Array.from(unique.values());
  }, [data.entries]);
  const visibleEntries = useMemo(() => sortedTodayEntries.slice(0, 40), [sortedTodayEntries]);
  const todayCalories = todayEntries.reduce((sum, e) => sum + e.calories, 0);
  const latestWeight = data.weightHistory[0]?.weightKg ?? data.manualWeightKg;
  const adjustedTarget = latestWeight ? Math.round(latestWeight * data.caloriesPerKg) : data.baseTarget;
  const remaining = adjustedTarget - todayCalories;
  const progress = Math.min(todayCalories / Math.max(adjustedTarget, 1), 1);

  const addMeal = useCallback(() => {
    const calories = parseNumberInput(mealCalories);
    if (!mealTitle.trim()) { Alert.alert('Missing meal name', 'Add a label.'); return; }
    if (!calories || calories <= 0) { Alert.alert('Invalid calories', 'Enter a positive number.'); return; }
    setData((prev) => ({
      ...prev,
      entries: [
        { id: createId(), title: mealTitle.trim(), calories: Math.round(calories), loggedAt: new Date().toISOString() },
        ...prev.entries,
      ],
    }));
    setMealTitle('');
    setMealCalories('');
  }, [mealCalories, mealTitle]);

  const quickAddMeal = useCallback((item: QuickAddItem) => {
    setData((prev) => ({
      ...prev,
      entries: [
        { id: createId(), title: item.title, calories: item.calories, loggedAt: new Date().toISOString() },
        ...prev.entries,
      ],
    }));
  }, []);

  const deleteEntry = useCallback((id: string) => {
    setData((prev) => ({ ...prev, entries: prev.entries.filter((e) => e.id !== id) }));
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Surface style={[styles.heroCard, { backgroundColor: theme.colors.elevation.level2 }]} elevation={3}>
          <Text variant="labelLarge" style={[styles.eyebrow, { color: theme.colors.primary }]}>Calorie Logger</Text>
          <View style={styles.progressSection}>
            <View style={styles.progressRow}>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {todayCalories} / {adjustedTarget} kcal
              </Text>
              <Text variant="bodyMedium" style={{ color: remaining < 0 ? theme.colors.error : theme.colors.primary }}>
                {remaining >= 0 ? `${remaining} kcal left` : `${Math.abs(remaining)} kcal over`}
              </Text>
            </View>
            <ProgressBar
              progress={progress}
              color={remaining < 0 ? theme.colors.error : theme.colors.primary}
              style={styles.progressBar}
            />
          </View>
        </Surface>

        <Card style={styles.card} mode="elevated">
          <Card.Title title="Quick Log" titleVariant="titleLarge" />
          <Card.Content style={styles.formArea}>
            <TextInput
              label="Meal"
              value={mealTitle}
              onChangeText={setMealTitle}
              placeholder="Breakfast burrito"
              mode="outlined"
            />
            <TextInput
              label="Calories"
              value={mealCalories}
              onChangeText={setMealCalories}
              placeholder="620"
              keyboardType="numeric"
              mode="outlined"
            />
            <Button mode="contained" icon="plus" onPress={addMeal}>
              Add entry
            </Button>
            {recentQuickAdds.length ? (
              <View style={styles.quickAddSection}>
                <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                  Recent items
                </Text>
                <View style={styles.quickAddRow}>
                  {recentQuickAdds.map((item) => (
                    <Chip key={`${item.title}-${item.calories}`} icon="plus" compact onPress={() => quickAddMeal(item)}>
                      {item.title} ({item.calories})
                    </Chip>
                  ))}
                </View>
              </View>
            ) : null}
          </Card.Content>
        </Card>

        <Card style={styles.card} mode="elevated">
          <Card.Title
            title="Today's Entries"
            titleVariant="titleLarge"
            right={() => (
              <Button
                mode="text"
                compact
                icon="sort-clock-descending"
                onPress={() => setSortMode((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
              >
                {sortMode === 'newest' ? 'Newest' : 'Oldest'}
              </Button>
            )}
          />
          <Card.Content style={styles.entriesList}>
          {visibleEntries.length ? (
            visibleEntries.map((entry) => (
              <Surface
                key={entry.id}
                style={[
                  styles.entryRow,
                  {
                    backgroundColor: theme.colors.elevation.level1,
                    borderColor: theme.colors.outlineVariant,
                  },
                ]}
                elevation={1}
              >
                <View>
                  <Text variant="titleSmall" style={[styles.entryTitle, { color: theme.colors.onSurface }]}>{entry.title}</Text>
                  <Text variant="bodySmall" style={[styles.entryMeta, { color: theme.colors.onSurfaceVariant }]}>{formatDisplayDate(entry.loggedAt)}</Text>
                </View>
                <View style={styles.entryRight}>
                  <Chip compact>{entry.calories} kcal</Chip>
                  <Button mode="text" textColor={theme.colors.error} compact onPress={() => deleteEntry(entry.id)}>
                    Delete
                  </Button>
                </View>
              </Surface>
            ))
          ) : (
            <Text variant="bodyMedium" style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>No entries logged today yet.</Text>
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
  heroCard: { borderRadius: 24, padding: 16, gap: 14 },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 1 },
  progressSection: { gap: 8 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  progressBar: { height: 10, borderRadius: 999 },
  card: { borderRadius: 24 },
  formArea: { gap: 12 },
  quickAddSection: { gap: 8 },
  quickAddRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  entriesList: { gap: 10 },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  entryTitle: {},
  entryMeta: {},
  entryRight: { alignItems: 'flex-end' },
  emptyText: {},
});
