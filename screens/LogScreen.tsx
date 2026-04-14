import { useFocusEffect } from '@react-navigation/native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View, Vibration } from 'react-native';
import { Button, Card, Chip, IconButton, ProgressBar, SegmentedButtons, Surface, Text, TextInput, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getAdjustedCalorieTarget, getAutoMacroTargets } from '../metabolism';
import { DEFAULT_DATA, getCachedData, loadStoredData, saveStoredData } from '../storage';
import type { MealEntry, StoredData } from '../storage';

type QuickAddItem = {
  title: string;
  calories: number;
  proteinGrams?: number | null;
  fatGrams?: number | null;
  carbsGrams?: number | null;
  fiberGrams?: number | null;
};

type SortMode = 'newest' | 'oldest';
type QuickAddTab = 'recent' | 'favorites';

type EditEntryDraft = {
  id: string;
  title: string;
  calories: string;
  protein: string;
  fat: string;
  carbs: string;
  fiber: string;
};

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
  return `${item.title.toLowerCase()}-${item.calories}-${item.proteinGrams ?? ''}-${item.fatGrams ?? ''}-${item.carbsGrams ?? ''}-${item.fiberGrams ?? ''}`;
}

function formatMacroLine(item: {
  proteinGrams?: number | null;
  fatGrams?: number | null;
  carbsGrams?: number | null;
  fiberGrams?: number | null;
}) {
  const parts = [
    typeof item.proteinGrams === 'number' ? `P ${item.proteinGrams}g` : null,
    typeof item.carbsGrams === 'number' ? `C ${item.carbsGrams}g` : null,
    typeof item.fatGrams === 'number' ? `F ${item.fatGrams}g` : null,
    typeof item.fiberGrams === 'number' ? `Fib ${item.fiberGrams}g` : null,
  ].filter((value): value is string => !!value);
  return parts.join('  ');
}

function getMacroCalories(item: {
  proteinGrams?: number | null;
  fatGrams?: number | null;
  carbsGrams?: number | null;
}) {
  const hasAnyMacro = typeof item.proteinGrams === 'number'
    || typeof item.fatGrams === 'number'
    || typeof item.carbsGrams === 'number';
  if (!hasAnyMacro) return null;
  const protein = item.proteinGrams ?? 0;
  const carbs = item.carbsGrams ?? 0;
  const fat = item.fatGrams ?? 0;
  return protein * 4 + carbs * 4 + fat * 9;
}

function getMacroCalorieMismatch(
  calories: number,
  item: { proteinGrams?: number | null; fatGrams?: number | null; carbsGrams?: number | null },
  options?: { tolerancePercent?: number },
) {
  const macroCalories = getMacroCalories(item);
  if (macroCalories === null) return null;
  const roundedMacroCalories = Math.round(macroCalories);
  const delta = Math.round(calories - roundedMacroCalories);
  const tolerancePercent = options?.tolerancePercent ?? 12;
  const tolerance = Math.round(calories * (tolerancePercent / 100));
  if (Math.abs(delta) <= tolerance) return null;
  return { macroCalories: roundedMacroCalories, delta };
}

const FIBER_GRAMS_PER_1000_KCAL = 14;
const QUICK_LOG_INPUT_THEME = { animation: { scale: 0 } };

type QuickLogCardProps = {
  recentQuickAdds: QuickAddItem[];
  favoriteQuickAdds: QuickAddItem[];
  favoriteQuickAddKeys: Set<string>;
  isMacrosExpanded: boolean;
  onSetMacrosExpanded: (next: boolean) => void;
  onAddMeal: (item: QuickAddItem) => void;
  onQuickAddMeal: (item: QuickAddItem) => void;
  onToggleFavoriteQuickAdd: (item: QuickAddItem) => void;
  data: StoredData;
};

