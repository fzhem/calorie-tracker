import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View, Vibration } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Chip, Menu, SegmentedButtons, Text, TextInput, useTheme } from 'react-native-paper';

import { DEFAULT_DATA, STORAGE_KEY } from '../storage';
import type { GoalAdjustmentType, GoalPhase, StoredData, WeightPoint } from '../storage';
import { estimateMetabolism, getActivityFactor, getGoalCalorieDelta } from '../metabolism';

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;
const DEFAULT_HEIGHT_CM = 170;
const HEIGHT_MIN_CM = 92;
const HEIGHT_MAX_CM = 214;
const HEIGHT_MIN_IN = Math.ceil(HEIGHT_MIN_CM / CM_PER_IN);
const HEIGHT_MAX_IN = Math.floor(HEIGHT_MAX_CM / CM_PER_IN);
const HEIGHT_ROW_HEIGHT = 44;
const PICKER_VISIBLE_ROWS = 3;
const PICKER_HEIGHT = PICKER_VISIBLE_ROWS * HEIGHT_ROW_HEIGHT;
const PICKER_PADDING = Math.floor(PICKER_VISIBLE_ROWS / 2) * HEIGHT_ROW_HEIGHT;

type WeightUnit = 'kg' | 'lb';
type HeightUnit = 'cm' | 'ft-in';
type HeightPickerItem = { key: string; cm: number; label: string };
type EditableGoalPhase = Exclude<GoalPhase, 'maintain'>;

type HeightPickerOptionProps = {
  label: string;
  isSelected: boolean;
};

const HeightPickerOption = memo(function HeightPickerOption({
  label,
  isSelected,
}: HeightPickerOptionProps) {
  const theme = useTheme();
  return (
    <View style={styles.heightPickerRow}>
      <Text
        style={[
          styles.heightPickerRowText,
          { color: isSelected ? theme.colors.primary : theme.colors.onSurface },
          isSelected && styles.heightPickerRowTextSelected,
        ]}
      >
        {label}
      </Text>
    </View>
  );
});

function roundTo(value: number, digits = 1) {
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

function parseNumberInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mergeWeightHistory(existing: WeightPoint[], incoming: WeightPoint[]): WeightPoint[] {
  const keyed = new Map<string, WeightPoint>();
  for (const p of [...existing, ...incoming]) keyed.set(`${p.source}-${p.recordedAt}`, p);
  return Array.from(keyed.values()).sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
  );
}

function formatDisplayDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getActivityLabel(activityLevel: StoredData['activityLevel']) {
  if (activityLevel === 'sedentary') return 'Sedentary';
  if (activityLevel === 'light') return 'Light';
  if (activityLevel === 'moderate') return 'Moderate';
  if (activityLevel === 'athlete' || activityLevel === 'extra-active') return 'Athlete';
  return 'Heavy';
}

function getActivityIcon(activityLevel: StoredData['activityLevel']) {
  if (activityLevel === 'sedentary') return 'sofa';
  if (activityLevel === 'light') return 'walk';
  if (activityLevel === 'moderate') return 'run';
  if (activityLevel === 'athlete' || activityLevel === 'extra-active') return 'arm-flex';
  return 'dumbbell';
}

function formatWeightForUnit(weightKg: number, unit: WeightUnit) {
  const displayValue = unit === 'kg' ? weightKg : weightKg / KG_PER_LB;
  return `${roundTo(displayValue, 2)}`;
}

function formatHeightForUnit(heightCm: number, unit: HeightUnit) {
  if (unit === 'cm') return `${roundTo(heightCm, 1)} cm`;
  const totalInches = Math.round(heightCm / CM_PER_IN);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}' ${inches}"`;
}

function formatFeetInches(totalInches: number) {
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet}' ${inches}"`;
}

