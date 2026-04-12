import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Menu, SegmentedButtons, Text, TextInput, useTheme } from 'react-native-paper';

import { DEFAULT_DATA, STORAGE_KEY } from '../storage';
import type { StoredData, WeightPoint } from '../storage';
import { estimateMetabolism, getActivityFactor } from '../metabolism';

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;
const DEFAULT_HEIGHT_CM = 175;
const HEIGHT_MIN_CM = 100;
const HEIGHT_MAX_CM = 250;
const HEIGHT_MIN_IN = Math.ceil(HEIGHT_MIN_CM / CM_PER_IN);
const HEIGHT_MAX_IN = Math.floor(HEIGHT_MAX_CM / CM_PER_IN);
const HEIGHT_ROW_HEIGHT = 44;

type WeightUnit = 'kg' | 'lb';
type HeightUnit = 'cm' | 'ft-in';
type HeightPickerItem = { key: string; cm: number; label: string };

type HeightPickerOptionProps = {
  label: string;
  cm: number;
  isSelected: boolean;
  onSelect: (cm: number) => void;
};

const HeightPickerOption = memo(function HeightPickerOption({
  label,
  cm,
  isSelected,
  onSelect,
}: HeightPickerOptionProps) {
  const handlePress = useCallback(() => {
    onSelect(cm);
  }, [cm, onSelect]);

  return (
    <Button
      mode={isSelected ? 'contained' : 'text'}
      onPress={handlePress}
      style={styles.heightPickerRow}
      contentStyle={styles.heightPickerRowContent}
    >
      {label}
    </Button>
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
  if (unit === 'cm') return `${roundTo(heightCm, 1)}`;
  const totalInches = Math.round(heightCm / CM_PER_IN);
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet} ft ${inches} in`;
}

function formatFeetInches(totalInches: number) {
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${feet} ft ${inches} in`;
}

export default function GoalsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [data, setData] = useState<StoredData>(DEFAULT_DATA);
  const [isReady, setIsReady] = useState(false);
  const [baseTargetInput, setBaseTargetInput] = useState(`${DEFAULT_DATA.baseTarget}`);
  const [caloriesPerKgInput, setCaloriesPerKgInput] = useState(`${DEFAULT_DATA.caloriesPerKg}`);
  const [metabolismAgeInput, setMetabolismAgeInput] = useState('');
  const [metabolismHeightInput, setMetabolismHeightInput] = useState('');
  const [selectedHeightCm, setSelectedHeightCm] = useState<number | null>(null);
  const [manualWeightInput, setManualWeightInput] = useState('');
  const [heightUnit, setHeightUnit] = useState<HeightUnit>('cm');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('kg');
  const [heightPickerVisible, setHeightPickerVisible] = useState(false);
  const [sexMenuVisible, setSexMenuVisible] = useState(false);
  const [activityMenuVisible, setActivityMenuVisible] = useState(false);
  const [fallbackUnlocked, setFallbackUnlocked] = useState(false);
  const [weightUnlocked, setWeightUnlocked] = useState(false);
  const [goalsTab, setGoalsTab] = useState<'profile' | 'fallback'>('profile');
  const heightListRef = useRef<FlatList<HeightPickerItem> | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored) {
          const parsed = JSON.parse(stored) as StoredData;
          const next = { ...DEFAULT_DATA, ...parsed, entries: parsed.entries ?? [], weightHistory: parsed.weightHistory ?? [] };
          setData(next);
          setBaseTargetInput(`${next.baseTarget}`);
          setCaloriesPerKgInput(`${next.caloriesPerKg}`);
          setMetabolismAgeInput(next.metabolismAgeYears ? `${next.metabolismAgeYears}` : '');
          setSelectedHeightCm(next.metabolismHeightCm ?? null);
          setMetabolismHeightInput(next.metabolismHeightCm ? formatHeightForUnit(next.metabolismHeightCm, heightUnit) : '');
          setManualWeightInput(next.manualWeightKg ? formatWeightForUnit(next.manualWeightKg, weightUnit) : '');
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
      setManualWeightInput(data.manualWeightKg ? formatWeightForUnit(data.manualWeightKg, weightUnit) : '');
      setSelectedHeightCm(data.metabolismHeightCm ?? null);
      setMetabolismHeightInput(data.metabolismHeightCm ? formatHeightForUnit(data.metabolismHeightCm, heightUnit) : '');
    }, [data.manualWeightKg, data.metabolismHeightCm, weightUnit, heightUnit]),
  );

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
    if (selectedHeightCm !== null) {
      setMetabolismHeightInput(formatHeightForUnit(selectedHeightCm, nextUnit));
    }
    setHeightUnit(nextUnit);
  };

  const openHeightPicker = () => {
    if (selectedHeightCm === null) {
      setSelectedHeightCm(DEFAULT_HEIGHT_CM);
      setMetabolismHeightInput(formatHeightForUnit(DEFAULT_HEIGHT_CM, heightUnit));
    }
    setHeightPickerVisible(true);
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
    if (!heightPickerVisible || selectedHeightCm === null) return;
    let index = 0;
    let nearestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < heightPickerItems.length; i += 1) {
      const delta = Math.abs(heightPickerItems[i].cm - selectedHeightCm);
      if (delta < nearestDelta) {
        nearestDelta = delta;
        index = i;
      }
    }
    requestAnimationFrame(() => {
      heightListRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
    });
  }, [heightPickerItems, heightPickerVisible, selectedHeightCm]);

  const onSelectHeightCm = useCallback((heightCm: number) => {
    setSelectedHeightCm(heightCm);
    setMetabolismHeightInput(formatHeightForUnit(heightCm, heightUnit));
    setHeightPickerVisible(false);
  }, [heightUnit]);

  const heightKeyExtractor = useCallback((item: HeightPickerItem) => item.key, []);

  const heightGetItemLayout = useCallback((_: ArrayLike<HeightPickerItem> | null | undefined, index: number) => ({
    length: HEIGHT_ROW_HEIGHT,
    offset: HEIGHT_ROW_HEIGHT * index,
    index,
  }), []);

  const renderHeightPickerItem = useCallback(({ item }: { item: HeightPickerItem }) => {
    const isSelected = selectedHeightCm !== null && Math.abs(selectedHeightCm - item.cm) < 0.51;
    return (
      <HeightPickerOption
        label={item.label}
        cm={item.cm}
        isSelected={isSelected}
        onSelect={onSelectHeightCm}
      />
    );
  }, [onSelectHeightCm, selectedHeightCm]);

  const saveTargets = () => {
    const nextBase = parseNumberInput(baseTargetInput);
    const nextPerKg = parseNumberInput(caloriesPerKgInput);
    const nextWeightInput = manualWeightInput.trim() ? parseNumberInput(manualWeightInput) : null;
    const nextWeightKg = nextWeightInput !== null
      ? (weightUnit === 'kg' ? nextWeightInput : nextWeightInput * KG_PER_LB)
      : null;
    const nextAge = metabolismAgeInput.trim() ? parseNumberInput(metabolismAgeInput) : null;
    const nextHeightCm = selectedHeightCm;

    if (!nextBase || nextBase <= 0) { Alert.alert('Invalid goal', 'Enter a valid fallback calorie target.'); return; }
    if (!nextPerKg || nextPerKg <= 0) { Alert.alert('Invalid multiplier', 'Enter calories per kg as a positive number.'); return; }
    if (nextAge !== null && (nextAge < 13 || nextAge > 120)) { Alert.alert('Invalid age', 'Enter an age between 13 and 120.'); return; }
    if (nextHeightCm !== null && (nextHeightCm < 100 || nextHeightCm > 250)) {
      Alert.alert('Invalid height', 'Enter a valid height for your selected unit.');
      return;
    }

    let nextWeightHistory = data.weightHistory;
    if (nextWeightKg && nextWeightKg > 0) {
      nextWeightHistory = mergeWeightHistory(data.weightHistory, [{
        recordedAt: new Date().toISOString(),
        weightKg: roundTo(nextWeightKg, 2),
        source: 'manual',
      }]);
    }

    setData((prev) => ({
      ...prev,
      baseTarget: Math.round(nextBase),
      caloriesPerKg: roundTo(nextPerKg, 1),
      metabolismAgeYears: nextAge !== null ? Math.round(nextAge) : null,
      metabolismHeightCm: nextHeightCm !== null ? roundTo(nextHeightCm, 1) : null,
      manualWeightKg: nextWeightKg && nextWeightKg > 0 ? roundTo(nextWeightKg, 2) : null,
      weightHistory: nextWeightHistory,
    }));

    setManualWeightInput(nextWeightKg && nextWeightKg > 0 ? formatWeightForUnit(roundTo(nextWeightKg, 2), weightUnit) : '');
    setMetabolismHeightInput(nextHeightCm !== null ? formatHeightForUnit(roundTo(nextHeightCm, 1), heightUnit) : '');
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

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.card} mode="elevated">
          <Card.Title title="Daily Goals & Metabolism" titleVariant="titleLarge" />
          <Card.Content style={styles.formArea}>
            <SegmentedButtons
              value={goalsTab}
              onValueChange={(value) => setGoalsTab(value as 'profile' | 'fallback')}
              buttons={[
                { value: 'profile', label: 'Profile', icon: 'account' },
                { value: 'fallback', label: 'Fallback', icon: 'shield-alert' },
              ]}
              style={{ marginBottom: 12 }}
            />

            {goalsTab === 'profile' ? (
              <>
                <Text variant="bodyMedium" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}>
                  Complete your profile to calculate accurate metabolism metrics.
                </Text>

                <Text variant="labelMedium" style={{ marginTop: 8 }}>Your Profile</Text>
            <TextInput
              label="Age (years)"
              value={metabolismAgeInput}
              onChangeText={setMetabolismAgeInput}
              keyboardType="numeric"
              mode="outlined"
            />
            <Pressable onPress={openHeightPicker}>
              <View pointerEvents="none">
                <TextInput
                  label={`Height (${heightUnit})`}
                  value={metabolismHeightInput}
                  mode="outlined"
                  editable={false}
                  placeholder={heightUnit === 'cm' ? 'Tap to pick' : 'Tap to pick'}
                  right={<TextInput.Icon icon="chevron-down" />}
                />
              </View>
            </Pressable>

            <Text variant="bodySmall" style={{ marginTop: 10, color: theme.colors.onSurfaceVariant }}>Sex</Text>
            <Menu
              visible={sexMenuVisible}
              onDismiss={() => setSexMenuVisible(false)}
              anchor={(
                <Button
                  mode="outlined"
                  onPress={() => setSexMenuVisible(true)}
                  style={{ marginBottom: 10 }}
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

            <Text variant="bodySmall" style={{ marginTop: 10, color: theme.colors.onSurfaceVariant }}>Activity Level</Text>
            <Menu
              visible={activityMenuVisible}
              onDismiss={() => setActivityMenuVisible(false)}
              anchor={(
                <Button
                  mode="outlined"
                  onPress={() => setActivityMenuVisible(true)}
                  style={{ marginBottom: 10 }}
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

            <Text variant="labelMedium" style={{ marginTop: 8 }}>Weight Tracking</Text>
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
              style={{ alignSelf: 'flex-start', marginTop: 2 }}
            >
              Clear manual weight
            </Button>

            <Button mode="contained" icon="content-save-outline" onPress={saveTargets} style={{ marginTop: 12 }}>
              Save all settings
            </Button>

            <Text variant="labelMedium" style={{ marginTop: 8 }}>Estimated Metabolism</Text>
            <Card style={{ backgroundColor: theme.colors.surfaceVariant, marginHorizontal: 0, marginVertical: 8 }}>
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
              </Card.Content>
            </Card>
              </>
            ) : (
              <>
                <Text variant="bodySmall" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}>
                  Only used if metabolism profile is incomplete.
                </Text>
            <TextInput
              label="Fallback calorie target"
              value={baseTargetInput}
              onChangeText={setBaseTargetInput}
              keyboardType="numeric"
              mode="outlined"
              editable={fallbackUnlocked}
              right={<TextInput.Icon icon={fallbackUnlocked ? 'lock-open-variant' : 'lock'} onPress={() => setFallbackUnlocked(!fallbackUnlocked)} />}
            />
            <TextInput
              label="Calories per kg"
              value={caloriesPerKgInput}
              onChangeText={setCaloriesPerKgInput}
              keyboardType="numeric"
              mode="outlined"
              editable={fallbackUnlocked}
              right={<TextInput.Icon icon={fallbackUnlocked ? 'lock-open-variant' : 'lock'} onPress={() => setFallbackUnlocked(!fallbackUnlocked)} />}
            />
              </>
            )}
          </Card.Content>
        </Card>
      </ScrollView>

      <Modal
        visible={heightPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setHeightPickerVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setHeightPickerVisible(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: theme.colors.surface }]} onPress={() => {}}>
            <Text variant="titleMedium" style={{ fontWeight: '700' }}>Select height</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              Scroll and tap your value.
            </Text>
            <SegmentedButtons
              value={heightUnit}
              onValueChange={onHeightUnitChange}
              buttons={[
                { value: 'cm', label: 'cm' },
                { value: 'ft-in', label: 'ft/in' },
              ]}
            />
            <FlatList
              ref={heightListRef}
              data={heightPickerItems}
              keyExtractor={heightKeyExtractor}
              style={styles.heightPickerList}
              showsVerticalScrollIndicator
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              updateCellsBatchingPeriod={16}
              windowSize={7}
              removeClippedSubviews
              getItemLayout={heightGetItemLayout}
              onScrollToIndexFailed={({ index }) => {
                heightListRef.current?.scrollToOffset({
                  offset: Math.max(0, index * HEIGHT_ROW_HEIGHT),
                  animated: false,
                });
              }}
              renderItem={renderHeightPickerItem}
            />
            <Button mode="outlined" onPress={() => setHeightPickerVisible(false)}>
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
  card: { borderRadius: 24 },
  formArea: { gap: 6 },
  supportingText: {},
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
    maxHeight: 320,
  },
  heightPickerRow: {
    justifyContent: 'center',
    height: HEIGHT_ROW_HEIGHT,
  },
  heightPickerRowContent: {
    height: HEIGHT_ROW_HEIGHT,
  },
});
