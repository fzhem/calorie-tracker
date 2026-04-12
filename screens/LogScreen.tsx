import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, IconButton, ProgressBar, SegmentedButtons, Surface, Text, TextInput, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { estimateMetabolism, getGoalCalorieDelta } from '../metabolism';
import { DEFAULT_DATA, STORAGE_KEY } from '../storage';
import type { StoredData } from '../storage';

type QuickAddItem = {
  title: string;
  calories: number;
};

type SortMode = 'newest' | 'oldest';
type QuickAddTab = 'recent' | 'favorites';

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

function quickAddKey(item: QuickAddItem) {
  return `${item.title.toLowerCase()}-${item.calories}`;
}

export default function LogScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [data, setData] = useState<StoredData>(DEFAULT_DATA);
  const [isReady, setIsReady] = useState(false);
  const [mealTitle, setMealTitle] = useState('');
  const [mealCalories, setMealCalories] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [quickAddTab, setQuickAddTab] = useState<QuickAddTab>('recent');

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

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(STORAGE_KEY)
        .then((stored) => {
          if (stored) {
            const parsed = JSON.parse(stored) as StoredData;
            setData({ ...DEFAULT_DATA, ...parsed, entries: parsed.entries ?? [], weightHistory: parsed.weightHistory ?? [] });
          }
        })
        .catch(() => Alert.alert('Storage error', 'Saved data could not be loaded.'));
    }, []),
  );

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
      const key = quickAddKey({ title: entry.title, calories: entry.calories });
      if (!unique.has(key)) {
        unique.set(key, { title: entry.title, calories: entry.calories });
      }
      if (unique.size >= 8) break;
    }
    return Array.from(unique.values());
  }, [data.entries]);
  const favoriteQuickAdds = useMemo(() => data.favoriteQuickAdds ?? [], [data.favoriteQuickAdds]);
  const favoriteQuickAddKeys = useMemo(() => new Set(favoriteQuickAdds.map(quickAddKey)), [favoriteQuickAdds]);
  const activeQuickAdds = quickAddTab === 'favorites' ? favoriteQuickAdds : recentQuickAdds;
  const visibleEntries = useMemo(() => sortedTodayEntries.slice(0, 40), [sortedTodayEntries]);
  const todayCalories = todayEntries.reduce((sum, e) => sum + e.calories, 0);
  const latestHealthConnectWeight = data.weightHistory.find((point) => point.source === 'health-connect')?.weightKg ?? null;
  const latestWeight = data.manualWeightKg ?? latestHealthConnectWeight;
  const metabolism = estimateMetabolism({
    weightKg: latestWeight,
    heightCm: data.metabolismHeightCm,
    ageYears: data.metabolismAgeYears,
    sex: data.metabolismSex,
    activityLevel: data.activityLevel,
  });
  const goalDelta = getGoalCalorieDelta(data.goalPhase ?? 'maintain', {
    adjustmentType:
      data.goalPhase === 'cut'
        ? (data.cutAdjustmentType ?? 'kcal')
        : (data.goalPhase === 'bulk' ? (data.bulkAdjustmentType ?? 'kcal') : 'kcal'),
    adjustmentKcal:
      data.goalPhase === 'cut'
        ? (data.cutCalorieAdjustment ?? 500)
        : (data.goalPhase === 'bulk' ? (data.bulkCalorieAdjustment ?? 500) : 500),
    percentPerWeek:
      data.goalPhase === 'cut'
        ? (data.cutPercentPerWeek ?? 1)
        : (data.goalPhase === 'bulk' ? (data.bulkPercentPerWeek ?? 1) : 1),
    weightKg: latestWeight,
  });
  const baseCalculatedTarget = metabolism.maintenanceCalories
    ?? (latestWeight ? Math.round(latestWeight * data.caloriesPerKg) : data.baseTarget);
  const adjustedTarget = Math.round(baseCalculatedTarget + goalDelta);
  const remaining = adjustedTarget - todayCalories;
  const progress = Math.min(todayCalories / Math.max(adjustedTarget, 1), 1);
  const activeGoalAdjustmentType =
    data.goalPhase === 'cut'
      ? (data.cutAdjustmentType ?? 'kcal')
      : (data.goalPhase === 'bulk' ? (data.bulkAdjustmentType ?? 'kcal') : 'kcal');
  const goalModeLabel = data.goalPhase === 'cut' ? 'Cut' : data.goalPhase === 'bulk' ? 'Bulk' : 'Maintain';
  const goalModeIcon = data.goalPhase === 'cut' ? 'trending-down' : data.goalPhase === 'bulk' ? 'trending-up' : 'target';
  const goalModeTint = data.goalPhase === 'cut'
    ? (theme.dark ? '#ff8f70' : '#b93815')
    : data.goalPhase === 'bulk'
      ? (theme.dark ? '#88d9b2' : '#116b4e')
      : (theme.dark ? '#9fc9ff' : '#1d5fa8');
  const goalModeBg = data.goalPhase === 'cut'
    ? (theme.dark ? '#4a2217' : '#ffe2d8')
    : data.goalPhase === 'bulk'
      ? (theme.dark ? '#17392e' : '#daf5e8')
      : (theme.dark ? '#1c314d' : '#dcecff');
  const goalModeOnBg = data.goalPhase === 'cut'
    ? (theme.dark ? '#ffd8cd' : '#7f240d')
    : data.goalPhase === 'bulk'
      ? (theme.dark ? '#d7f8e7' : '#0a513b')
      : (theme.dark ? '#d8e8ff' : '#174a84');
  const goalModeDetail = data.goalPhase === 'maintain'
    ? 'Maintenance calories'
    : activeGoalAdjustmentType === 'percent'
      ? `${data.goalPhase === 'cut' ? '-' : '+'}${data.goalPhase === 'cut' ? (data.cutPercentPerWeek ?? 1) : (data.bulkPercentPerWeek ?? 1)}% / week`
      : `${goalDelta > 0 ? '+' : ''}${goalDelta} kcal / day`;

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

  const toggleFavoriteQuickAdd = useCallback((item: QuickAddItem) => {
    const key = quickAddKey(item);
    setData((prev) => {
      const current = prev.favoriteQuickAdds ?? [];
      const exists = current.some((fav) => quickAddKey(fav) === key);
      const nextFavorites = exists
        ? current.filter((fav) => quickAddKey(fav) !== key)
        : [item, ...current].slice(0, 24);
      return { ...prev, favoriteQuickAdds: nextFavorites };
    });
  }, []);

  const deleteEntry = useCallback((id: string) => {
    setData((prev) => ({ ...prev, entries: prev.entries.filter((e) => e.id !== id) }));
  }, []);

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Surface style={[styles.heroCard, { backgroundColor: theme.colors.elevation.level2 }]} elevation={3}>
          <Text variant="labelLarge" style={[styles.eyebrow, { color: theme.colors.primary }]}>Calorie Logger</Text>
          <View style={styles.goalBadgeRow}>
            <Chip
              icon={goalModeIcon}
              compact
              style={[styles.goalBadge, { backgroundColor: goalModeBg }]}
              textStyle={{ color: goalModeOnBg, fontWeight: '700' }}
            >
              {goalModeLabel}
            </Chip>
            <Text variant="bodySmall" style={{ color: goalModeTint, fontWeight: '700' }}>
              {goalModeDetail}
            </Text>
          </View>
          <View style={styles.progressSection}>
            <View style={styles.progressRow}>
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                {todayCalories} / {adjustedTarget} kcal
              </Text>
              <Text variant="bodyMedium" style={{ color: remaining < 0 ? theme.colors.error : theme.colors.primary }}>
                {remaining >= 0 ? `${remaining} kcal left` : `${Math.abs(remaining)} kcal over`}
              </Text>
            </View>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              BMR: {metabolism.bmr ? `${metabolism.bmr}` : 'N/A'} | TDEE: {metabolism.tdee ? `${metabolism.tdee}` : 'N/A'} | Maintenance: {metabolism.maintenanceCalories ? `${metabolism.maintenanceCalories}` : 'N/A'} kcal/day
            </Text>
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
            {(recentQuickAdds.length || favoriteQuickAdds.length) ? (
              <View style={styles.quickAddSection}>
                <SegmentedButtons
                  value={quickAddTab}
                  onValueChange={(value) => setQuickAddTab(value as QuickAddTab)}
                  buttons={[
                    { value: 'recent', label: 'Recents', icon: 'history' },
                    { value: 'favorites', label: 'Favourites', icon: 'star' },
                  ]}
                />
                <View style={styles.quickAddRow}>
                  {activeQuickAdds.length ? activeQuickAdds.map((item) => {
                    const key = quickAddKey(item);
                    const isFavorite = favoriteQuickAddKeys.has(key);
                    return (
                      <View key={key} style={styles.quickAddItem}>
                        <Chip icon="plus" compact onPress={() => quickAddMeal(item)}>
                          {item.title} ({item.calories})
                        </Chip>
                        <IconButton
                          icon={isFavorite ? 'star' : 'star-outline'}
                          size={18}
                          onPress={() => toggleFavoriteQuickAdd(item)}
                          accessibilityLabel={isFavorite ? 'Remove favourite' : 'Add favourite'}
                        />
                      </View>
                    );
                  }) : (
                    <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                      No favourites yet. Star an item from Recents.
                    </Text>
                  )}
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
  goalBadge: { borderRadius: 999 },
  goalBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 4, flexWrap: 'wrap' },
  formArea: { gap: 12 },
  quickAddSection: { gap: 8 },
  quickAddRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickAddItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
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