export default function GoalsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [data, setData] = useState<StoredData>(DEFAULT_DATA);
  const [isReady, setIsReady] = useState(false);
  const [baseTargetInput, setBaseTargetInput] = useState(`${DEFAULT_DATA.baseTarget}`);
  const [caloriesPerKgInput, setCaloriesPerKgInput] = useState(`${DEFAULT_DATA.caloriesPerKg}`);
  const [goalAdjustmentEditorPhase, setGoalAdjustmentEditorPhase] = useState<EditableGoalPhase>('cut');
  const [goalAdjustmentTypeInput, setGoalAdjustmentTypeInput] = useState<GoalAdjustmentType>('kcal');
  const [goalAdjustmentInput, setGoalAdjustmentInput] = useState('500');
  const [goalPercentInput, setGoalPercentInput] = useState('1');
  const [metabolismAgeInput, setMetabolismAgeInput] = useState('');
  const [metabolismHeightInput, setMetabolismHeightInput] = useState('');
  const [selectedHeightCm, setSelectedHeightCm] = useState<number | null>(null);
  const [manualWeightInput, setManualWeightInput] = useState('');
  const [proteinGoalInput, setProteinGoalInput] = useState('');
  const [fatGoalInput, setFatGoalInput] = useState('');
  const [carbsGoalInput, setCarbsGoalInput] = useState('');
  const [heightUnit, setHeightUnit] = useState<HeightUnit>('cm');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const [heightPickerOpen, setHeightPickerOpen] = useState(false);
  const [goalAdjustmentPickerVisible, setGoalAdjustmentPickerVisible] = useState(false);
  const [sexMenuVisible, setSexMenuVisible] = useState(false);
  const [activityMenuVisible, setActivityMenuVisible] = useState(false);
  const [weightUnlocked, setWeightUnlocked] = useState(false);
  const [goalsTab, setGoalsTab] = useState<'profile' | 'overrides'>('profile');
  const heightListRef = useRef<ScrollView | null>(null);
  const isUserScrollingRef = useRef(false);
  const lastScrollIndexRef = useRef(-1);
  const suppressEffectScrollRef = useRef(false);
  const isUnitSwitchingRef = useRef(false);
  const pendingUnitTargetIndexRef = useRef<number | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored) {
          const parsed = JSON.parse(stored) as StoredData;
          const next = { ...DEFAULT_DATA, ...parsed, entries: parsed.entries ?? [], weightHistory: parsed.weightHistory ?? [], bodyFatHistory: parsed.bodyFatHistory ?? [] };
          setData(next);
          setBaseTargetInput(`${next.baseTarget}`);
          setCaloriesPerKgInput(`${next.caloriesPerKg}`);
          setGoalAdjustmentTypeInput(next.cutAdjustmentType ?? 'kcal');
          setGoalAdjustmentInput(`${next.cutCalorieAdjustment ?? 500}`);
          setGoalPercentInput(`${next.cutPercentPerWeek ?? 1}`);
          setMetabolismAgeInput(next.metabolismAgeYears ? `${next.metabolismAgeYears}` : '');
          setSelectedHeightCm(next.metabolismHeightCm ?? null);
          setMetabolismHeightInput(next.metabolismHeightCm ? formatHeightForUnit(next.metabolismHeightCm, heightUnit) : '');
          setManualWeightInput(next.manualWeightKg ? formatWeightForUnit(next.manualWeightKg, weightUnit) : '');
          setProteinGoalInput(next.proteinGoalGrams ? `${next.proteinGoalGrams}` : '');
          setFatGoalInput(next.fatGoalGrams ? `${next.fatGoalGrams}` : '');
          setCarbsGoalInput(next.carbsGoalGrams ? `${next.carbsGoalGrams}` : '');
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

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem(STORAGE_KEY)
        .then((stored) => {
          const base = stored ? (JSON.parse(stored) as StoredData) : null;
          const next: StoredData = base
            ? { ...DEFAULT_DATA, ...base, entries: base.entries ?? [], weightHistory: base.weightHistory ?? [], bodyFatHistory: base.bodyFatHistory ?? [] }
            : DEFAULT_DATA;
          setData(next);
          setManualWeightInput(next.manualWeightKg ? formatWeightForUnit(next.manualWeightKg, weightUnit) : '');
          setSelectedHeightCm(next.metabolismHeightCm ?? null);
        })
        .catch(() => {});
    }, [weightUnit]),
  );

  useEffect(() => {
    setMetabolismHeightInput(
      selectedHeightCm !== null ? formatHeightForUnit(selectedHeightCm, heightUnit) : '',
    );
  }, [selectedHeightCm, heightUnit]);

  const onWeightUnitChange = (nextValue: string) => {
    const nextUnit = nextValue as WeightUnit;
    if (nextUnit === weightUnit) return;
    const parsed = parseNumberInput(manualWeightInput);
    if (parsed !== null) {
      const inKg = weightUnit === 'kg' ? parsed : parsed * KG_PER_LB;
      setManualWeightInput(formatWeightForUnit(inKg, nextUnit));
    }
    setWeightUnit(nextUnit);
  };

  const onHeightUnitChange = (nextValue: string) => {
    const nextUnit = nextValue as HeightUnit;
    if (nextUnit === heightUnit) return;
    if (selectedHeightCm === null) {
      setHeightUnit(nextUnit);
      return;
    }
    
    suppressEffectScrollRef.current = true;
    isUnitSwitchingRef.current = true;
    
    // Build the new items list for the target unit
    let newItems: HeightPickerItem[];
    if (nextUnit === 'cm') {
      newItems = Array.from({ length: HEIGHT_MAX_CM - HEIGHT_MIN_CM + 1 }, (_, index) => {
        const cm = HEIGHT_MIN_CM + index;
        return { key: `cm-${cm}`, cm, label: `${cm} cm` };
      });
    } else {
      newItems = Array.from({ length: HEIGHT_MAX_IN - HEIGHT_MIN_IN + 1 }, (_, index) => {
        const inches = HEIGHT_MIN_IN + index;
        const cm = inches * CM_PER_IN;
        return { key: `in-${inches}`, cm, label: formatFeetInches(inches) };
      });
    }
    
    // Find nearest item in new list matching current height
    let targetIndex = 0;
    let nearestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < newItems.length; i += 1) {
      const delta = Math.abs(newItems[i].cm - selectedHeightCm);
      if (delta < nearestDelta) {
        nearestDelta = delta;
        targetIndex = i;
      }
    }
    const targetItem = newItems[targetIndex];
    
    // Now update the unit
    setHeightUnit(nextUnit);
    if (targetItem) {
      setSelectedHeightCm(targetItem.cm);
    }
    pendingUnitTargetIndexRef.current = targetIndex;

    if (!heightPickerOpen) {
      suppressEffectScrollRef.current = false;
      isUnitSwitchingRef.current = false;
      pendingUnitTargetIndexRef.current = null;
    }
  };

  useEffect(() => {
    const pending = pendingUnitTargetIndexRef.current;
    if (!heightPickerOpen || pending === null) return;

    const timer = setTimeout(() => {
      heightListRef.current?.scrollTo({ y: pending * HEIGHT_ROW_HEIGHT, animated: false });
      lastScrollIndexRef.current = pending;
      pendingUnitTargetIndexRef.current = null;
      setTimeout(() => {
        suppressEffectScrollRef.current = false;
        isUnitSwitchingRef.current = false;
      }, 180);
    }, 60);

    return () => clearTimeout(timer);
  }, [heightUnit, heightPickerOpen]);

  const onGoalPhasePress = (phase: GoalPhase) => {
    setData((prev) => ({ ...prev, goalPhase: phase }));
  };

  const onGoalPhaseLongPress = (phase: EditableGoalPhase) => {
    Vibration.vibrate(12);
    setData((prev) => ({ ...prev, goalPhase: phase }));
    setGoalAdjustmentEditorPhase(phase);

    const phaseType = phase === 'cut' ? (data.cutAdjustmentType ?? 'kcal') : (data.bulkAdjustmentType ?? 'kcal');
    const phaseKcal = phase === 'cut' ? (data.cutCalorieAdjustment ?? 500) : (data.bulkCalorieAdjustment ?? 500);
    const phasePercent = phase === 'cut' ? (data.cutPercentPerWeek ?? 1) : (data.bulkPercentPerWeek ?? 1);

    setGoalAdjustmentTypeInput(phaseType);
    setGoalAdjustmentInput(`${Math.round(phaseKcal)}`);
    setGoalPercentInput(`${roundTo(phasePercent, 2)}`);

    if (phaseType === 'percent') {
      const currentPercent = parseNumberInput(`${phasePercent}`);
      if (!currentPercent || currentPercent < 0.1 || currentPercent > 3) {
        setGoalPercentInput('1');
      }
    } else {
      const current = parseNumberInput(`${phaseKcal}`);
      if (!current || current < 50 || current > 1500) {
        setGoalAdjustmentInput('500');
      }
    }
    setGoalAdjustmentPickerVisible(true);
  };

  const onPressHeightField = () => {
    if (!heightPickerOpen && selectedHeightCm === null) {
      setSelectedHeightCm(DEFAULT_HEIGHT_CM);
      setMetabolismHeightInput(formatHeightForUnit(DEFAULT_HEIGHT_CM, heightUnit));
    }
    setHeightPickerOpen((v) => !v);
  };

  const heightPickerItems = useMemo<HeightPickerItem[]>(() => {
    if (heightUnit === 'cm') {
      return Array.from({ length: HEIGHT_MAX_CM - HEIGHT_MIN_CM + 1 }, (_, index) => {
        const cm = HEIGHT_MIN_CM + index;
        return {
          key: `cm-${cm}`,
          cm,
          label: `${cm} cm`,
        };
      });
    }

    return Array.from({ length: HEIGHT_MAX_IN - HEIGHT_MIN_IN + 1 }, (_, index) => {
      const inches = HEIGHT_MIN_IN + index;
      const cm = inches * CM_PER_IN;
      return {
        key: `in-${inches}`,
        cm,
        label: formatFeetInches(inches),
      };
    });
  }, [heightUnit]);

  useEffect(() => {
    if (suppressEffectScrollRef.current || !heightPickerOpen || selectedHeightCm === null) return;
    let index = 0;
    let nearestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < heightPickerItems.length; i += 1) {
      const delta = Math.abs(heightPickerItems[i].cm - selectedHeightCm);
      if (delta < nearestDelta) {
        nearestDelta = delta;
        index = i;
      }
    }
    const timer = setTimeout(() => {
      heightListRef.current?.scrollTo({ y: index * HEIGHT_ROW_HEIGHT, animated: false });
    }, 50);
    return () => clearTimeout(timer);
  }, [heightPickerItems, heightPickerOpen, selectedHeightCm]);

  const onHeightScroll = useCallback((offsetY: number) => {
    if (isUnitSwitchingRef.current) return;
    const index = Math.round(offsetY / HEIGHT_ROW_HEIGHT);
    const clamped = Math.max(0, Math.min(index, heightPickerItems.length - 1));
    if (clamped !== lastScrollIndexRef.current) {
      lastScrollIndexRef.current = clamped;
      Vibration.vibrate(6);
    }
  }, [heightPickerItems.length]);

  const onHeightScrollEnd = useCallback((offsetY: number) => {
    if (isUnitSwitchingRef.current) return;
    const index = Math.round(offsetY / HEIGHT_ROW_HEIGHT);
    const clamped = Math.max(0, Math.min(index, heightPickerItems.length - 1));
    const item = heightPickerItems[clamped];
    if (!item) return;
    setSelectedHeightCm(item.cm);
    setMetabolismHeightInput(formatHeightForUnit(item.cm, heightUnit));
  }, [heightPickerItems, heightUnit]);



  const saveTargets = () => {
    const nextBase = parseNumberInput(baseTargetInput);
    const nextPerKg = parseNumberInput(caloriesPerKgInput);
    const nextWeightInput = manualWeightInput.trim() ? parseNumberInput(manualWeightInput) : null;
    const nextWeightKg = nextWeightInput !== null
      ? (weightUnit === 'kg' ? nextWeightInput : nextWeightInput * KG_PER_LB)
      : null;
    const nextAge = metabolismAgeInput.trim() ? parseNumberInput(metabolismAgeInput) : null;
    const nextHeightCm = selectedHeightCm;
    const nextProtein = proteinGoalInput.trim() ? parseNumberInput(proteinGoalInput) : null;
    const nextFat = fatGoalInput.trim() ? parseNumberInput(fatGoalInput) : null;
    const nextCarbs = carbsGoalInput.trim() ? parseNumberInput(carbsGoalInput) : null;

    if (!nextBase || nextBase <= 0) { Alert.alert('Invalid goal', 'Enter a valid override calorie target.'); return; }
    if (!nextPerKg || nextPerKg <= 0) { Alert.alert('Invalid multiplier', 'Enter calories per kg as a positive number.'); return; }
    if (nextAge !== null && (nextAge < 13 || nextAge > 120)) { Alert.alert('Invalid age', 'Enter an age between 13 and 120.'); return; }
    if (nextHeightCm !== null && (nextHeightCm < 92 || nextHeightCm > 214)) {
      Alert.alert('Invalid height', 'Enter a height between 92 cm (3\') and 214 cm (7\').');
      return;
    }
    if (nextProtein !== null && nextProtein < 0) { Alert.alert('Invalid protein goal', 'Protein must be 0 or more.'); return; }
    if (nextFat !== null && nextFat < 0) { Alert.alert('Invalid fat goal', 'Fat must be 0 or more.'); return; }
    if (nextCarbs !== null && nextCarbs < 0) { Alert.alert('Invalid carbs goal', 'Carbs must be 0 or more.'); return; }

    setData((prev) => {
      let nextWeightHistory = prev.weightHistory;
      if (nextWeightKg && nextWeightKg > 0) {
        nextWeightHistory = mergeWeightHistory(prev.weightHistory, [{
          recordedAt: new Date().toISOString(),
          weightKg: roundTo(nextWeightKg, 2),
          source: 'manual',
        }]);
      }
      return {
        ...prev,
        baseTarget: Math.round(nextBase),
        caloriesPerKg: roundTo(nextPerKg, 1),
        metabolismAgeYears: nextAge !== null ? Math.round(nextAge) : null,
        metabolismHeightCm: nextHeightCm !== null ? roundTo(nextHeightCm, 1) : null,
        manualWeightKg: nextWeightKg && nextWeightKg > 0 ? roundTo(nextWeightKg, 2) : null,
        weightHistory: nextWeightHistory,
        proteinGoalGrams: nextProtein !== null ? roundTo(nextProtein, 1) : null,
        fatGoalGrams: nextFat !== null ? roundTo(nextFat, 1) : null,
        carbsGoalGrams: nextCarbs !== null ? roundTo(nextCarbs, 1) : null,
      };
    });

    setManualWeightInput(nextWeightKg && nextWeightKg > 0 ? formatWeightForUnit(roundTo(nextWeightKg, 2), weightUnit) : '');
    setMetabolismHeightInput(nextHeightCm !== null ? formatHeightForUnit(roundTo(nextHeightCm, 1), heightUnit) : '');
    Vibration.vibrate(18);
  };

  const resetOverrides = () => {
    setBaseTargetInput(`${DEFAULT_DATA.baseTarget}`);
    setCaloriesPerKgInput(`${DEFAULT_DATA.caloriesPerKg}`);
    setProteinGoalInput('');
    setFatGoalInput('');
    setCarbsGoalInput('');
    setData((prev) => ({
      ...prev,
      baseTarget: DEFAULT_DATA.baseTarget,
      caloriesPerKg: DEFAULT_DATA.caloriesPerKg,
      proteinGoalGrams: null,
      fatGoalGrams: null,
      carbsGoalGrams: null,
    }));
  };

  const clearManualWeight = () => {
    setManualWeightInput('');
    setData((prev) => ({
      ...prev,
      manualWeightKg: null,
      weightHistory: prev.weightHistory.filter((point) => point.source !== 'manual'),
    }));
  };

  const hasSavedManualWeight = data.manualWeightKg !== null
    || data.weightHistory.some((point) => point.source === 'manual');

  const latestHealthConnectWeightPoint = data.weightHistory.find((point) => point.source === 'health-connect') ?? null;
  const latestWeight = data.manualWeightKg ?? latestHealthConnectWeightPoint?.weightKg ?? null;
  const metabolism = estimateMetabolism({
    weightKg: latestWeight,
    heightCm: data.metabolismHeightCm,
    ageYears: data.metabolismAgeYears,
    sex: data.metabolismSex,
    activityLevel: data.activityLevel,
  });
  const goalDelta = getGoalCalorieDelta(data.goalPhase, {
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
  const goalModeLabel = data.goalPhase === 'cut' ? 'Cut' : data.goalPhase === 'bulk' ? 'Bulk' : 'Maintain';
  const goalModeCalories = metabolism.maintenanceCalories !== null
    ? Math.round(metabolism.maintenanceCalories + goalDelta)
    : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.card} mode="elevated">
          <Card.Title title="Daily Goals & Metabolism" titleVariant="titleLarge" />
          <Card.Content style={styles.formArea}>
            <SegmentedButtons
              value={goalsTab}
              onValueChange={(value) => setGoalsTab(value as 'profile' | 'overrides')}
              buttons={[
                { value: 'profile', label: 'Profile', icon: 'account' },
                { value: 'overrides', label: 'Overrides', icon: 'tune' },
              ]}
              style={{ marginBottom: 8 }}
            />

            {goalsTab === 'profile' ? (
              <>
                <Text variant="bodyMedium" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}>
                  Complete your profile to calculate accurate metabolism metrics.
                </Text>

                <Text variant="labelMedium" style={{ marginTop: 4 }}>Your Profile</Text>
            <TextInput
              label="Age (years)"
              value={metabolismAgeInput}
              onChangeText={setMetabolismAgeInput}
              keyboardType="numeric"
              mode="outlined"
            />
            <Pressable onPress={onPressHeightField}>
              <View pointerEvents="none">
                <TextInput
                  label={`Height`}
                  value={metabolismHeightInput}
                  mode="outlined"
                  editable={false}
                  right={<TextInput.Icon icon={heightPickerOpen ? 'chevron-up' : 'chevron-down'} />}
                />
              </View>
            </Pressable>
            {heightPickerOpen && (
              <View style={{ gap: 8 }}>
                <SegmentedButtons
                  value={heightUnit}
                  onValueChange={onHeightUnitChange}
                  buttons={[
                    { value: 'cm', label: 'cm' },
                    { value: 'ft', label: 'ft' },
                  ]}
                />
                <View style={styles.heightPickerWrapper}>
                  <View style={[styles.heightPickerSelector, { borderColor: theme.colors.primary }]} pointerEvents="none" />
                  <ScrollView
                    ref={heightListRef}
                    style={styles.heightPickerList}
                    showsVerticalScrollIndicator={false}
                    nestedScrollEnabled
                    decelerationRate={0.9}
                    contentContainerStyle={styles.heightPickerContent}
                    scrollEventThrottle={16}
                    onScrollBeginDrag={() => { isUserScrollingRef.current = true; lastScrollIndexRef.current = -1; }}
                    onScroll={(e) => onHeightScroll(e.nativeEvent.contentOffset.y)}
                    onMomentumScrollEnd={(e) => {
                      if (isUnitSwitchingRef.current) return;
                      const snapY = Math.round(e.nativeEvent.contentOffset.y / HEIGHT_ROW_HEIGHT) * HEIGHT_ROW_HEIGHT;
                      heightListRef.current?.scrollTo({ y: snapY, animated: true });
                      onHeightScrollEnd(snapY);
                    }}
                    onScrollEndDrag={() => { isUserScrollingRef.current = false; }}
                  >
                    {heightPickerItems.map((item) => {
                      const isSelected = selectedHeightCm !== null && Math.abs(selectedHeightCm - item.cm) < 0.51;
                      return (
                        <HeightPickerOption
                          key={item.key}
                          label={item.label}
                          isSelected={isSelected}
                        />
                      );
                    })}
                  </ScrollView>
                </View>
              </View>
            )}

            <Text variant="bodySmall" style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>Sex</Text>
            <Menu
              visible={sexMenuVisible}
              onDismiss={() => setSexMenuVisible(false)}
              anchor={(
                <Button
                  mode="outlined"
                  onPress={() => setSexMenuVisible(true)}
                  style={{ marginBottom: 6 }}
                  icon={data.metabolismSex === 'male' ? 'gender-male' : 'gender-female'}
                >
                  {data.metabolismSex === 'male' ? 'Male' : 'Female'}
                </Button>
              )}
            >
              <Menu.Item
                onPress={() => {
                  setData((prev) => ({ ...prev, metabolismSex: 'male' }));
                  setSexMenuVisible(false);
                }}
                title="Male"
                leadingIcon="gender-male"
              />
              <Menu.Item
                onPress={() => {
                  setData((prev) => ({ ...prev, metabolismSex: 'female' }));
                  setSexMenuVisible(false);
                }}
                title="Female"
                leadingIcon="gender-female"
              />
            </Menu>

            <Text variant="bodySmall" style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>Activity Level</Text>
            <Menu
              visible={activityMenuVisible}
              onDismiss={() => setActivityMenuVisible(false)}
              anchor={(
                <Button
                  mode="outlined"
                  onPress={() => setActivityMenuVisible(true)}
                  style={{ marginBottom: 6 }}
                  icon={getActivityIcon(data.activityLevel)}
                >
                  {getActivityLabel(data.activityLevel)}
                </Button>
              )}
            >
              <Menu.Item
                onPress={() => {
                  setData((prev) => ({ ...prev, activityLevel: 'sedentary' }));
                  setActivityMenuVisible(false);
                }}
                title="Sedentary"
                leadingIcon="sofa"
              />
              <Menu.Item
                onPress={() => {
                  setData((prev) => ({ ...prev, activityLevel: 'light' }));
                  setActivityMenuVisible(false);
                }}
                title="Light"
                leadingIcon="walk"
              />
              <Menu.Item
                onPress={() => {
                  setData((prev) => ({ ...prev, activityLevel: 'moderate' }));
                  setActivityMenuVisible(false);
                }}
                title="Moderate"
                leadingIcon="run"
              />
              <Menu.Item
                onPress={() => {
                  setData((prev) => ({ ...prev, activityLevel: 'heavy' }));
                  setActivityMenuVisible(false);
                }}
                title="Heavy"
                leadingIcon="dumbbell"
              />
              <Menu.Item
                onPress={() => {
                  setData((prev) => ({ ...prev, activityLevel: 'athlete' }));
                  setActivityMenuVisible(false);
                }}
                title="Athlete"
                leadingIcon="arm-flex"
              />
            </Menu>

            <View style={styles.goalModeLabelRow}>
              <Text variant="bodySmall" style={{ marginTop: 6, color: theme.colors.onSurfaceVariant }}>Goal Mode</Text>
              <MaterialCommunityIcons name="hand-okay" size={14} color={theme.colors.onSurfaceVariant} style={{ marginTop: 6 }} />
            </View>

            <View style={styles.goalModeRow}>
              <View style={styles.goalModeButtonWrap}>
                <Button
                  mode={data.goalPhase === 'cut' ? 'contained' : 'outlined'}
                  icon="trending-down"
                  onPress={() => onGoalPhasePress('cut')}
                  onLongPress={() => onGoalPhaseLongPress('cut')}
                  compact
                  style={styles.goalModeButton}
                >
                  Cut
                </Button>
                <MaterialCommunityIcons name="tune" size={18} color={data.goalPhase === 'cut' ? theme.colors.onPrimary : theme.colors.primary} style={styles.goalModeConfigIcon} />
              </View>
              <Button
                mode={data.goalPhase === 'maintain' ? 'contained' : 'outlined'}
                icon="target"
                onPress={() => onGoalPhasePress('maintain')}
                compact
                style={styles.goalModeButton}
              >
                Maintain
              </Button>
              <View style={styles.goalModeButtonWrap}>
                <Button
                  mode={data.goalPhase === 'bulk' ? 'contained' : 'outlined'}
                  icon="trending-up"
                  onPress={() => onGoalPhasePress('bulk')}
                  onLongPress={() => onGoalPhaseLongPress('bulk')}
                  compact
                  style={styles.goalModeButton}
                >
                  Bulk
                </Button>
                <MaterialCommunityIcons name="tune" size={18} color={data.goalPhase === 'bulk' ? theme.colors.onPrimary : theme.colors.primary} style={styles.goalModeConfigIcon} />
              </View>
            </View>

            <Text variant="labelMedium" style={{ marginTop: 6 }}>Weight Tracking</Text>
            <TextInput
              label={`Manual weight (${weightUnit})`}
              value={manualWeightInput}
              onChangeText={setManualWeightInput}
              keyboardType="numeric"
              placeholder={weightUnit === 'kg' ? '78.45' : '173.00'}
              mode="outlined"
              editable={weightUnlocked}
              right={<TextInput.Icon icon={weightUnlocked ? 'lock-open-variant' : 'lock'} onPress={() => setWeightUnlocked(!weightUnlocked)} />}
            />
            <SegmentedButtons
              value={weightUnit}
              onValueChange={onWeightUnitChange}
              buttons={[
                { value: 'kg', label: 'kg' },
                { value: 'lb', label: 'lb' },
              ]}
            />
            <Button
              mode="text"
              icon="delete-outline"
              onPress={clearManualWeight}
              textColor={theme.colors.error}
              rippleColor={theme.colors.errorContainer}
              disabled={!hasSavedManualWeight}
              style={{ alignSelf: 'flex-start' }}
            >
              Clear manual weight
            </Button>

            <Button mode="contained" icon="content-save-outline" onPress={saveTargets} style={{ marginTop: 8 }}>
              Save
            </Button>

            <Text variant="labelMedium" style={{ marginTop: 6 }}>Estimated Metabolism</Text>
            <Card style={{ backgroundColor: theme.colors.surfaceVariant, marginHorizontal: 0, marginVertical: 6 }}>
              <Card.Content style={{ gap: 6 }}>
                <Text variant="bodyMedium">
                  <Text style={{ fontWeight: '700' }}>BMR:</Text> {metabolism.bmr ? `${metabolism.bmr} kcal/day` : 'Need weight, height, age, and sex'}
                </Text>
                <Text variant="bodyMedium">
                  <Text style={{ fontWeight: '700' }}>TDEE:</Text> {metabolism.tdee ? `${metabolism.tdee} kcal/day` : 'Not available yet'} (activity factor ×{getActivityFactor(data.activityLevel)})
                </Text>
                <Text variant="bodyMedium">
                  <Text style={{ fontWeight: '700' }}>Maintenance:</Text> {metabolism.maintenanceCalories ? `${metabolism.maintenanceCalories} kcal/day` : 'Not available yet'}
                </Text>
                {data.goalPhase !== 'maintain' ? (
                  <Text variant="bodyMedium">
                    <Text style={{ fontWeight: '700' }}>{goalModeLabel} Target:</Text> {goalModeCalories !== null ? `${goalModeCalories} kcal/day` : 'Not available yet'}
                  </Text>
                ) : null}
              </Card.Content>
            </Card>
              </>
            ) : (
              <>
                <Text variant="bodySmall" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}>
                  Use overrides if profile-based metabolism is incomplete or if you want custom macro targets.
                </Text>
            <TextInput
              label="Override calorie target"
              value={baseTargetInput}
              onChangeText={setBaseTargetInput}
              keyboardType="numeric"
              mode="outlined"
            />
            <TextInput
              label="Calories per kg"
              value={caloriesPerKgInput}
              onChangeText={setCaloriesPerKgInput}
              keyboardType="numeric"
              mode="outlined"
            />

            <Text variant="labelMedium" style={{ marginTop: 6 }}>Macro Overrides</Text>
            <Text variant="bodySmall" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}>
              Leave blank to use automatic macro targets from calories.
            </Text>
            <View style={styles.macroGrid}>
              <TextInput
                label="Protein (g)"
                value={proteinGoalInput}
                onChangeText={setProteinGoalInput}
                placeholder="e.g. 150"
                keyboardType="numeric"
                mode="outlined"
                style={styles.macroInput}
              />
              <TextInput
                label="Carbs (g)"
                value={carbsGoalInput}
                onChangeText={setCarbsGoalInput}
                placeholder="e.g. 200"
                keyboardType="numeric"
                mode="outlined"
                style={styles.macroInput}
              />
              <TextInput
                label="Fat (g)"
                value={fatGoalInput}
                onChangeText={setFatGoalInput}
                placeholder="e.g. 65"
                keyboardType="numeric"
                mode="outlined"
                style={styles.macroInput}
              />
            </View>

            <Button mode="contained" icon="content-save-outline" onPress={saveTargets} style={{ marginTop: 8 }}>
              Save
            </Button>
            <Button
              mode="outlined"
              icon="restore"
              onPress={resetOverrides}
              textColor={theme.colors.error}
              style={{ marginTop: 8, borderColor: theme.colors.error }}
            >
              Reset
            </Button>
              </>
            )}
          </Card.Content>
        </Card>
      </ScrollView>

      <Modal
        visible={goalAdjustmentPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGoalAdjustmentPickerVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setGoalAdjustmentPickerVisible(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>
              {goalAdjustmentEditorPhase === 'cut' ? 'Cut adjustment' : 'Bulk adjustment'}
            </Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Set how aggressive your cut/bulk should be.
            </Text>

            <SegmentedButtons
              value={goalAdjustmentTypeInput}
              onValueChange={(value) => {
                setGoalAdjustmentTypeInput(value as GoalAdjustmentType);
              }}
              buttons={[
                { value: 'kcal', label: 'kcal/day' },
                { value: 'percent', label: '%/week' },
              ]}
            />

            <View style={styles.goalAdjustChipRow}>
              {(goalAdjustmentTypeInput === 'percent' ? [0.25, 0.5, 0.75, 1] : [250, 500, 750, 1000]).map((value) => {
                const normalizedText = goalAdjustmentTypeInput === 'percent' ? String(value) : String(Math.round(value));
                const isSelected = goalAdjustmentTypeInput === 'percent'
                  ? Math.abs((parseNumberInput(goalPercentInput) ?? NaN) - value) < 0.001
                  : String(value) === goalAdjustmentInput.trim();
                return (
                  <Chip
                    key={`goal-adj-${normalizedText}`}
                    selected={isSelected}
                    showSelectedCheck={false}
                    onPress={() => {
                      if (goalAdjustmentTypeInput === 'percent') {
                        setGoalPercentInput(String(value));
                      } else {
                        setGoalAdjustmentInput(String(value));
                      }
                    }}
                    mode={isSelected ? 'flat' : 'outlined'}
                    style={isSelected
                      ? { backgroundColor: theme.colors.primary }
                      : { borderColor: theme.colors.outlineVariant }}
                    textStyle={isSelected
                      ? { color: theme.colors.onPrimary, fontWeight: '800' }
                      : { color: theme.colors.onSurfaceVariant, fontWeight: '600' }}
                  >
                    {goalAdjustmentTypeInput === 'percent' ? `${value}%` : value}
                  </Chip>
                );
              })}
            </View>

            <TextInput
              label={goalAdjustmentTypeInput === 'percent' ? 'Adjustment (% body weight/week)' : 'Adjustment (kcal/day)'}
              value={goalAdjustmentTypeInput === 'percent' ? goalPercentInput : goalAdjustmentInput}
              onChangeText={(value) => {
                if (goalAdjustmentTypeInput === 'percent') {
                  setGoalPercentInput(value);
                } else {
                  setGoalAdjustmentInput(value);
                }
              }}
              keyboardType="numeric"
              mode="outlined"
              placeholder={goalAdjustmentTypeInput === 'percent' ? '1.0' : '500'}
            />

            <Button
              mode="outlined"
              onPress={() => {
                const adjustmentType = goalAdjustmentTypeInput;
                const parsedKcal = parseNumberInput(goalAdjustmentInput);
                const parsedPercent = parseNumberInput(goalPercentInput);
                if (adjustmentType === 'kcal') {
                  if (!parsedKcal || parsedKcal < 50 || parsedKcal > 1500) {
                    Alert.alert('Invalid adjustment', 'Enter goal adjustment between 50 and 1500 kcal.');
                    return;
                  }
                  const normalizedKcal = Math.round(parsedKcal);
                  setGoalAdjustmentInput(String(normalizedKcal));
                  setData((prev) => (
                    goalAdjustmentEditorPhase === 'cut'
                      ? { ...prev, cutAdjustmentType: 'kcal', cutCalorieAdjustment: normalizedKcal }
                      : { ...prev, bulkAdjustmentType: 'kcal', bulkCalorieAdjustment: normalizedKcal }
                  ));
                } else {
                  if (!parsedPercent || parsedPercent < 0.1 || parsedPercent > 3) {
                    Alert.alert('Invalid percentage', 'Enter weekly change between 0.1% and 3.0%.');
                    return;
                  }
                  const normalizedPercent = roundTo(parsedPercent, 2);
                  setGoalPercentInput(String(normalizedPercent));
                  setData((prev) => (
                    goalAdjustmentEditorPhase === 'cut'
                      ? { ...prev, cutAdjustmentType: 'percent', cutPercentPerWeek: normalizedPercent }
                      : { ...prev, bulkAdjustmentType: 'percent', bulkPercentPerWeek: normalizedPercent }
                  ));
                }
                setGoalAdjustmentPickerVisible(false);
              }}
            >
              Done
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
  card: { borderRadius: 24 },
  formArea: { gap: 4 },
  supportingText: {},
  goalModeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  goalModeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  goalModeButtonWrap: {
    flex: 1,
    position: 'relative',
  },
  goalModeButton: {
    flex: 1,
  },
  goalModeConfigIcon: {
    position: 'absolute',
    bottom: 4,
    right: 4,
  },
  goalAdjustChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  macroGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  macroInput: { minWidth: '47%', flexGrow: 1 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    borderRadius: 20,
    padding: 14,
    gap: 10,
    maxHeight: '80%',
  },
  heightPickerList: {
    height: PICKER_HEIGHT,
  },
  heightPickerContent: {
    paddingVertical: PICKER_PADDING,
  },
  heightPickerWrapper: {
    position: 'relative',
    height: PICKER_HEIGHT,
  },
  heightPickerSelector: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: PICKER_PADDING,
    height: HEIGHT_ROW_HEIGHT,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    zIndex: 1,
    pointerEvents: 'none',
  },
  heightPickerRow: {
    height: HEIGHT_ROW_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heightPickerRowText: {
    fontSize: 16,
  },
  heightPickerRowTextSelected: {
    fontWeight: '700',
    fontSize: 18,
  },
});
