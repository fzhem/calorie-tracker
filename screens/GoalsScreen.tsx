import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Menu, SegmentedButtons, Text, TextInput, useTheme } from 'react-native-paper';

import { DEFAULT_DATA, STORAGE_KEY } from '../storage';
import type { StoredData, WeightPoint } from '../storage';
import { estimateMetabolism, getActivityFactor } from '../metabolism';

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

export default function GoalsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [data, setData] = useState<StoredData>(DEFAULT_DATA);
  const [isReady, setIsReady] = useState(false);
  const [baseTargetInput, setBaseTargetInput] = useState(`${DEFAULT_DATA.baseTarget}`);
  const [caloriesPerKgInput, setCaloriesPerKgInput] = useState(`${DEFAULT_DATA.caloriesPerKg}`);
  const [metabolismAgeInput, setMetabolismAgeInput] = useState('');
  const [metabolismHeightInput, setMetabolismHeightInput] = useState('');
  const [manualWeightInput, setManualWeightInput] = useState('');
  const [sexMenuVisible, setSexMenuVisible] = useState(false);
  const [activityMenuVisible, setActivityMenuVisible] = useState(false);
  const [fallbackUnlocked, setFallbackUnlocked] = useState(false);
  const [weightUnlocked, setWeightUnlocked] = useState(false);
  const [goalsTab, setGoalsTab] = useState<'profile' | 'fallback'>('profile');

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
          setMetabolismHeightInput(next.metabolismHeightCm ? `${next.metabolismHeightCm}` : '');
          setManualWeightInput(next.manualWeightKg ? `${next.manualWeightKg}` : '');
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
      setManualWeightInput(data.manualWeightKg ? `${data.manualWeightKg}` : '');
    }, [data.manualWeightKg]),
  );

  const saveTargets = () => {
    const nextBase = parseNumberInput(baseTargetInput);
    const nextPerKg = parseNumberInput(caloriesPerKgInput);
    const nextWeight = manualWeightInput.trim() ? parseNumberInput(manualWeightInput) : null;
    const nextAge = metabolismAgeInput.trim() ? parseNumberInput(metabolismAgeInput) : null;
    const nextHeight = metabolismHeightInput.trim() ? parseNumberInput(metabolismHeightInput) : null;

    if (!nextBase || nextBase <= 0) { Alert.alert('Invalid goal', 'Enter a valid fallback calorie target.'); return; }
    if (!nextPerKg || nextPerKg <= 0) { Alert.alert('Invalid multiplier', 'Enter calories per kg as a positive number.'); return; }
    if (nextAge !== null && (nextAge < 13 || nextAge > 120)) { Alert.alert('Invalid age', 'Enter an age between 13 and 120.'); return; }
    if (nextHeight !== null && (nextHeight < 100 || nextHeight > 250)) { Alert.alert('Invalid height', 'Enter height in cm between 100 and 250.'); return; }

    let nextWeightHistory = data.weightHistory;
    if (nextWeight && nextWeight > 0) {
      nextWeightHistory = mergeWeightHistory(data.weightHistory, [{
        recordedAt: new Date().toISOString(),
        weightKg: roundTo(nextWeight, 2),
        source: 'manual',
      }]);
    }

    setData((prev) => ({
      ...prev,
      baseTarget: Math.round(nextBase),
      caloriesPerKg: roundTo(nextPerKg, 1),
      metabolismAgeYears: nextAge !== null ? Math.round(nextAge) : null,
      metabolismHeightCm: nextHeight !== null ? roundTo(nextHeight, 1) : null,
      manualWeightKg: nextWeight && nextWeight > 0 ? roundTo(nextWeight, 2) : null,
      weightHistory: nextWeightHistory,
    }));

    setManualWeightInput(nextWeight && nextWeight > 0 ? `${roundTo(nextWeight, 2)}` : '');
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
            <TextInput
              label="Height (cm)"
              value={metabolismHeightInput}
              onChangeText={setMetabolismHeightInput}
              keyboardType="numeric"
              mode="outlined"
            />

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
              label="Manual weight (kg)"
              value={manualWeightInput}
              onChangeText={setManualWeightInput}
              keyboardType="numeric"
              placeholder="78.45"
              mode="outlined"
              editable={weightUnlocked}
              right={<TextInput.Icon icon={weightUnlocked ? 'lock-open-variant' : 'lock'} onPress={() => setWeightUnlocked(!weightUnlocked)} />}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 16, gap: 16 },
  card: { borderRadius: 24 },
  formArea: { gap: 6 },
  supportingText: {},
});
