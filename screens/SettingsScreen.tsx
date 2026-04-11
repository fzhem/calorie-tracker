import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import type { Permission } from 'react-native-health-connect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Chip, SegmentedButtons, Text, TextInput, useTheme } from 'react-native-paper';

import { DEFAULT_DATA, STORAGE_KEY } from '../storage';
import type { StoredData, WeightPoint } from '../storage';
import { useThemeMode, type ThemeMode } from '../themeMode';

type HealthConnectModule = typeof import('react-native-health-connect');
const healthConnect: HealthConnectModule | null =
  Platform.OS === 'android' ? require('react-native-health-connect') : null;

type HealthStatus = 'idle' | 'available' | 'syncing' | 'unavailable' | 'update-required' | 'error';

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

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
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Unknown Health Connect error.';
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { mode, setMode } = useThemeMode();
  const [data, setData] = useState<StoredData>(DEFAULT_DATA);
  const [isReady, setIsReady] = useState(false);
  const [baseTargetInput, setBaseTargetInput] = useState(`${DEFAULT_DATA.baseTarget}`);
  const [caloriesPerKgInput, setCaloriesPerKgInput] = useState(`${DEFAULT_DATA.caloriesPerKg}`);
  const [manualWeightInput, setManualWeightInput] = useState('');
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('idle');
  const [healthMessage, setHealthMessage] = useState('Health Connect weight sync is ready to configure.');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored) {
          const parsed = JSON.parse(stored) as StoredData;
          const next = { ...DEFAULT_DATA, ...parsed, entries: parsed.entries ?? [], weightHistory: parsed.weightHistory ?? [] };
          setData(next);
          setBaseTargetInput(`${next.baseTarget}`);
          setCaloriesPerKgInput(`${next.caloriesPerKg}`);
          setManualWeightInput(next.manualWeightKg ? `${next.manualWeightKg}` : '');
        }
      })
      .catch(() => Alert.alert('Storage error', 'Saved data could not be loaded.'))
      .finally(() => setIsReady(true));
  }, []);

  useEffect(() => {
    if (!healthConnect) {
      setHealthStatus('unavailable');
      setHealthMessage('Health Connect is only available on Android development builds.');
      return;
    }
    healthConnect.getSdkStatus().then((status) => {
      if (status === healthConnect.SdkAvailabilityStatus.SDK_AVAILABLE) {
        setHealthStatus('available');
        setHealthMessage('Health Connect is available. Tap Sync to pull your latest weight.');
      } else if (status === healthConnect.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
        setHealthStatus('update-required');
        setHealthMessage('Install or update Health Connect before syncing weight data.');
      } else {
        setHealthStatus('unavailable');
        setHealthMessage('Health Connect is not available on this device yet.');
      }
    }).catch(() => {
      setHealthStatus('error');
      setHealthMessage('Health Connect status could not be checked.');
    });
  }, []);

  useEffect(() => {
    if (!isReady) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data)).catch(() =>
      Alert.alert('Storage error', 'Changes could not be saved.'),
    );
  }, [data, isReady]);

  const saveTargets = () => {
    const nextBase = parseNumberInput(baseTargetInput);
    const nextPerKg = parseNumberInput(caloriesPerKgInput);
    const nextWeight = manualWeightInput.trim() ? parseNumberInput(manualWeightInput) : null;

    if (!nextBase || nextBase <= 0) { Alert.alert('Invalid goal', 'Enter a valid fallback calorie target.'); return; }
    if (!nextPerKg || nextPerKg <= 0) { Alert.alert('Invalid multiplier', 'Enter calories per kg as a positive number.'); return; }

    let nextWeightHistory = data.weightHistory;
    if (nextWeight && nextWeight > 0) {
      nextWeightHistory = mergeWeightHistory(data.weightHistory, [{
        recordedAt: new Date().toISOString(),
        weightKg: roundTo(nextWeight, 1),
        source: 'manual',
      }]);
    }

    setData((prev) => ({
      ...prev,
      baseTarget: Math.round(nextBase),
      caloriesPerKg: roundTo(nextPerKg, 1),
      manualWeightKg: nextWeight && nextWeight > 0 ? roundTo(nextWeight, 1) : null,
      weightHistory: nextWeightHistory,
    }));
  };

  const syncWeight = async () => {
    if (!healthConnect) { Alert.alert('Unavailable', 'Health Connect requires an Android development build.'); return; }
    setHealthStatus('syncing');
    setHealthMessage('Syncing weight data from Health Connect...');

    try {
      const status = await healthConnect.getSdkStatus();
      if (status !== healthConnect.SdkAvailabilityStatus.SDK_AVAILABLE) {
        const isUpdate = status === healthConnect.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED;
        setHealthStatus(isUpdate ? 'update-required' : 'unavailable');
        setHealthMessage(isUpdate ? 'Install or update Health Connect and try again.' : 'Health Connect is unavailable on this device.');
        return;
      }

      await healthConnect.initialize();
      const permissions: Permission[] = [{ accessType: 'read', recordType: 'Weight' }];
      const granted = await healthConnect.requestPermission(permissions);
      const hasWeightPermission = Array.isArray(granted)
        && granted.some((p) => p.accessType === 'read' && p.recordType === 'Weight');
      if (!hasWeightPermission) {
        setHealthStatus('error');
        setHealthMessage(
          'Weight permission is off. Open Health Connect settings and allow this app to read Weight records, then sync again.',
        );
        Alert.alert(
          'Weight Permission Needed',
          'This app needs Health Connect permission to read your weight data. In Health Connect, enable Weight under app permissions, then tap Sync weight again.',
          [{ text: 'OK' }],
        );
        return;
      }

      const endTime = new Date();
      const result = await healthConnect.readRecords('Weight', {
        timeRangeFilter: { operator: 'between', startTime: addDays(endTime, -30).toISOString(), endTime: endTime.toISOString() },
        ascendingOrder: false,
        pageSize: 100,
      });

      const synced: WeightPoint[] = result.records.map((r) => ({
        recordedAt: r.time,
        weightKg: roundTo(r.weight.inKilograms, 1),
        source: 'health-connect',
      }));

      setData((prev) => ({
        ...prev,
        weightHistory: mergeWeightHistory(prev.weightHistory.filter((p) => p.source !== 'health-connect'), synced),
        lastWeightSyncAt: new Date().toISOString(),
      }));

      setHealthStatus('available');
      setHealthMessage(synced.length ? `Synced ${synced.length} weight record${synced.length === 1 ? '' : 's'}.` : 'No recent weight records found in Health Connect.');
    } catch (error) {
      const reason = getErrorMessage(error);
      setHealthStatus('error');
      setHealthMessage(`Weight sync failed: ${reason}`);
      Alert.alert(
        'Sync Failed',
        `Could not sync weight data. ${reason}`,
      );
    }
  };

  const openHealthSettings = () => {
    if (!healthConnect) {
      Alert.alert('Unavailable', 'Health Connect requires an Android development build.');
      return;
    }
    if (typeof healthConnect.openHealthConnectSettings !== 'function') {
      Alert.alert('Unavailable', 'Health Connect settings cannot be opened on this device.');
      return;
    }

    try {
      healthConnect.openHealthConnectSettings();
    } catch (error) {
      Alert.alert('Could not open settings', getErrorMessage(error));
    }
  };

  const onPressSyncWeight = () => {
    if (healthStatus === 'unavailable' || healthStatus === 'update-required') {
      Alert.alert(
        'Health Connect Unavailable',
        healthStatus === 'update-required'
          ? 'Please install or update Health Connect first, then try syncing again.'
          : 'Health Connect is not available on this device yet.',
      );
      return;
    }
    void syncWeight();
  };

  const latestWeight = data.weightHistory[0]?.weightKg ?? data.manualWeightKg;

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.card} mode="elevated">
          <Card.Title title="Appearance" titleVariant="titleLarge" />
          <Card.Content style={styles.formArea}>
            <Text variant="bodyMedium" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}>
              Theme follows your system preference by default.
            </Text>
            <SegmentedButtons
              value={mode}
              onValueChange={(value) => setMode(value as ThemeMode)}
              buttons={[
                { value: 'system', label: 'System', icon: 'theme-light-dark' },
                { value: 'light', label: 'Light', icon: 'weather-sunny' },
                { value: 'dark', label: 'Dark', icon: 'weather-night' },
              ]}
            />
          </Card.Content>
        </Card>

        <Card style={styles.card} mode="elevated">
          <Card.Title title="Daily Goal" titleVariant="titleLarge" />
          <Card.Content style={styles.formArea}>
          <Text variant="bodyMedium" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}>
            If a weight is available the target becomes weight × calories per kg, otherwise the fallback goal is used.
          </Text>
          <TextInput
            label="Fallback calorie target"
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
          <TextInput
            label="Manual weight (kg)"
            value={manualWeightInput}
            onChangeText={setManualWeightInput}
            keyboardType="numeric"
            placeholder="78.4"
            mode="outlined"
          />
          <Button mode="contained" icon="content-save-outline" onPress={saveTargets}>
            Save settings
          </Button>
          <Text variant="bodyMedium" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}>
            Weight source: {data.weightHistory[0]?.source ?? (data.manualWeightKg ? 'manual' : 'none')}
          </Text>
          </Card.Content>
        </Card>

        <Card style={styles.card} mode="elevated">
          <Card.Title title="Health Connect" titleVariant="titleLarge" />
          <Card.Content style={styles.formArea}>
          <Text variant="bodyMedium" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}>{healthMessage}</Text>
          <Text variant="bodyMedium" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}>
            Latest weight: {latestWeight ? `${latestWeight} kg` : 'None yet'}
          </Text>
          <Text variant="bodyMedium" style={[styles.supportingText, { color: theme.colors.onSurfaceVariant }]}>
            Last sync: {data.lastWeightSyncAt ? formatDisplayDate(data.lastWeightSyncAt) : 'Never'}
          </Text>
          <Chip icon={healthStatus === 'available' ? 'check-circle' : 'information-outline'}>
            Status: {healthStatus}
          </Chip>
          <View style={styles.buttonRow}>
            <Button
              style={styles.button}
              mode="contained"
              icon="sync"
              loading={healthStatus === 'syncing'}
              disabled={healthStatus === 'syncing'}
              onPress={onPressSyncWeight}
            >
              {healthStatus === 'syncing' ? 'Syncing...' : 'Sync weight'}
            </Button>
            <Button style={styles.button} mode="outlined" icon="cog" onPress={openHealthSettings}>
              Open settings
            </Button>
          </View>
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
  formArea: { gap: 10 },
  supportingText: {},
  buttonRow: { flexDirection: 'row', gap: 10 },
  button: { flex: 1 },
});
