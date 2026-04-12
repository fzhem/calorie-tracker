import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Alert, Platform, ScrollView, StyleSheet, View } from 'react-native';
import type { Permission } from 'react-native-health-connect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Chip, SegmentedButtons, Text, useTheme } from 'react-native-paper';

import { DEFAULT_DATA, STORAGE_KEY } from '../storage';
import type { BodyFatPoint, MealEntry, StoredData, WeightPoint } from '../storage';
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

function addMinutes(date: Date, minutes: number) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

function roundTo(value: number, digits = 1) {
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

function mergeWeightHistory(existing: WeightPoint[], incoming: WeightPoint[]): WeightPoint[] {
  const keyed = new Map<string, WeightPoint>();
  for (const p of [...existing, ...incoming]) keyed.set(`${p.source}-${p.recordedAt}`, p);
  return Array.from(keyed.values()).sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
  );
}

function mergeBodyFatHistory(existing: BodyFatPoint[], incoming: BodyFatPoint[]): BodyFatPoint[] {
  const keyed = new Map<string, BodyFatPoint>();
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

function hasPermission(granted: unknown[], accessType: Permission['accessType'], recordType: string) {
  return Array.isArray(granted)
    && granted.some((permission) => {
      if (!permission || typeof permission !== 'object') return false;
      const candidate = permission as { accessType?: string; recordType?: string };
      return candidate.accessType === accessType && candidate.recordType === recordType;
    });
}

function getKnownOriginAppName(appId?: string) {
  if (!appId) return undefined;
  const normalized = appId.toLowerCase();
  if (normalized === 'android') return 'Android (on-device)';
  if (normalized.includes('shealth') || normalized.includes('samsung.health')) return 'Samsung Health';
  if (normalized.includes('google.android.apps.fitness')) return 'Google Fit';
  if (normalized.includes('healthmate')) return 'Withings Health Mate';
  if (normalized.includes('fitbit')) return 'Fitbit';
  if (normalized.includes('zepp') || normalized.includes('amazfit')) return 'Zepp';
  if (normalized.includes('garmin')) return 'Garmin';
  if (normalized.includes('healthconnect')) return 'Health Connect';
  return undefined;
}

function getDeviceTypeLabel(deviceType?: number) {
  if (typeof deviceType !== 'number') return undefined;
  const byType: Record<number, string> = {
    0: 'Unknown device type',
    2: 'Phone',
    3: 'Scale',
    4: 'Ring',
    5: 'Head-mounted device',
    6: 'Fitness band',
    7: 'Chest strap',
    8: 'Smart display',
  };
  return byType[deviceType];
}

function getStringValueAtPath(input: unknown, path: string[]) {
  let cursor: unknown = input;
  for (const segment of path) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    const next = (cursor as Record<string, unknown>)[segment];
    cursor = next;
  }
  return typeof cursor === 'string' && cursor.trim() ? cursor : undefined;
}

function getFirstStringAtPaths(input: unknown, paths: string[][]) {
  for (const path of paths) {
    const value = getStringValueAtPath(input, path);
    if (value) return value;
  }
  return undefined;
}

function getNumberValueAtPath(input: unknown, path: string[]) {
  let cursor: unknown = input;
  for (const segment of path) {
    if (!cursor || typeof cursor !== 'object') return undefined;
    const next = (cursor as Record<string, unknown>)[segment];
    cursor = next;
  }
  return typeof cursor === 'number' ? cursor : undefined;
}

function getFirstNumberAtPaths(input: unknown, paths: string[][]) {
  for (const path of paths) {
    const value = getNumberValueAtPath(input, path);
    if (typeof value === 'number') return value;
  }
  return undefined;
}

function extractHealthOrigin(record: unknown) {
  const originAppId = getFirstStringAtPaths(record, [
    ['metadata', 'dataOrigin', 'packageName'],
    ['metadata', 'dataOrigin', 'applicationId'],
    ['metadata', 'dataOrigin', 'id'],
    ['metadata', 'dataOrigin'],
    ['dataOrigin', 'packageName'],
    ['dataOrigin', 'applicationId'],
    ['dataOrigin', 'id'],
    ['dataOrigin'],
    ['metadata', 'clientPackageName'],
  ]);

  const deviceManufacturer = getFirstStringAtPaths(record, [
    ['metadata', 'device', 'manufacturer'],
    ['device', 'manufacturer'],
  ]);
  const deviceModel = getFirstStringAtPaths(record, [
    ['metadata', 'device', 'model'],
    ['device', 'model'],
  ]);
  const deviceType = getFirstStringAtPaths(record, [
    ['metadata', 'device', 'type'],
    ['device', 'type'],
  ]);
  const deviceTypeNumber = getFirstNumberAtPaths(record, [
    ['metadata', 'device', 'type'],
    ['device', 'type'],
  ]);
  const deviceTypeLabel = getDeviceTypeLabel(deviceTypeNumber);

  const deviceParts = [deviceManufacturer, deviceModel].filter((value) => !!value?.trim());
  const originDevice = deviceParts.join(' ').trim() || deviceType || deviceTypeLabel;

  return {
    originAppId,
    originAppName: getKnownOriginAppName(originAppId) ?? originAppId,
    originDevice,
  } as Pick<WeightPoint, 'originAppId' | 'originAppName' | 'originDevice'>;
}