const QuickLogCard = memo(function QuickLogCard({
  recentQuickAdds,
  favoriteQuickAdds,
  favoriteQuickAddKeys,
  isMacrosExpanded,
  onSetMacrosExpanded,
  onAddMeal,
  onQuickAddMeal,
  onToggleFavoriteQuickAdd,
  data,
}: QuickLogCardProps) {
  const theme = useTheme();
  const [mealTitle, setMealTitle] = useState('');
  const [mealCalories, setMealCalories] = useState('');
  const [mealProtein, setMealProtein] = useState('');
  const [mealFat, setMealFat] = useState('');
  const [mealCarbs, setMealCarbs] = useState('');
  const [mealFiber, setMealFiber] = useState('');
  const [mealMultiplier, setMealMultiplier] = useState('1'); // New state for multiplier
  const [quickAddTab, setQuickAddTab] = useState<QuickAddTab>('recent');

  const activeQuickAdds = quickAddTab === 'favorites' ? favoriteQuickAdds : recentQuickAdds;

  const addDraftMismatch = useMemo(() => {
    const calories = parseNumberInput(mealCalories);
    if (!calories || calories <= 0) return null;
    return getMacroCalorieMismatch(Math.round(calories), {
      proteinGrams: mealProtein.trim() ? parseNumberInput(mealProtein) : null,
      fatGrams: mealFat.trim() ? parseNumberInput(mealFat) : null,
      carbsGrams: mealCarbs.trim() ? parseNumberInput(mealCarbs) : null,
    }, {
      tolerancePercent: data.calorieTolerancePercent,
    });
  }, [mealCalories, mealCarbs, mealFat, mealProtein, data.calorieTolerancePercent]);

  const handleAddMeal = useCallback(() => {
    const multiplier = parseNumberInput(mealMultiplier);
    if (!multiplier || multiplier <= 0) {
      Alert.alert('Invalid multiplier', 'Multiplier must be a positive number.');
      return;
    }

    const calories = parseNumberInput(mealCalories);
    const protein = mealProtein.trim() ? parseNumberInput(mealProtein) : null;
    const fat = mealFat.trim() ? parseNumberInput(mealFat) : null;
    const carbs = mealCarbs.trim() ? parseNumberInput(mealCarbs) : null;
    const fiber = mealFiber.trim() ? parseNumberInput(mealFiber) : null;

    if (!mealTitle.trim()) { Alert.alert('Missing meal name', 'Add a label.'); return; }
    if (!calories || calories <= 0) { Alert.alert('Invalid calories', 'Enter a positive number.'); return; }
    if (protein !== null && protein < 0) { Alert.alert('Invalid protein', 'Protein must be 0 or more.'); return; }
    if (fat !== null && fat < 0) { Alert.alert('Invalid fat', 'Fat must be 0 or more.'); return; }
    if (carbs !== null && carbs < 0) { Alert.alert('Invalid carbs', 'Carbs must be 0 or more.'); return; }
    if (fiber !== null && fiber < 0) { Alert.alert('Invalid fibre', 'Fibre must be 0 or more.'); return; }

    onAddMeal({
      title: mealTitle.trim(),
      calories: Math.round(calories * multiplier),
      proteinGrams: protein !== null ? Math.round(protein * multiplier * 10) / 10 : null,
      fatGrams: fat !== null ? Math.round(fat * multiplier * 10) / 10 : null,
      carbsGrams: carbs !== null ? Math.round(carbs * multiplier * 10) / 10 : null,
      fiberGrams: fiber !== null ? Math.round(fiber * multiplier * 10) / 10 : null,
    });

    setMealTitle('');
    setMealCalories('');
    setMealProtein('');
    setMealFat('');
    setMealCarbs('');
    setMealFiber('');
    setMealMultiplier('1'); // Reset multiplier
    Vibration.vibrate(12);
  }, [mealCalories, mealCarbs, mealFat, mealFiber, mealMultiplier, mealProtein, mealTitle, onAddMeal]);

  return (
    <Card style={styles.card} mode="elevated">
      <Card.Title
        title="Quick Log"
        titleVariant="titleLarge"
        style={styles.quickLogHeader}
        titleStyle={styles.quickLogTitle}
      />
      <Card.Content style={styles.formArea}>
        <TextInput
          label="Meal"
          value={mealTitle}
          onChangeText={setMealTitle}
          placeholder="Breakfast burrito"
          mode="outlined"
          theme={QUICK_LOG_INPUT_THEME}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <TextInput
            label="Calories (kcal)"
            value={mealCalories}
            onChangeText={setMealCalories}
            placeholder="620"
            keyboardType="numeric"
            mode="outlined"
            theme={QUICK_LOG_INPUT_THEME}
            style={{ flex: 1, marginRight: 8 }} // Adjusted width and spacing
          />
          <TextInput
            label="Multiplier (×)"
            value={mealMultiplier}
            onChangeText={setMealMultiplier}
            placeholder="1"
            keyboardType="numeric"
            mode="outlined"
            theme={QUICK_LOG_INPUT_THEME}
            style={{ flex: 1 }} // Adjusted width
          />
        </View>
        <Pressable
          onPress={() => onSetMacrosExpanded(!isMacrosExpanded)}
          style={[styles.macroSectionHeader, { backgroundColor: theme.colors.elevation.level1, borderColor: theme.colors.outlineVariant }]}
        >
          <View style={styles.macroSectionTitle}>
            <MaterialCommunityIcons name="nutrition" size={16} color={theme.colors.primary} />
            <Text variant="labelLarge" style={{ color: theme.colors.onSurface }}>Macros</Text>
            <Chip compact mode="flat" style={{ backgroundColor: theme.colors.surfaceVariant }} textStyle={{ color: theme.colors.onSurfaceVariant }}>
              Optional
            </Chip>
          </View>
          <MaterialCommunityIcons
            name={isMacrosExpanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={theme.colors.onSurfaceVariant}
          />
        </Pressable>
        {isMacrosExpanded ? (
          <>
            <View style={styles.macroGrid}>
              <TextInput
                label="Protein (g)"
                value={mealProtein}
                onChangeText={setMealProtein}
                placeholder="35"
                keyboardType="numeric"
                mode="outlined"
                style={styles.macroInput}
                theme={QUICK_LOG_INPUT_THEME}
              />
              <TextInput
                label="Carbs (g)"
                value={mealCarbs}
                onChangeText={setMealCarbs}
                placeholder="60"
                keyboardType="numeric"
                mode="outlined"
                style={styles.macroInput}
                theme={QUICK_LOG_INPUT_THEME}
              />
              <TextInput
                label="Fat (g)"
                value={mealFat}
                onChangeText={setMealFat}
                placeholder="18"
                keyboardType="numeric"
                mode="outlined"
                style={styles.macroInput}
                theme={QUICK_LOG_INPUT_THEME}
              />
              <TextInput
                label="Fibre (g)"
                value={mealFiber}
                onChangeText={setMealFiber}
                placeholder="8"
                keyboardType="numeric"
                mode="outlined"
                style={styles.macroInput}
                theme={QUICK_LOG_INPUT_THEME}
              />
            </View>
            {addDraftMismatch ? (
              <View style={styles.mismatchRow}>
                <MaterialCommunityIcons name="alert-circle-outline" size={14} color={theme.colors.error} />
                <Text variant="bodySmall" style={{ color: theme.colors.error }}>
                  Macros estimate about {addDraftMismatch.macroCalories} kcal, which differs from logged calories.
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
        <Button mode="contained" icon="plus" onPress={handleAddMeal}>
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
            {activeQuickAdds.length ? (
              <View>
                <View style={[styles.quickAddScrollFrame, { borderColor: theme.colors.outlineVariant }]}> 
                  <ScrollView
                    style={styles.quickAddScroll}
                    showsVerticalScrollIndicator={false}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.quickAddRow}
                  >
                    {activeQuickAdds.map((item) => {
                      const key = quickAddKey(item);
                      const isFavorite = favoriteQuickAddKeys.has(key);
                      return (
                        <View key={key} style={styles.quickAddItem}>
                          <Chip icon="plus" compact onPress={() => onQuickAddMeal(item)}>
                            {item.title} ({item.calories})
                          </Chip>
                          <IconButton
                            icon={isFavorite ? 'star' : 'star-outline'}
                            size={18}
                            onPress={() => onToggleFavoriteQuickAdd(item)}
                            accessibilityLabel={isFavorite ? 'Remove favourite' : 'Add favourite'}
                          />
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
                {activeQuickAdds.length > 3 ? (
                  <View style={styles.quickAddScrollHint}>
                    <MaterialCommunityIcons name="chevron-double-down" size={14} color={theme.colors.onSurfaceVariant} />
                    <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
                      Scroll for more
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
                No favourites yet. Star an item from Recents.
              </Text>
            )}
          </View>
        ) : null}
      </Card.Content>
    </Card>
  );
});

export default function LogScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [data, setData] = useState<StoredData>(() => getCachedData() ?? DEFAULT_DATA);
  const [isReady, setIsReady] = useState(false);
  const hasCompletedInitialLoad = useRef(false);
  const [sortMode, setSortMode] = useState<SortMode>('newest');
  const [macroModalVisible, setMacroModalVisible] = useState(false);
  const [editDraft, setEditDraft] = useState<EditEntryDraft | null>(null);
  const [showEditMacros, setShowEditMacros] = useState(false);

  useEffect(() => {
    loadStoredData()
      .then((next) => setData(next))
      .catch(() => Alert.alert('Storage error', 'Saved data could not be loaded.'))
      .finally(() => {
        hasCompletedInitialLoad.current = true;
        setIsReady(true);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!hasCompletedInitialLoad.current) return;
      loadStoredData()
        .then((next) => setData(next))
        .catch(() => Alert.alert('Storage error', 'Saved data could not be loaded.'));
    }, []),
  );

  useEffect(() => {
    if (!isReady) return;
    saveStoredData(data).catch(() =>
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
        unique.set(key, {
          title: entry.title,
          calories: entry.calories,
          proteinGrams: entry.proteinGrams ?? null,
          fatGrams: entry.fatGrams ?? null,
          carbsGrams: entry.carbsGrams ?? null,
          fiberGrams: entry.fiberGrams ?? null,
        });
      }
      if (unique.size >= 8) break;
    }
    return Array.from(unique.values());
  }, [data.entries]);
  const favoriteQuickAdds = useMemo(() => data.favoriteQuickAdds ?? [], [data.favoriteQuickAdds]);
  const favoriteQuickAddKeys = useMemo(() => new Set(favoriteQuickAdds.map(quickAddKey)), [favoriteQuickAdds]);
  const visibleEntries = useMemo(() => sortedTodayEntries.slice(0, 40), [sortedTodayEntries]);
  const todayCalories = todayEntries.reduce((sum, e) => sum + e.calories, 0);
  const { adjustedTarget, goalDelta, metabolism } = useMemo(
    () => getAdjustedCalorieTarget(data),
    [data],
  );
  const remaining = adjustedTarget - todayCalories;
  const progress = Math.min(todayCalories / Math.max(adjustedTarget, 1), 1);

  const autoMacroTargets = useMemo(
    () => getAutoMacroTargets(adjustedTarget, data.goalPhase ?? 'maintain'),
    [adjustedTarget, data.goalPhase],
  );

  // Calculate macro totals
  const todayTotalProtein = todayEntries.reduce((sum, e) => sum + (e.proteinGrams ?? 0), 0);
  const todayTotalFat = todayEntries.reduce((sum, e) => sum + (e.fatGrams ?? 0), 0);
  const todayTotalCarbs = todayEntries.reduce((sum, e) => sum + (e.carbsGrams ?? 0), 0);
  const todayTotalFiber = todayEntries.reduce((sum, e) => sum + (e.fiberGrams ?? 0), 0);

  const proteinGoal = data.proteinGoalGrams ?? autoMacroTargets.proteinGrams;
  const fatGoal = data.fatGoalGrams ?? autoMacroTargets.fatGrams;
  const carbsGoal = data.carbsGoalGrams ?? autoMacroTargets.carbsGrams;
  const fiberGoal = data.fiberGoalGrams ?? Math.max(0, Math.round((adjustedTarget / 1000) * FIBER_GRAMS_PER_1000_KCAL));

  const proteinProgress = proteinGoal ? Math.min(todayTotalProtein / proteinGoal, 1) : 0;
  const fatProgress = fatGoal ? Math.min(todayTotalFat / fatGoal, 1) : 0;
  const carbsProgress = carbsGoal ? Math.min(todayTotalCarbs / carbsGoal, 1) : 0;
  const fiberProgress = fiberGoal ? Math.min(todayTotalFiber / fiberGoal, 1) : 0;

  const hasMacroGoals = proteinGoal > 0 || fatGoal > 0 || carbsGoal > 0;

  const editDraftMismatch = useMemo(() => {
    if (!editDraft) return null;
    const calories = parseNumberInput(editDraft.calories);
    if (!calories || calories <= 0) return null;
    return getMacroCalorieMismatch(Math.round(calories), {
      proteinGrams: editDraft.protein.trim() ? parseNumberInput(editDraft.protein) : null,
      fatGrams: editDraft.fat.trim() ? parseNumberInput(editDraft.fat) : null,
      carbsGrams: editDraft.carbs.trim() ? parseNumberInput(editDraft.carbs) : null,
    }, {
      tolerancePercent: data.calorieTolerancePercent,
    });
  }, [editDraft, data.calorieTolerancePercent]);

  const macroGoalModeIcon =
    data.proteinGoalGrams !== null || data.carbsGoalGrams !== null || data.fatGoalGrams !== null || data.fiberGoalGrams !== null
      ? 'tune'
      : 'brightness-auto';
  const macroGoalModeText =
    data.proteinGoalGrams !== null || data.carbsGoalGrams !== null || data.fatGoalGrams !== null || data.fiberGoalGrams !== null
      ? 'Custom macro targets'
      : 'Auto macro targets';

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

  const macroPalette = useMemo(() => ({
    protein: {
      color: theme.dark ? '#ffb27a' : '#a34a12',
      background: theme.dark ? '#4d2813' : '#ffe7d7',
    },
    carbs: {
      color: theme.dark ? '#ffd56e' : '#976700',
      background: theme.dark ? '#4c3902' : '#fff0c5',
    },
    fat: {
      color: theme.dark ? '#8fc8ff' : '#1c5f97',
      background: theme.dark ? '#1b3550' : '#dbeeff',
    },
    fiber: {
      color: theme.dark ? '#96e0a0' : '#257536',
      background: theme.dark ? '#1b3921' : '#dff4e2',
    },
  }), [theme.dark]);

  const addMeal = useCallback((item: QuickAddItem) => {
    setData((prev) => ({
      ...prev,
      entries: [
        {
          id: createId(),
          title: item.title,
          calories: item.calories,
          proteinGrams: item.proteinGrams ?? null,
          fatGrams: item.fatGrams ?? null,
          carbsGrams: item.carbsGrams ?? null,
          fiberGrams: item.fiberGrams ?? null,
          loggedAt: new Date().toISOString(),
        },
        ...prev.entries,
      ],
    }));
  }, []);

  const quickAddMeal = useCallback((item: QuickAddItem) => {
    setData((prev) => ({
      ...prev,
      entries: [
        {
          id: createId(),
          title: item.title,
          calories: item.calories,
          proteinGrams: item.proteinGrams ?? null,
          fatGrams: item.fatGrams ?? null,
          carbsGrams: item.carbsGrams ?? null,
          fiberGrams: item.fiberGrams ?? null,
          loggedAt: new Date().toISOString(),
        },
        ...prev.entries,
      ],
    }));
    Vibration.vibrate(10);
  }, []);

  const toggleFavoriteQuickAdd = useCallback((item: QuickAddItem) => {
    Vibration.vibrate(10);
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

  const openEditEntry = useCallback((entry: MealEntry) => {
    Vibration.vibrate(10);
    setShowEditMacros(false);
    setEditDraft({
      id: entry.id,
      title: entry.title,
      calories: `${entry.calories}`,
      protein: typeof entry.proteinGrams === 'number' ? `${entry.proteinGrams}` : '',
      fat: typeof entry.fatGrams === 'number' ? `${entry.fatGrams}` : '',
      carbs: typeof entry.carbsGrams === 'number' ? `${entry.carbsGrams}` : '',
      fiber: typeof entry.fiberGrams === 'number' ? `${entry.fiberGrams}` : '',
    });
  }, []);

  const closeEditModal = useCallback(() => {
    setShowEditMacros(false);
    setEditDraft(null);
  }, []);

  const saveEditedEntry = useCallback(() => {
    if (!editDraft) return;
    const calories = parseNumberInput(editDraft.calories);
    const protein = editDraft.protein.trim() ? parseNumberInput(editDraft.protein) : null;
    const fat = editDraft.fat.trim() ? parseNumberInput(editDraft.fat) : null;
    const carbs = editDraft.carbs.trim() ? parseNumberInput(editDraft.carbs) : null;
    const fiber = editDraft.fiber.trim() ? parseNumberInput(editDraft.fiber) : null;

    if (!editDraft.title.trim()) { Alert.alert('Missing meal name', 'Add a label.'); return; }
    if (!calories || calories <= 0) { Alert.alert('Invalid calories', 'Enter a positive number.'); return; }
    if (protein !== null && protein < 0) { Alert.alert('Invalid protein', 'Protein must be 0 or more.'); return; }
    if (fat !== null && fat < 0) { Alert.alert('Invalid fat', 'Fat must be 0 or more.'); return; }
    if (carbs !== null && carbs < 0) { Alert.alert('Invalid carbs', 'Carbs must be 0 or more.'); return; }
    if (fiber !== null && fiber < 0) { Alert.alert('Invalid fibre', 'Fibre must be 0 or more.'); return; }

    setData((prev) => ({
      ...prev,
      entries: prev.entries.map((entry) => (
        entry.id === editDraft.id
          ? {
              ...entry,
              title: editDraft.title.trim(),
              calories: Math.round(calories),
              proteinGrams: protein !== null ? Math.round(protein * 10) / 10 : null,
              fatGrams: fat !== null ? Math.round(fat * 10) / 10 : null,
              carbsGrams: carbs !== null ? Math.round(carbs * 10) / 10 : null,
              fiberGrams: fiber !== null ? Math.round(fiber * 10) / 10 : null,
            }
          : entry
      )),
    }));
    closeEditModal();
  }, [closeEditModal, editDraft]);

  const renderedEntries = useMemo(() => {
    return visibleEntries.map((entry) => {
      const mismatch = getMacroCalorieMismatch(entry.calories, entry, {
        tolerancePercent: data.calorieTolerancePercent,
      });
      const entryAsQuickAdd: QuickAddItem = {
        title: entry.title,
        calories: entry.calories,
        proteinGrams: entry.proteinGrams ?? null,
        fatGrams: entry.fatGrams ?? null,
        carbsGrams: entry.carbsGrams ?? null,
        fiberGrams: entry.fiberGrams ?? null,
      };
      const isEntryFavorite = favoriteQuickAddKeys.has(quickAddKey(entryAsQuickAdd));

      return (
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
          <View style={styles.entryMain}>
            <View style={styles.entryTopLine}>
              <View style={styles.entryTitleRow}>
                <Text
                  variant="titleSmall"
                  numberOfLines={1}
                  style={[styles.entryTitle, { color: theme.colors.onSurface }]}
                >
                  {entry.title}
                </Text>
                <Text variant="labelMedium" style={{ color: theme.colors.primary, fontWeight: '700' }}>
                  {entry.calories} kcal
                </Text>
              </View>
            </View>
            <Text
              variant="bodySmall"
              numberOfLines={1}
              style={[styles.entryMeta, { color: theme.colors.onSurfaceVariant }]}
            >
              {formatDisplayDate(entry.loggedAt)}{formatMacroLine(entry) ? `  •  ${formatMacroLine(entry)}` : ''}
            </Text>
            {mismatch ? (
              <View style={styles.mismatchRow}>
                <MaterialCommunityIcons name="alert-circle-outline" size={14} color={theme.colors.error} />
                <Text variant="bodySmall" numberOfLines={1} style={{ color: theme.colors.error }}>
                  Macros imply ~{mismatch.macroCalories} kcal.
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.entryActions}>
            <IconButton
              icon={isEntryFavorite ? 'star' : 'star-outline'}
              size={18}
              style={styles.entryActionIcon}
              onPress={() => toggleFavoriteQuickAdd(entryAsQuickAdd)}
              accessibilityLabel={isEntryFavorite ? 'Remove favourite' : 'Add favourite'}
            />
            <IconButton
              icon="pencil-outline"
              size={18}
              style={styles.entryActionIcon}
              onPress={() => openEditEntry(entry)}
              accessibilityLabel="Edit entry"
            />
            <IconButton
              icon="delete-outline"
              size={18}
              style={styles.entryActionIcon}
              iconColor={theme.colors.error}
              onPress={() => deleteEntry(entry.id)}
              accessibilityLabel="Delete entry"
            />
          </View>
        </Surface>
      );
    });
  }, [
    deleteEntry,
    favoriteQuickAddKeys,
    openEditEntry,
    theme.colors.elevation.level1,
    theme.colors.error,
    theme.colors.onSurface,
    theme.colors.onSurfaceVariant,
    theme.colors.outlineVariant,
    theme.colors.primary,
    toggleFavoriteQuickAdd,
    visibleEntries,
    data.calorieTolerancePercent,
  ]);

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
            {hasMacroGoals ? (
              <Pressable
                onPress={() => {
                  Vibration.vibrate(10);
                  setMacroModalVisible(true);
                }}
              >
                <View style={[styles.macroSummaryBar, { backgroundColor: theme.colors.elevation.level1, borderColor: theme.colors.outlineVariant }]}>
                  <View style={styles.macroSummaryContent}>
                    {proteinGoal !== null ? (
                      <View style={[styles.macroToken, { backgroundColor: macroPalette.protein.background }]}>
                        <Text variant="labelSmall" style={{ color: macroPalette.protein.color, fontWeight: '700' }}>
                          P {Math.round(todayTotalProtein)}/{Math.round(proteinGoal)}
                        </Text>
                      </View>
                    ) : null}
                    {carbsGoal !== null ? (
                      <View style={[styles.macroToken, { backgroundColor: macroPalette.carbs.background }]}>
                        <Text variant="labelSmall" style={{ color: macroPalette.carbs.color, fontWeight: '700' }}>
                          C {Math.round(todayTotalCarbs)}/{Math.round(carbsGoal)}
                        </Text>
                      </View>
                    ) : null}
                    {fatGoal !== null ? (
                      <View style={[styles.macroToken, { backgroundColor: macroPalette.fat.background }]}>
                        <Text variant="labelSmall" style={{ color: macroPalette.fat.color, fontWeight: '700' }}>
                          F {Math.round(todayTotalFat)}/{Math.round(fatGoal)}
                        </Text>
                      </View>
                    ) : null}
                    <View style={[styles.macroToken, { backgroundColor: macroPalette.fiber.background }]}>
                      <Text variant="labelSmall" style={{ color: macroPalette.fiber.color, fontWeight: '700' }}>
                        Fib {Math.round(todayTotalFiber)}/{Math.round(fiberGoal)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.macroSummaryMeta}>
                    <MaterialCommunityIcons name={macroGoalModeIcon} size={16} color={theme.colors.onSurfaceVariant} />
                    <MaterialCommunityIcons name="chevron-down" size={16} color={theme.colors.onSurfaceVariant} />
                  </View>
                </View>
              </Pressable>
            ) : null}
          </View>
        </Surface>

        <QuickLogCard
          recentQuickAdds={recentQuickAdds}
          favoriteQuickAdds={favoriteQuickAdds}
          favoriteQuickAddKeys={favoriteQuickAddKeys}
          isMacrosExpanded={data.quickLogMacrosExpanded}
          onSetMacrosExpanded={(next) => setData((prev) => ({ ...prev, quickLogMacrosExpanded: next }))}
          onAddMeal={addMeal}
          onQuickAddMeal={quickAddMeal}
          onToggleFavoriteQuickAdd={toggleFavoriteQuickAdd}
          data={data}
        />

        <Card style={styles.card} mode="elevated">
          <Card.Title
            title="Today's Entries"
            titleVariant="titleLarge"
            rightStyle={styles.entriesHeaderRight}
            right={() => (
              <Button
                mode="text"
                compact
                icon="sort-clock-descending"
                style={styles.entriesSortButton}
                contentStyle={styles.entriesSortButtonContent}
                labelStyle={styles.entriesSortButtonLabel}
                onPress={() => setSortMode((prev) => (prev === 'newest' ? 'oldest' : 'newest'))}
              >
                {sortMode === 'newest' ? 'Newest' : 'Oldest'}
              </Button>
            )}
          />
          <Card.Content style={styles.entriesList}>
          {visibleEntries.length ? renderedEntries : (
            <Text variant="bodyMedium" style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>No entries logged today yet.</Text>
          )}
          </Card.Content>
        </Card>
      </ScrollView>

      <Modal
        visible={editDraft !== null}
        transparent
        animationType="fade"
        onRequestClose={closeEditModal}
      >
        <Pressable style={styles.modalBackdrop} onPress={closeEditModal}>
          <Pressable
            style={[styles.modalCard, { backgroundColor: theme.colors.surface }]}
            onPress={() => {}}
          >
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Edit Entry</Text>
            <TextInput
              label="Meal"
              value={editDraft?.title ?? ''}
              onChangeText={(value) => setEditDraft((prev) => (prev ? { ...prev, title: value } : prev))}
              mode="outlined"
            />
            <TextInput
              label="Calories (kcal)"
              value={editDraft?.calories ?? ''}
              onChangeText={(value) => setEditDraft((prev) => (prev ? { ...prev, calories: value } : prev))}
              keyboardType="numeric"
              mode="outlined"
            />
            <Pressable
              onPress={() => setShowEditMacros((prev) => !prev)}
              style={[styles.macroSectionHeader, { backgroundColor: theme.colors.elevation.level1, borderColor: theme.colors.outlineVariant }]}
            >
              <View style={styles.macroSectionTitle}>
                <MaterialCommunityIcons name="nutrition" size={16} color={theme.colors.primary} />
                <Text variant="labelLarge" style={{ color: theme.colors.onSurface }}>Macros</Text>
                <Chip compact mode="flat" style={{ backgroundColor: theme.colors.surfaceVariant }} textStyle={{ color: theme.colors.onSurfaceVariant }}>
                  Optional
                </Chip>
              </View>
              <MaterialCommunityIcons
                name={showEditMacros ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={theme.colors.onSurfaceVariant}
              />
            </Pressable>
            {editDraftMismatch ? (
              <View style={styles.mismatchRow}>
                <MaterialCommunityIcons name="alert-circle-outline" size={14} color={theme.colors.error} />
                <Text variant="bodySmall" style={{ color: theme.colors.error }}>
                  Macros estimate about {editDraftMismatch.macroCalories} kcal, which differs from logged calories.
                </Text>
              </View>
            ) : null}
            {showEditMacros ? (
              <View style={styles.macroGrid}>
                <TextInput
                  label="Protein (g)"
                  value={editDraft?.protein ?? ''}
                  onChangeText={(value) => setEditDraft((prev) => (prev ? { ...prev, protein: value } : prev))}
                  keyboardType="numeric"
                  mode="outlined"
                  style={styles.macroInput}
                  theme={QUICK_LOG_INPUT_THEME}
                />
                <TextInput
                  label="Carbs (g)"
                  value={editDraft?.carbs ?? ''}
                  onChangeText={(value) => setEditDraft((prev) => (prev ? { ...prev, carbs: value } : prev))}
                  keyboardType="numeric"
                  mode="outlined"
                  style={styles.macroInput}
                  theme={QUICK_LOG_INPUT_THEME}
                />
                <TextInput
                  label="Fat (g)"
                  value={editDraft?.fat ?? ''}
                  onChangeText={(value) => setEditDraft((prev) => (prev ? { ...prev, fat: value } : prev))}
                  keyboardType="numeric"
                  mode="outlined"
                  style={styles.macroInput}
                  theme={QUICK_LOG_INPUT_THEME}
                />
                <TextInput
                  label="Fibre (g)"
                  value={editDraft?.fiber ?? ''}
                  onChangeText={(value) => setEditDraft((prev) => (prev ? { ...prev, fiber: value } : prev))}
                  keyboardType="numeric"
                  mode="outlined"
                  style={styles.macroInput}
                  theme={QUICK_LOG_INPUT_THEME}
                />
              </View>
            ) : null}
            <View style={styles.editActionsRow}>
              <Button mode="text" onPress={closeEditModal}>Cancel</Button>
              <Button mode="contained" onPress={saveEditedEntry}>Save</Button>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={macroModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMacroModalVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setMacroModalVisible(false)}
        >
          <Pressable
            style={[styles.modalCard, { backgroundColor: theme.colors.surface }]}
            onPress={() => {}}
          >
            <Text variant="titleMedium" style={{ fontWeight: '700', marginBottom: 4 }}>
              Today's Macros
            </Text>
            <View style={styles.macroModeRow}>
              <MaterialCommunityIcons name={macroGoalModeIcon} size={16} color={theme.colors.onSurfaceVariant} />
              <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                {macroGoalModeText}
              </Text>
            </View>

            {proteinGoal !== null ? (
              <View style={styles.macroRow}>
                <View style={styles.macroLabel}>
                  <View style={styles.macroRowHeader}>
                    <MaterialCommunityIcons name="food-steak" size={16} color={macroPalette.protein.color} />
                    <Text variant="labelSmall" style={{ fontWeight: '700', color: macroPalette.protein.color }}>Protein</Text>
                  </View>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {Math.round(todayTotalProtein)} / {Math.round(proteinGoal)} g
                  </Text>
                </View>
                <ProgressBar
                  progress={proteinProgress}
                  color={macroPalette.protein.color}
                  style={styles.macroBar}
                />
              </View>
            ) : null}

            {carbsGoal !== null ? (
              <View style={styles.macroRow}>
                <View style={styles.macroLabel}>
                  <View style={styles.macroRowHeader}>
                    <MaterialCommunityIcons name="bread-slice-outline" size={16} color={macroPalette.carbs.color} />
                    <Text variant="labelSmall" style={{ fontWeight: '700', color: macroPalette.carbs.color }}>Carbs</Text>
                  </View>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {Math.round(todayTotalCarbs)} / {Math.round(carbsGoal)} g
                  </Text>
                </View>
                <ProgressBar
                  progress={carbsProgress}
                  color={macroPalette.carbs.color}
                  style={styles.macroBar}
                />
              </View>
            ) : null}

            {fatGoal !== null ? (
              <View style={styles.macroRow}>
                <View style={styles.macroLabel}>
                  <View style={styles.macroRowHeader}>
                    <MaterialCommunityIcons name="water-outline" size={16} color={macroPalette.fat.color} />
                    <Text variant="labelSmall" style={{ fontWeight: '700', color: macroPalette.fat.color }}>Fat</Text>
                  </View>
                  <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                    {Math.round(todayTotalFat)} / {Math.round(fatGoal)} g
                  </Text>
                </View>
                <ProgressBar
                  progress={fatProgress}
                  color={macroPalette.fat.color}
                  style={styles.macroBar}
                />
              </View>
            ) : null}

            <View style={styles.macroRow}>
              <View style={styles.macroLabel}>
                <View style={styles.macroRowHeader}>
                  <MaterialCommunityIcons name="leaf" size={16} color={macroPalette.fiber.color} />
                  <Text variant="labelSmall" style={{ fontWeight: '700', color: macroPalette.fiber.color }}>Fibre</Text>
                </View>
                <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                  {Math.round(todayTotalFiber)} / {Math.round(fiberGoal)} g
                </Text>
              </View>
              <ProgressBar
                progress={fiberProgress}
                color={macroPalette.fiber.color}
                style={styles.macroBar}
              />
            </View>

            <Button
              mode="text"
              onPress={() => setMacroModalVisible(false)}
              style={{ marginTop: 16 }}
            >
              Close
            </Button>
          </Pressable>
        </Pressable>
      </Modal>
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
  macroSummaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  macroSummaryContent: {
    flexDirection: 'row',
    gap: 6,
    flex: 1,
    flexWrap: 'nowrap',
  },
  macroSummaryMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 8,
  },
  macroToken: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    borderRadius: 20,
    padding: 20,
    gap: 12,
    maxWidth: 500,
    width: '100%',
  },
  macrosSection: { marginTop: 8, paddingTop: 8, borderTopWidth: 1 },
  macroRow: { marginBottom: 8, gap: 8 },
  macroModeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  macroLabel: { gap: 4 },
  macroRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  macroBar: { height: 8, borderRadius: 999 },
  card: { borderRadius: 24 },
  goalBadge: { borderRadius: 999 },
  goalBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, marginBottom: 4, flexWrap: 'wrap' },
  formArea: { gap: 12 },
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  macroInput: { minWidth: '47%', flexGrow: 1 },
  quickAddSection: { gap: 8 },
  quickAddScrollFrame: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  quickAddScroll: { maxHeight: 164 },
  quickAddRow: { flexDirection: 'column', gap: 8, paddingRight: 4, paddingBottom: 2 },
  quickAddScrollHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 4,
  },
  quickAddItem: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  quickLogHeader: { minHeight: 56, paddingVertical: 6 },
  quickLogTitle: { marginLeft: -2 },
  macroSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  macroSectionTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  entriesHeaderRight: { marginRight: 8 },
  entriesSortButton: { marginVertical: 0 },
  entriesSortButtonContent: { paddingHorizontal: 2 },
  entriesSortButtonLabel: { marginHorizontal: 4 },
  entriesList: { gap: 8 },
  editActionsRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },
  mismatchRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  entryMain: { flex: 1, gap: 4, marginRight: 8 },
  entryTopLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start' },
  entryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  entryTitle: { flexShrink: 1 },
  entryMeta: {},
  entryActions: { flexDirection: 'row', alignItems: 'center', marginRight: -6 },
  entryActionIcon: { margin: 0 },
  emptyText: {},
});