function buildNutritionRecord(entry: MealEntry, healthModule: HealthConnectModule) {
  const startTime = new Date(entry.loggedAt);

  return {
    recordType: 'Nutrition' as const,
    startTime: startTime.toISOString(),
    endTime: addMinutes(startTime, 1).toISOString(),
    name: entry.title,
    mealType: healthModule.MealType.UNKNOWN,
    energy: { value: entry.calories, unit: 'kilocalories' as const },
    metadata: {
      clientRecordId: `meal-entry-${entry.id}`,
      clientRecordVersion: 1,
      recordingMethod: healthModule.RecordingMethod.RECORDING_METHOD_MANUAL_ENTRY,
    },
  };
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { mode, setMode } = useThemeMode();
  const [data, setData] = useState<StoredData>(DEFAULT_DATA);
  const [isReady, setIsReady] = useState(false);
  const [healthStatus, setHealthStatus] = useState<HealthStatus>('idle');
  const [healthMessage, setHealthMessage] = useState('Health Connect sync is ready to configure.');
  const [isSyncingWeight, setIsSyncingWeight] = useState(false);
  const [isSyncingCalories, setIsSyncingCalories] = useState(false);

  const loadStoredData = useCallback(async () => {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setData(DEFAULT_DATA);
      return DEFAULT_DATA;
    }

    const parsed = JSON.parse(stored) as StoredData;
    const next = {
      ...DEFAULT_DATA,
      ...parsed,
      entries: parsed.entries ?? [],
      weightHistory: parsed.weightHistory ?? [],
      bodyFatHistory: parsed.bodyFatHistory ?? [],
    };
    setData(next);
    return next;
  }, []);

  useEffect(() => {
    loadStoredData()
      .catch(() => Alert.alert('Storage error', 'Saved data could not be loaded.'))
      .finally(() => setIsReady(true));
  }, [loadStoredData]);

  useFocusEffect(
    useCallback(() => {
      loadStoredData().catch(() => {
        Alert.alert('Storage error', 'Saved data could not be loaded.');
      });
    }, [loadStoredData]),
  );

  useEffect(() => {
    if (!healthConnect) {
      setHealthStatus('unavailable');
      setHealthMessage('Health Connect is only available on Android development builds.');
      return;
    }
    healthConnect.getSdkStatus().then((status) => {
      if (status === healthConnect.SdkAvailabilityStatus.SDK_AVAILABLE) {
        setHealthStatus('available');
        setHealthMessage('Health Connect is available. Sync body data to import weight/body fat, or sync calories to export meal logs.');
      } else if (status === healthConnect.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
        setHealthStatus('update-required');
        setHealthMessage('Install or update Health Connect before syncing body or calorie data.');
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

  const unsyncedCalorieEntries = useMemo(
    () => data.entries.filter((entry) => !entry.healthConnectSyncAt),
    [data.entries],
  );

  const ensureHealthConnectAvailable = async () => {
    if (!healthConnect) {
      Alert.alert('Unavailable', 'Health Connect requires an Android development build.');
      return false;
    }

    const status = await healthConnect.getSdkStatus();
    if (status !== healthConnect.SdkAvailabilityStatus.SDK_AVAILABLE) {
      const isUpdate = status === healthConnect.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED;
      setHealthStatus(isUpdate ? 'update-required' : 'unavailable');
      setHealthMessage(isUpdate ? 'Install or update Health Connect and try again.' : 'Health Connect is unavailable on this device.');
      return false;
    }

    await healthConnect.initialize();
    setHealthStatus('available');
    return true;
  };

  const syncWeight = async () => {
    if (!healthConnect) { Alert.alert('Unavailable', 'Health Connect requires an Android development build.'); return; }
    setIsSyncingWeight(true);
    setHealthMessage('Syncing weight and body fat data from Health Connect...');

    try {
      const available = await ensureHealthConnectAvailable();
      if (!available) return;

      const permissions = [
        { accessType: 'read' as const, recordType: 'Weight' as const },
        { accessType: 'read' as const, recordType: 'BodyFat' as const },
        { accessType: 'read' as const, recordType: 'ReadHealthDataHistory' as const },
      ];
      const granted = await healthConnect.requestPermission(permissions);
      const hasWeightPermission = hasPermission(granted, 'read', 'Weight');
      const hasBodyFatPermission = hasPermission(granted, 'read', 'BodyFat');
      const hasHistoryPermission = hasPermission(granted, 'read', 'ReadHealthDataHistory');
      if (!hasWeightPermission && !hasBodyFatPermission) {
        setHealthStatus('error');
        setHealthMessage(
          'Weight/Body Fat permissions are off. Open Health Connect settings and allow this app to read Weight or Body Fat records, then sync again.',
        );
        Alert.alert(
          'Body Data Permission Needed',
          'This app needs Health Connect permission to read Weight and Body Fat data. In Health Connect, enable Weight and Body Fat under app permissions, then tap Sync body data again.',
          [{ text: 'OK' }],
        );
        return;
      }

      const endTime = new Date();
      const startTime = addDays(endTime, -400).toISOString();
      const allRecords: Array<{ time: string; weight: { inKilograms: number }; metadata?: unknown }> = [];
      const allBodyFatRecords: Array<{ time: string; percentage: number; metadata?: unknown }> = [];
      let pageToken: string | undefined;

      if (hasWeightPermission) {
        do {
          const result = await healthConnect.readRecords('Weight', {
            timeRangeFilter: { operator: 'between', startTime, endTime: endTime.toISOString() },
            ascendingOrder: false,
            pageSize: 1000,
            pageToken,
          });
          allRecords.push(...result.records as Array<{ time: string; weight: { inKilograms: number }; metadata?: unknown }>);
          pageToken = result.pageToken;
        } while (pageToken);
      }

      pageToken = undefined;
      if (hasBodyFatPermission) {
        do {
          const result: { records: unknown[]; pageToken?: string } = await healthConnect.readRecords('BodyFat', {
            timeRangeFilter: { operator: 'between', startTime, endTime: endTime.toISOString() },
            ascendingOrder: false,
            pageSize: 1000,
            pageToken,
          });
          allBodyFatRecords.push(...result.records as Array<{ time: string; percentage: number; metadata?: unknown }>);
          pageToken = result.pageToken;
        } while (pageToken);
      }

      const synced: WeightPoint[] = allRecords.map((r) => ({
        recordedAt: r.time,
        weightKg: roundTo(r.weight.inKilograms, 2),
        source: 'health-connect',
        ...extractHealthOrigin(r),
      }));

      const syncedBodyFat: BodyFatPoint[] = allBodyFatRecords
        .map((r) => {
          const raw = typeof r.percentage === 'number'
            ? r.percentage
            : (typeof (r as { percentage?: { value?: number } }).percentage?.value === 'number'
              ? (r as { percentage?: { value?: number } }).percentage!.value!
              : NaN);
          return {
            recordedAt: r.time,
            bodyFatPercentage: roundTo(raw, 2),
            source: 'health-connect' as const,
            ...extractHealthOrigin(r),
          };
        })
        .filter((point) => Number.isFinite(point.bodyFatPercentage));

      setData((prev) => ({
        ...prev,
        weightHistory: mergeWeightHistory(prev.weightHistory.filter((p) => p.source !== 'health-connect'), synced),
        bodyFatHistory: mergeBodyFatHistory(prev.bodyFatHistory.filter((p) => p.source !== 'health-connect'), syncedBodyFat),
        lastWeightSyncAt: new Date().toISOString(),
        lastBodyFatSyncAt: new Date().toISOString(),
      }));

      setHealthStatus('available');
      setHealthMessage(
        synced.length || syncedBodyFat.length
          ? `Synced ${synced.length} weight and ${syncedBodyFat.length} body fat record${(synced.length + syncedBodyFat.length) === 1 ? '' : 's'}.${hasHistoryPermission ? '' : ' History access is turned off, so sync may only include recent records.'}`
          : 'No recent body metric records found in Health Connect.',
      );
    } catch (error) {
      const reason = getErrorMessage(error);
      setHealthStatus('error');
      setHealthMessage(`Body sync failed: ${reason}`);
      Alert.alert(
        'Sync Failed',
        `Could not sync body data. ${reason}`,
      );
    } finally {
      setIsSyncingWeight(false);
    }
  };

  const syncCalories = async () => {
    if (!healthConnect) { Alert.alert('Unavailable', 'Health Connect requires an Android development build.'); return; }
    const latestData = await loadStoredData().catch(() => null);
    if (!latestData) {
      Alert.alert('Storage error', 'Saved data could not be loaded.');
      return;
    }

    const entriesToSync = latestData.entries.filter((entry) => !entry.healthConnectSyncAt);
    if (!entriesToSync.length) {
      setHealthStatus('available');
      setHealthMessage('All meal entries are already exported to Health Connect.');
      return;
    }

    setIsSyncingCalories(true);
    setHealthMessage(`Syncing ${entriesToSync.length} calorie entr${entriesToSync.length === 1 ? 'y' : 'ies'} to Health Connect...`);

    try {
      const available = await ensureHealthConnectAvailable();
      if (!available) return;

      const permissions: Permission[] = [{ accessType: 'write', recordType: 'Nutrition' }];
      const granted = await healthConnect.requestPermission(permissions);
      const hasNutritionWrite = hasPermission(granted, 'write', 'Nutrition');
      if (!hasNutritionWrite) {
        setHealthStatus('error');
        setHealthMessage(
          'Nutrition write permission is off. Open Health Connect settings and allow this app to write Nutrition records, then sync calories again.',
        );
        Alert.alert(
          'Nutrition Permission Needed',
          'This app needs Health Connect permission to write Nutrition records. In Health Connect, enable Nutrition under app permissions, then tap Sync calories again.',
          [{ text: 'OK' }],
        );
        return;
      }

      const records = entriesToSync.map((entry) => buildNutritionRecord(entry, healthConnect));
      await healthConnect.insertRecords(records);

      const syncedEntryIds = new Set(entriesToSync.map((entry) => entry.id));
      const syncedAt = new Date().toISOString();

      setData((prev) => ({
        ...prev,
        entries: prev.entries.map((entry) => (
          syncedEntryIds.has(entry.id)
            ? { ...entry, healthConnectSyncAt: syncedAt }
            : entry
        )),
        lastCalorieSyncAt: syncedAt,
      }));

      setHealthStatus('available');
      setHealthMessage(`Exported ${records.length} calorie entr${records.length === 1 ? 'y' : 'ies'} to Health Connect.`);
    } catch (error) {
      const reason = getErrorMessage(error);
      setHealthStatus('error');
      setHealthMessage(`Calorie sync failed: ${reason}`);
      Alert.alert(
        'Calorie Sync Failed',
        `Could not export calorie data. ${reason}`,
      );
    } finally {
      setIsSyncingCalories(false);
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
  const latestBodyFat = data.bodyFatHistory[0]?.bodyFatPercentage ?? null;

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.card} mode="elevated">
          <Card.Title title="Appearance" titleVariant="titleLarge" />
          <Card.Content style={styles.formArea}>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
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
          <Card.Title title="Health Connect" titleVariant="titleLarge" />
          <Card.Content style={styles.formArea}>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{healthMessage}</Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Latest weight: {latestWeight ? `${latestWeight} kg` : 'None yet'}
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Latest body fat: {latestBodyFat !== null ? `${latestBodyFat}%` : 'None yet'}
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Last sync: {data.lastWeightSyncAt ? formatDisplayDate(data.lastWeightSyncAt) : 'Never'}
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Last body fat sync: {data.lastBodyFatSyncAt ? formatDisplayDate(data.lastBodyFatSyncAt) : 'Never'}
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Pending calorie exports: {unsyncedCalorieEntries.length}
          </Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            Last calorie sync: {data.lastCalorieSyncAt ? formatDisplayDate(data.lastCalorieSyncAt) : 'Never'}
          </Text>
          <Chip icon={healthStatus === 'available' ? 'check-circle' : 'information-outline'}>
            Status: {healthStatus}
          </Chip>
          <View style={styles.buttonColumn}>
            <View style={styles.buttonRow}>
              <Button
                style={styles.button}
                mode="contained"
                icon="sync"
                loading={isSyncingWeight}
                disabled={isSyncingWeight || isSyncingCalories}
                onPress={onPressSyncWeight}
              >
                {isSyncingWeight ? 'Syncing...' : 'Sync body data'}
              </Button>
              <Button
                style={styles.button}
                mode="contained"
                icon="food-apple"
                buttonColor={theme.colors.tertiary}
                textColor={theme.colors.onTertiary}
                loading={isSyncingCalories}
                disabled={isSyncingCalories || isSyncingWeight}
                onPress={() => { void syncCalories(); }}
              >
                {isSyncingCalories ? 'Syncing...' : 'Sync calories'}
              </Button>
            </View>
            <Button mode="outlined" icon="cog" onPress={openHealthSettings}>
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
  buttonColumn: { gap: 10 },
  buttonRow: { flexDirection: 'row', gap: 10 },
  button: { flex: 1 },
});
