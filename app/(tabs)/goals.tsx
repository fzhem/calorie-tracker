import { useFocusEffect } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated } from "react-native";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  Vibration,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Button,
  Card,
  Chip,
  SegmentedButtons,
  Snackbar,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import { useM3Alert } from "@/ui/m3Alert";
import { getAppSegmentedButtonsTheme } from "@/ui/segmentedButtons";

import {
  DEFAULT_DATA,
  getCachedData,
  loadStoredData,
  saveStoredData,
} from "@/data/storage";
import type { GoalAdjustmentType, GoalPhase, StoredData } from "@/data/storage";
import {
  estimateMetabolism,
  getActivityFactor,
  getGoalCalorieDelta,
} from "@/domain/metabolism";

import {
  DEFAULT_BASE_TARGET_CALORIES,
  DEFAULT_CALORIES_PER_KG,
} from "@/constants";

import {
  insertWeight,
  getLatestWeightBySource,
  deleteWeightBySource,
  deleteBodyFatBySource,
  getLatestBodyFatBySource,
} from "@/db/index";
import {
  invalidateWeightCaches,
  invalidateBodyFatCaches,
} from "@/lib/queryCache";
import { toLocalISOString } from "@/lib/dateKey";

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;
const GOALS_PROFILE_INPUT_THEME = { animation: { scale: 0 } };

type WeightUnit = "kg" | "lb";
type HeightUnit = "cm" | "ft";
type EditableGoalPhase = Exclude<GoalPhase, "maintain">;

function roundTo(value: number, digits = 1) {
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

function parseNumberInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getActivityLabel(activityLevel: StoredData["activityLevel"]) {
  if (activityLevel === "sedentary") return "Sed";
  if (activityLevel === "light") return "Light";
  if (activityLevel === "moderate") return "Mod";
  if (activityLevel === "athlete") return "Athl";
  return "Heavy";
}

function getActivityIcon(activityLevel: StoredData["activityLevel"]) {
  if (activityLevel === "sedentary") return "sofa";
  if (activityLevel === "light") return "walk";
  if (activityLevel === "moderate") return "run";
  if (activityLevel === "athlete") return "arm-flex";
  return "dumbbell";
}

function formatWeightForUnit(weightKg: number, unit: WeightUnit) {
  const displayValue = unit === "kg" ? weightKg : weightKg / KG_PER_LB;
  return `${roundTo(displayValue, 2)}`;
}

function formatHeightCmInput(heightCm: number) {
  return `${roundTo(heightCm, 1)}`;
}

function parseHeightCmInputToCm(value: string) {
  const parsed = parseNumberInput(value);
  return parsed === null ? null : parsed;
}

function getFeetInchesFromCm(heightCm: number) {
  const totalInches = Math.round(heightCm / CM_PER_IN);
  return {
    feet: Math.floor(totalInches / 12),
    inches: totalInches % 12,
  };
}

export default function GoalsScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const segmentedButtonsTheme = useMemo(
    () => getAppSegmentedButtonsTheme(theme),
    [
      theme.colors.onPrimaryContainer,
      theme.colors.outlineVariant,
      theme.colors.primaryContainer,
    ],
  );
  const initialData = getCachedData() ?? DEFAULT_DATA;
  const [data, setData] = useState<StoredData>(initialData);
  const [isReady, setIsReady] = useState(false);
  const [baseTargetInput, setBaseTargetInput] = useState(
    `${initialData.baseTarget}`,
  );
  const [caloriesPerKgInput, setCaloriesPerKgInput] = useState(
    `${initialData.caloriesPerKg}`,
  );
  const [goalAdjustmentEditorPhase, setGoalAdjustmentEditorPhase] =
    useState<EditableGoalPhase>("cut");
  const [goalAdjustmentTypeInput, setGoalAdjustmentTypeInput] =
    useState<GoalAdjustmentType>("kcal");
  const [goalAdjustmentInput, setGoalAdjustmentInput] = useState("500");
  const [goalPercentInput, setGoalPercentInput] = useState("1");
  const [metabolismAgeInput, setMetabolismAgeInput] = useState(
    initialData.metabolismAgeYears ? `${initialData.metabolismAgeYears}` : "",
  );
  const [metabolismHeightInput, setMetabolismHeightInput] = useState(
    initialData.metabolismHeightCm
      ? formatHeightCmInput(initialData.metabolismHeightCm)
      : "",
  );
  const [heightFeetInput, setHeightFeetInput] = useState(
    initialData.metabolismHeightCm
      ? `${getFeetInchesFromCm(initialData.metabolismHeightCm).feet}`
      : "",
  );
  const [heightInchesInput, setHeightInchesInput] = useState(
    initialData.metabolismHeightCm
      ? `${getFeetInchesFromCm(initialData.metabolismHeightCm).inches}`
      : "",
  );
  const [manualWeightInput, setManualWeightInput] = useState(
    initialData.manualWeightKg ? `${initialData.manualWeightKg}` : "",
  );
  const [proteinGoalInput, setProteinGoalInput] = useState(
    initialData.proteinGoalGrams ? `${initialData.proteinGoalGrams}` : "",
  );
  const [fatGoalInput, setFatGoalInput] = useState(
    initialData.fatGoalGrams ? `${initialData.fatGoalGrams}` : "",
  );
  const [carbsGoalInput, setCarbsGoalInput] = useState(
    initialData.carbsGoalGrams ? `${initialData.carbsGoalGrams}` : "",
  );
  const [fibreGoalInput, setFibreGoalInput] = useState(
    initialData.fibreGoalGrams ? `${initialData.fibreGoalGrams}` : "",
  );
  const [bodyFatInput, setBodyFatInput] = useState(
    initialData.metabolismBodyFatPercent
      ? `${initialData.metabolismBodyFatPercent}`
      : "",
  );
  const [heightUnit, setHeightUnit] = useState<HeightUnit>("cm");
  const [weightUnit, setWeightUnit] = useState<WeightUnit>("kg");
  const weightAnim = useRef(new Animated.Value(1)).current;
  const toggleAnim = useRef(new Animated.Value(0)).current; // 0 for kg, 1 for lb
  const heightAnim = useRef(new Animated.Value(1)).current;
  const heightToggleAnim = useRef(new Animated.Value(0)).current; // 0 for cm, 1 for ft
  const [goalAdjustmentPickerVisible, setGoalAdjustmentPickerVisible] =
    useState(false);
  const [latestHCBodyFatPercent, setLatestHCBodyFatPercent] = useState<
    number | null
  >(null);
  const [weightUnlocked, setWeightUnlocked] = useState(false);
  const [bodyFatUnlocked, setBodyFatUnlocked] = useState(false);
  const [manualBodyFatInput, setManualBodyFatInput] = useState(
    initialData.manualBodyFatPercent
      ? `${initialData.manualBodyFatPercent}`
      : "",
  );
  const [goalsTab, setGoalsTab] = useState<"profile" | "overrides">("profile");
  const [savedSnackbarVisible, setSavedSnackbarVisible] = useState(false);
  const m3Alert = useM3Alert();
  const hasCompletedInitialLoad = useRef(false);

  useEffect(() => {
    loadStoredData()
      .then((next) => {
        setData(next);
        setBaseTargetInput(`${next.baseTarget}`);
        setCaloriesPerKgInput(`${next.caloriesPerKg}`);
        setGoalAdjustmentTypeInput(next.cutAdjustmentType ?? "kcal");
        setGoalAdjustmentInput(`${next.cutCalorieAdjustment ?? 500}`);
        setGoalPercentInput(`${next.cutPercentPerWeek ?? 1}`);
        setMetabolismAgeInput(
          next.metabolismAgeYears ? `${next.metabolismAgeYears}` : "",
        );
        if (next.metabolismHeightCm !== null) {
          const feetInches = getFeetInchesFromCm(next.metabolismHeightCm);
          setMetabolismHeightInput(
            formatHeightCmInput(next.metabolismHeightCm),
          );
          setHeightFeetInput(`${feetInches.feet}`);
          setHeightInchesInput(`${feetInches.inches}`);
        } else {
          setMetabolismHeightInput("");
          setHeightFeetInput("");
          setHeightInchesInput("");
        }
        setManualWeightInput(
          next.manualWeightKg
            ? formatWeightForUnit(next.manualWeightKg, weightUnit)
            : "",
        );
        setProteinGoalInput(
          next.proteinGoalGrams ? `${next.proteinGoalGrams}` : "",
        );
        setFatGoalInput(next.fatGoalGrams ? `${next.fatGoalGrams}` : "");
        setCarbsGoalInput(next.carbsGoalGrams ? `${next.carbsGoalGrams}` : "");
        setFibreGoalInput(next.fibreGoalGrams ? `${next.fibreGoalGrams}` : "");
      })
      .catch(() =>
        m3Alert.alert("Storage error", "Saved data could not be loaded."),
      )
      .finally(() => {
        hasCompletedInitialLoad.current = true;
        setIsReady(true);
      });
  }, []);

  // Fetch latest health-connect weight on mount so metabolism can use it
  const [latestHealthConnectWeightKg, setLatestHealthConnectWeightKg] =
    useState<number | null>(null);
  useEffect(() => {
    getLatestWeightBySource("health-connect").then((point) => {
      setLatestHealthConnectWeightKg(point?.weightKg ?? null);
    });
    getLatestBodyFatBySource("health-connect").then((point) => {
      setLatestHCBodyFatPercent(point?.bodyFatPercentage ?? null);
    });
  }, []);

  // Debounce storage writes: batch rapid data changes
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isReady) return;

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Schedule save for 500ms after last change
    saveTimeoutRef.current = setTimeout(() => {
      saveStoredData(data).catch(() =>
        m3Alert.alert("Storage error", "Changes could not be saved."),
      );
      saveTimeoutRef.current = null;
    }, 500);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [data, isReady]);

  useFocusEffect(
    useCallback(() => {
      if (!hasCompletedInitialLoad.current) return;
      // Reload full form from storage so that an import done in Settings is
      // reflected immediately when the user navigates here.
      loadStoredData()
        .then((next) => {
          setData(next);
          setBaseTargetInput(`${next.baseTarget}`);
          setCaloriesPerKgInput(`${next.caloriesPerKg}`);
          setGoalAdjustmentTypeInput(next.cutAdjustmentType ?? "kcal");
          setGoalAdjustmentInput(`${next.cutCalorieAdjustment ?? 500}`);
          setGoalPercentInput(`${next.cutPercentPerWeek ?? 1}`);
          setMetabolismAgeInput(
            next.metabolismAgeYears ? `${next.metabolismAgeYears}` : "",
          );
          if (next.metabolismHeightCm !== null) {
            const feetInches = getFeetInchesFromCm(next.metabolismHeightCm);
            setMetabolismHeightInput(
              formatHeightCmInput(next.metabolismHeightCm),
            );
            setHeightFeetInput(`${feetInches.feet}`);
            setHeightInchesInput(`${feetInches.inches}`);
          } else {
            setMetabolismHeightInput("");
            setHeightFeetInput("");
            setHeightInchesInput("");
          }
          setManualWeightInput(
            next.manualWeightKg
              ? formatWeightForUnit(next.manualWeightKg, weightUnit)
              : "",
          );
          setProteinGoalInput(
            next.proteinGoalGrams ? `${next.proteinGoalGrams}` : "",
          );
          setFatGoalInput(next.fatGoalGrams ? `${next.fatGoalGrams}` : "");
          setCarbsGoalInput(
            next.carbsGoalGrams ? `${next.carbsGoalGrams}` : "",
          );
          setFibreGoalInput(
            next.fibreGoalGrams ? `${next.fibreGoalGrams}` : "",
          );
        })
        .catch(() => {});
      getLatestWeightBySource("health-connect").then((point) => {
        setLatestHealthConnectWeightKg(point?.weightKg ?? null);
      });
    }, [weightUnit]),
  );

  const getCurrentHeightCmFromInputs = useCallback(() => {
    if (heightUnit === "cm") {
      return metabolismHeightInput.trim()
        ? parseHeightCmInputToCm(metabolismHeightInput)
        : null;
    }

    const feetTrimmed = heightFeetInput.trim();
    const inchesTrimmed = heightInchesInput.trim();
    if (!feetTrimmed && !inchesTrimmed) return null;
    const feet = feetTrimmed ? parseNumberInput(feetTrimmed) : 0;
    const inches = inchesTrimmed ? parseNumberInput(inchesTrimmed) : 0;
    if (feet === null || inches === null) return null;
    return (feet * 12 + inches) * CM_PER_IN;
  }, [heightUnit, metabolismHeightInput, heightFeetInput, heightInchesInput]);

  const onToggleWeightUnit = () => {
    const nextUnit = weightUnit === "kg" ? "lb" : "kg";
    Animated.timing(toggleAnim, {
      toValue: nextUnit === "kg" ? 0 : 1,
      duration: 180,
      useNativeDriver: false,
    }).start();
    // Animate scale for feedback
    Animated.sequence([
      Animated.timing(weightAnim, {
        toValue: 0.85,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(weightAnim, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start();
    const parsed = parseNumberInput(manualWeightInput);
    if (parsed !== null) {
      const inKg = weightUnit === "kg" ? parsed : parsed * KG_PER_LB;
      setManualWeightInput(formatWeightForUnit(inKg, nextUnit));
    }
    setWeightUnit(nextUnit);
  };

  const onHeightUnitChange = (nextValue: string) => {
    const nextUnit = nextValue as HeightUnit;
    if (nextUnit === heightUnit) return;
    const nextHeightCm = getCurrentHeightCmFromInputs();

    setHeightUnit(nextUnit);
    if (nextHeightCm !== null) {
      const feetInches = getFeetInchesFromCm(nextHeightCm);
      setMetabolismHeightInput(formatHeightCmInput(nextHeightCm));
      setHeightFeetInput(`${feetInches.feet}`);
      setHeightInchesInput(`${feetInches.inches}`);
    }
  };

  const onToggleHeightUnit = () => {
    const nextUnit: HeightUnit = heightUnit === "cm" ? "ft" : "cm";
    Animated.timing(heightToggleAnim, {
      toValue: nextUnit === "cm" ? 0 : 1,
      duration: 180,
      useNativeDriver: false,
    }).start();
    Animated.sequence([
      Animated.timing(heightAnim, {
        toValue: 0.85,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(heightAnim, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start();
    onHeightUnitChange(nextUnit);
  };

  const onGoalPhasePress = (phase: GoalPhase) => {
    setData((prev) => {
      if (prev.goalPhase === phase) return prev;
      const next = { ...prev, goalPhase: phase };
      void saveStoredData(next, { immediate: true });
      return next;
    });
  };

  const onGoalPhaseLongPress = (phase: EditableGoalPhase) => {
    Vibration.vibrate(12);
    setData((prev) => {
      if (prev.goalPhase === phase) return prev;
      const next = { ...prev, goalPhase: phase };
      void saveStoredData(next, { immediate: true });
      return next;
    });
    setGoalAdjustmentEditorPhase(phase);

    const phaseType =
      phase === "cut"
        ? (data.cutAdjustmentType ?? "kcal")
        : (data.bulkAdjustmentType ?? "kcal");
    const phaseKcal =
      phase === "cut"
        ? (data.cutCalorieAdjustment ?? 500)
        : (data.bulkCalorieAdjustment ?? 500);
    const phasePercent =
      phase === "cut"
        ? (data.cutPercentPerWeek ?? 1)
        : (data.bulkPercentPerWeek ?? 1);

    setGoalAdjustmentTypeInput(phaseType);
    setGoalAdjustmentInput(`${Math.round(phaseKcal)}`);
    setGoalPercentInput(`${roundTo(phasePercent, 2)}`);

    if (phaseType === "percent") {
      const currentPercent = parseNumberInput(`${phasePercent}`);
      if (!currentPercent || currentPercent < 0.1 || currentPercent > 3) {
        setGoalPercentInput("1");
      }
    } else {
      const current = parseNumberInput(`${phaseKcal}`);
      if (!current || current < 50 || current > 1500) {
        setGoalAdjustmentInput("500");
      }
    }
    setGoalAdjustmentPickerVisible(true);
  };

  const saveTargets = () => {
    const nextBase = parseNumberInput(baseTargetInput);
    const nextPerKg = parseNumberInput(caloriesPerKgInput);
    const nextWeightInput = manualWeightInput.trim()
      ? parseNumberInput(manualWeightInput)
      : null;
    const nextWeightKg =
      nextWeightInput !== null
        ? weightUnit === "kg"
          ? nextWeightInput
          : nextWeightInput * KG_PER_LB
        : null;
    const nextAge = metabolismAgeInput.trim()
      ? parseNumberInput(metabolismAgeInput)
      : null;
    const nextHeightCm = getCurrentHeightCmFromInputs();
    const nextProtein = proteinGoalInput.trim()
      ? parseNumberInput(proteinGoalInput)
      : null;
    const nextFat = fatGoalInput.trim() ? parseNumberInput(fatGoalInput) : null;
    const nextCarbs = carbsGoalInput.trim()
      ? parseNumberInput(carbsGoalInput)
      : null;
    const nextFibre = fibreGoalInput.trim()
      ? parseNumberInput(fibreGoalInput)
      : null;
    const nextBodyFat = bodyFatInput.trim()
      ? parseNumberInput(bodyFatInput)
      : null;
    const nextManualBodyFat = manualBodyFatInput.trim()
      ? parseNumberInput(manualBodyFatInput)
      : null;

    if (!nextBase || nextBase <= 0) {
      m3Alert.alert("Invalid goal", "Enter a valid override calorie target.");
      return;
    }
    if (!nextPerKg || nextPerKg <= 0) {
      m3Alert.alert(
        "Invalid multiplier",
        "Enter calories per kg as a positive number.",
      );
      return;
    }
    if (nextAge !== null && (nextAge < 13 || nextAge > 120)) {
      m3Alert.alert("Invalid age", "Enter an age between 13 and 120.");
      return;
    }
    if (heightUnit === "ft") {
      const feetTrimmed = heightFeetInput.trim();
      const inchesTrimmed = heightInchesInput.trim();
      const feet = feetTrimmed ? parseNumberInput(feetTrimmed) : 0;
      const inches = inchesTrimmed ? parseNumberInput(inchesTrimmed) : 0;
      const hasValue = feetTrimmed.length > 0 || inchesTrimmed.length > 0;
      if (
        hasValue &&
        (feet === null ||
          inches === null ||
          !Number.isInteger(feet) ||
          !Number.isInteger(inches) ||
          feet < 0 ||
          inches < 0 ||
          inches > 11)
      ) {
        m3Alert.alert(
          "Invalid height",
          "Use whole numbers for feet and inches, with inches between 0 and 11.",
        );
        return;
      }
    }
    if (nextHeightCm !== null && (nextHeightCm < 92 || nextHeightCm > 214)) {
      m3Alert.alert(
        "Invalid height",
        "Enter a height between 92 cm (3') and 214 cm (7').",
      );
      return;
    }
    if (nextProtein !== null && nextProtein < 0) {
      m3Alert.alert("Invalid protein goal", "Protein must be 0 or more.");
      return;
    }
    if (nextFat !== null && nextFat < 0) {
      m3Alert.alert("Invalid fat goal", "Fat must be 0 or more.");
      return;
    }
    if (nextCarbs !== null && nextCarbs < 0) {
      m3Alert.alert("Invalid carbs goal", "Carbs must be 0 or more.");
      return;
    }
    if (nextFibre !== null && nextFibre < 0) {
      m3Alert.alert("Invalid fibre goal", "Fibre must be 0 or more.");
      return;
    }

    if (nextWeightKg && nextWeightKg > 0) {
      insertWeight({
        recordedAt: toLocalISOString(new Date()),
        weightKg: roundTo(nextWeightKg, 2),
        source: "manual",
        originAppId: null,
        originAppName: null,
        originDevice: null,
      }).catch(() =>
        m3Alert.alert(
          "Save failed",
          "Manual weight could not be saved. Please try again.",
        ),
      );
    }
    // Invalidate caches so other screens (Graphs) pick up the new manual weight
    invalidateWeightCaches();

    setData((prev) => ({
      ...prev,
      baseTarget: Math.round(nextBase),
      caloriesPerKg: roundTo(nextPerKg, 1),
      metabolismAgeYears: nextAge !== null ? Math.round(nextAge) : null,
      metabolismHeightCm:
        nextHeightCm !== null ? roundTo(nextHeightCm, 1) : null,
      metabolismBodyFatPercent:
        nextBodyFat !== null
          ? Math.min(Math.max(roundTo(nextBodyFat, 1), 0), 100)
          : null,
      manualBodyFatPercent:
        nextManualBodyFat !== null
          ? Math.min(Math.max(roundTo(nextManualBodyFat, 1), 0), 100)
          : null,
      manualWeightKg:
        nextWeightKg && nextWeightKg > 0 ? roundTo(nextWeightKg, 2) : null,
      proteinGoalGrams: nextProtein !== null ? roundTo(nextProtein, 1) : null,
      fatGoalGrams: nextFat !== null ? roundTo(nextFat, 1) : null,
      carbsGoalGrams: nextCarbs !== null ? roundTo(nextCarbs, 1) : null,
      fibreGoalGrams: nextFibre !== null ? roundTo(nextFibre, 1) : null,
    }));

    setManualWeightInput(
      nextWeightKg && nextWeightKg > 0
        ? formatWeightForUnit(roundTo(nextWeightKg, 2), weightUnit)
        : "",
    );
    setMetabolismHeightInput(
      nextHeightCm !== null
        ? formatHeightCmInput(roundTo(nextHeightCm, 1))
        : "",
    );
    if (nextHeightCm !== null) {
      const feetInches = getFeetInchesFromCm(nextHeightCm);
      setHeightFeetInput(`${feetInches.feet}`);
      setHeightInchesInput(`${feetInches.inches}`);
    } else {
      setHeightFeetInput("");
      setHeightInchesInput("");
    }
    setSavedSnackbarVisible(true);
    Vibration.vibrate(18);
  };

  const resetOverrides = () => {
    setBaseTargetInput(`${DEFAULT_BASE_TARGET_CALORIES}`);
    setCaloriesPerKgInput(`${DEFAULT_CALORIES_PER_KG}`);
    setProteinGoalInput("");
    setFatGoalInput("");
    setCarbsGoalInput("");
    setFibreGoalInput("");
    setData((prev) => ({
      ...prev,
      baseTarget: DEFAULT_BASE_TARGET_CALORIES,
      caloriesPerKg: DEFAULT_CALORIES_PER_KG,
      proteinGoalGrams: null,
      fatGoalGrams: null,
      carbsGoalGrams: null,
      fibreGoalGrams: null,
    }));
  };

  const clearManualWeight = () => {
    Vibration.vibrate(40); // Vibrate for 40ms
    setManualWeightInput("");
    deleteWeightBySource("manual").catch(() =>
      m3Alert.alert(
        "Delete failed",
        "Manual weight could not be removed. Please try again.",
      ),
    );
    // Invalidate caches when manual weight is cleared
    invalidateWeightCaches();
    setData((prev) => ({
      ...prev,
      manualWeightKg: null,
    }));
  };
  const clearManualBodyFat = () => {
    Vibration.vibrate(40);
    setManualBodyFatInput("");
    deleteBodyFatBySource("manual").catch(() =>
      m3Alert.alert(
        "Delete failed",
        "Manual body fat could not be removed. Please try again.",
      ),
    );
    invalidateBodyFatCaches();
    setData((prev) => ({
      ...prev,
      manualBodyFatPercent: null,
    }));
  };
  const hasSavedManualWeight = data.manualWeightKg !== null;
  const hasSavedManualBodyFat = data.manualBodyFatPercent !== null;

  const latestWeight =
    data.manualWeightKg ?? latestHealthConnectWeightKg ?? null;
  const effectiveBodyFatPercent =
    data.manualBodyFatPercent ?? latestHCBodyFatPercent ?? null;
  const metabolism = estimateMetabolism({
    weightKg: latestWeight,
    heightCm: data.metabolismHeightCm,
    ageYears: data.metabolismAgeYears,
    sex: data.metabolismSex,
    activityLevel: data.activityLevel,
    bodyFatPercent: effectiveBodyFatPercent,
  });
  const goalDelta = getGoalCalorieDelta(data.goalPhase, {
    adjustmentType:
      data.goalPhase === "cut"
        ? (data.cutAdjustmentType ?? "kcal")
        : data.goalPhase === "bulk"
          ? (data.bulkAdjustmentType ?? "kcal")
          : "kcal",
    adjustmentKcal:
      data.goalPhase === "cut"
        ? (data.cutCalorieAdjustment ?? 500)
        : data.goalPhase === "bulk"
          ? (data.bulkCalorieAdjustment ?? 500)
          : 500,
    percentPerWeek:
      data.goalPhase === "cut"
        ? (data.cutPercentPerWeek ?? 1)
        : data.goalPhase === "bulk"
          ? (data.bulkPercentPerWeek ?? 1)
          : 1,
    weightKg: latestWeight,
  });
  const goalModeLabel =
    data.goalPhase === "cut"
      ? "Cut"
      : data.goalPhase === "bulk"
        ? "Bulk"
        : "Maintain";
  const goalModeCalories =
    metabolism.maintenanceCalories !== null
      ? Math.round(metabolism.maintenanceCalories + goalDelta)
      : null;

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, backgroundColor: theme.colors.background },
      ]}
    >
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.card} mode="elevated">
          <Card.Title
            title="Daily Goals & Metabolism"
            titleVariant="titleLarge"
          />
          <Card.Content style={styles.formArea}>
            <SegmentedButtons
              value={goalsTab}
              onValueChange={(value) =>
                setGoalsTab(value as "profile" | "overrides")
              }
              buttons={[
                { value: "profile", label: "Profile", icon: "account" },
                { value: "overrides", label: "Custom Goals", icon: "tune" },
              ]}
              style={[
                styles.segmentedControl,
                {
                  marginBottom: 8,
                  backgroundColor: theme.colors.elevation.level2,
                },
              ]}
              theme={segmentedButtonsTheme}
            />

            {goalsTab === "profile" ? (
              <>
                <Text
                  variant="bodyMedium"
                  style={[
                    styles.supportingText,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  Complete your profile to calculate accurate metabolism
                  metrics.
                </Text>

                <Text variant="labelMedium" style={{ marginTop: 4 }}>
                  Your Profile
                </Text>
                <TextInput
                  label="Age (years)"
                  value={metabolismAgeInput}
                  onChangeText={setMetabolismAgeInput}
                  keyboardType="numeric"
                  mode="outlined"
                  theme={GOALS_PROFILE_INPUT_THEME}
                />
                <View style={styles.heightRow}>
                  <Animated.View
                    style={{
                      flex: 1,
                      justifyContent: "center",
                      transform: [{ scale: heightAnim }],
                    }}
                  >
                    {heightUnit === "cm" ? (
                      <TextInput
                        label="Height (cm)"
                        value={metabolismHeightInput}
                        onChangeText={setMetabolismHeightInput}
                        keyboardType="numeric"
                        placeholder="170"
                        mode="outlined"
                        theme={GOALS_PROFILE_INPUT_THEME}
                      />
                    ) : (
                      <View style={styles.heightFtInputsRow}>
                        <TextInput
                          label="Height (ft)"
                          value={heightFeetInput}
                          onChangeText={setHeightFeetInput}
                          keyboardType="numeric"
                          placeholder="5"
                          mode="outlined"
                          style={styles.heightFtInput}
                          theme={GOALS_PROFILE_INPUT_THEME}
                        />
                        <TextInput
                          label="in"
                          value={heightInchesInput}
                          onChangeText={setHeightInchesInput}
                          keyboardType="numeric"
                          placeholder="10"
                          mode="outlined"
                          style={styles.heightInInput}
                          theme={GOALS_PROFILE_INPUT_THEME}
                        />
                      </View>
                    )}
                  </Animated.View>
                  <Animated.View
                    style={{
                      marginLeft: 8,
                      transform: [{ scale: heightAnim }],
                    }}
                  >
                    <Pressable
                      onPress={onToggleHeightUnit}
                      style={[
                        styles.toggleOuter,
                        { backgroundColor: theme.colors.surfaceVariant },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Toggle height unit"
                    >
                      <Animated.View
                        style={[
                          styles.togglePill,
                          {
                            left: heightToggleAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [2, 30],
                            }),
                            backgroundColor: theme.colors.primary,
                          },
                        ]}
                      />
                      <View style={styles.toggleLabelRow}>
                        <Text
                          style={[
                            styles.toggleLabel,
                            {
                              color:
                                heightUnit === "cm"
                                  ? theme.colors.onPrimary
                                  : theme.colors.onSurfaceVariant,
                            },
                          ]}
                        >
                          cm
                        </Text>
                        <Text
                          style={[
                            styles.toggleLabel,
                            {
                              color:
                                heightUnit === "ft"
                                  ? theme.colors.onPrimary
                                  : theme.colors.onSurfaceVariant,
                            },
                          ]}
                        >
                          ft
                        </Text>
                      </View>
                    </Pressable>
                  </Animated.View>
                </View>

                <Text
                  variant="bodySmall"
                  style={{ marginTop: 0, color: theme.colors.onSurfaceVariant }}
                >
                  Sex
                </Text>
                <View style={styles.sexRow}>
                  <Pressable
                    onPress={() => {
                      Vibration.vibrate(20);
                      setData((prev) => ({ ...prev, metabolismSex: "male" }));
                    }}
                    style={[
                      styles.sexOption,
                      {
                        backgroundColor:
                          data.metabolismSex === "male"
                            ? theme.colors.primaryContainer
                            : theme.colors.elevation.level1,
                        borderColor:
                          data.metabolismSex === "male"
                            ? theme.colors.primary
                            : theme.colors.outlineVariant,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="gender-male"
                      size={20}
                      color={
                        data.metabolismSex === "male"
                          ? theme.colors.onPrimaryContainer
                          : theme.colors.onSurfaceVariant
                      }
                    />
                    <Text
                      variant="labelMedium"
                      style={{
                        color:
                          data.metabolismSex === "male"
                            ? theme.colors.onPrimaryContainer
                            : theme.colors.onSurfaceVariant,
                        fontWeight: "700",
                      }}
                    >
                      Male
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      Vibration.vibrate(20);
                      setData((prev) => ({ ...prev, metabolismSex: "female" }));
                    }}
                    style={[
                      styles.sexOption,
                      {
                        backgroundColor:
                          data.metabolismSex === "female"
                            ? theme.colors.primaryContainer
                            : theme.colors.elevation.level1,
                        borderColor:
                          data.metabolismSex === "female"
                            ? theme.colors.primary
                            : theme.colors.outlineVariant,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      name="gender-female"
                      size={20}
                      color={
                        data.metabolismSex === "female"
                          ? theme.colors.onPrimaryContainer
                          : theme.colors.onSurfaceVariant
                      }
                    />
                    <Text
                      variant="labelMedium"
                      style={{
                        color:
                          data.metabolismSex === "female"
                            ? theme.colors.onPrimaryContainer
                            : theme.colors.onSurfaceVariant,
                        fontWeight: "700",
                      }}
                    >
                      Female
                    </Text>
                  </Pressable>
                </View>

                <Text
                  variant="bodySmall"
                  style={{ marginTop: 0, color: theme.colors.onSurfaceVariant }}
                >
                  Activity Level
                </Text>
                <View style={styles.activityRow}>
                  {(
                    [
                      "sedentary",
                      "light",
                      "moderate",
                      "heavy",
                      "athlete",
                    ] as const
                  ).map((level) => {
                    const isSelected = data.activityLevel === level;
                    return (
                      <Pressable
                        key={level}
                        onPress={() => {
                          Vibration.vibrate(20);
                          setData((prev) => ({
                            ...prev,
                            activityLevel: level,
                          }));
                        }}
                        style={[
                          styles.activityChip,
                          {
                            backgroundColor: isSelected
                              ? theme.colors.primaryContainer
                              : theme.colors.elevation.level1,
                            borderColor: isSelected
                              ? theme.colors.primary
                              : theme.colors.outlineVariant,
                          },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={getActivityIcon(level)}
                          size={16}
                          color={
                            isSelected
                              ? theme.colors.onPrimaryContainer
                              : theme.colors.onSurfaceVariant
                          }
                        />
                        <Text
                          variant="labelSmall"
                          style={{
                            color: isSelected
                              ? theme.colors.onPrimaryContainer
                              : theme.colors.onSurfaceVariant,
                            fontWeight: isSelected ? "700" : "500",
                          }}
                        >
                          {getActivityLabel(level)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.goalModeLabelRow}>
                  <Text
                    variant="bodySmall"
                    style={{
                      marginTop: 0,
                      color: theme.colors.onSurfaceVariant,
                    }}
                  >
                    Goal Mode
                  </Text>
                </View>

                <View style={styles.goalModeRow}>
                  <View style={styles.goalModeButtonWrap}>
                    <Button
                      mode={data.goalPhase === "cut" ? "contained" : "outlined"}
                      icon="trending-down"
                      onPress={() => onGoalPhasePress("cut")}
                      onLongPress={() => onGoalPhaseLongPress("cut")}
                      compact
                      style={styles.goalModeButton}
                    >
                      Cut
                    </Button>
                    <View
                      style={[
                        styles.goalModeConfigBadge,
                        {
                          backgroundColor:
                            data.goalPhase === "cut"
                              ? theme.colors.onPrimary
                              : theme.colors.secondaryContainer,
                        },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="tune"
                        size={14}
                        color={
                          data.goalPhase === "cut"
                            ? theme.colors.primary
                            : theme.colors.onSecondaryContainer
                        }
                      />
                    </View>
                  </View>
                  <Button
                    mode={
                      data.goalPhase === "maintain" ? "contained" : "outlined"
                    }
                    icon="target"
                    onPress={() => onGoalPhasePress("maintain")}
                    compact
                    style={styles.goalModeButton}
                  >
                    Maintain
                  </Button>
                  <View style={styles.goalModeButtonWrap}>
                    <Button
                      mode={
                        data.goalPhase === "bulk" ? "contained" : "outlined"
                      }
                      icon="trending-up"
                      onPress={() => onGoalPhasePress("bulk")}
                      onLongPress={() => onGoalPhaseLongPress("bulk")}
                      compact
                      style={styles.goalModeButton}
                    >
                      Bulk
                    </Button>
                    <View
                      style={[
                        styles.goalModeConfigBadge,
                        {
                          backgroundColor:
                            data.goalPhase === "bulk"
                              ? theme.colors.onPrimary
                              : theme.colors.secondaryContainer,
                        },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="tune"
                        size={14}
                        color={
                          data.goalPhase === "bulk"
                            ? theme.colors.primary
                            : theme.colors.onSecondaryContainer
                        }
                      />
                    </View>
                  </View>
                </View>
                <Text
                  variant="labelSmall"
                  style={{
                    color: theme.colors.onSurfaceVariant,
                    marginTop: 2,
                    marginBottom: 4,
                    textAlign: "center",
                    opacity: 0.7,
                  }}
                >
                  Hold Cut or Bulk for adjustment settings
                </Text>

                <Text variant="labelMedium" style={{ marginTop: 3 }}>
                  Weight & Body Fat Tracking
                </Text>
                <View style={styles.weightRow}>
                  <Animated.View
                    style={{
                      flex: 1,
                      justifyContent: "center",
                      transform: [{ scale: weightAnim }],
                    }}
                  >
                    <TextInput
                      label={`Manual weight (${weightUnit})`}
                      value={manualWeightInput}
                      onChangeText={setManualWeightInput}
                      keyboardType="numeric"
                      placeholder={weightUnit === "kg" ? "78.45" : "173.00"}
                      mode="outlined"
                      editable={weightUnlocked}
                      right={
                        <TextInput.Icon
                          icon={weightUnlocked ? "lock-open-variant" : "lock"}
                          onPress={() => {
                            Vibration.vibrate(40);
                            setWeightUnlocked(!weightUnlocked);
                          }}
                        />
                      }
                      theme={GOALS_PROFILE_INPUT_THEME}
                    />
                  </Animated.View>
                  <Animated.View
                    style={{
                      marginLeft: 8,
                      transform: [{ scale: weightAnim }],
                    }}
                  >
                    <Pressable
                      onPress={onToggleWeightUnit}
                      style={[
                        styles.toggleOuter,
                        { backgroundColor: theme.colors.surfaceVariant },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel="Toggle weight unit"
                    >
                      <Animated.View
                        style={[
                          styles.togglePill,
                          {
                            left: toggleAnim.interpolate({
                              inputRange: [0, 1],
                              outputRange: [2, 30],
                            }),
                            backgroundColor: theme.colors.primary,
                          },
                        ]}
                      />
                      <View style={styles.toggleLabelRow}>
                        <Text
                          style={[
                            styles.toggleLabel,
                            {
                              color:
                                weightUnit === "kg"
                                  ? theme.colors.onPrimary
                                  : theme.colors.onSurfaceVariant,
                            },
                          ]}
                        >
                          kg
                        </Text>
                        <Text
                          style={[
                            styles.toggleLabel,
                            {
                              color:
                                weightUnit === "lb"
                                  ? theme.colors.onPrimary
                                  : theme.colors.onSurfaceVariant,
                            },
                          ]}
                        >
                          lb
                        </Text>
                      </View>
                    </Pressable>
                  </Animated.View>
                </View>
                <View style={styles.bodyFatRow}>
                  <TextInput
                    label="Manual body fat (%)"
                    value={manualBodyFatInput}
                    onChangeText={setManualBodyFatInput}
                    keyboardType="numeric"
                    placeholder="e.g. 15"
                    mode="outlined"
                    editable={bodyFatUnlocked}
                    right={
                      <TextInput.Icon
                        icon={bodyFatUnlocked ? "lock-open-variant" : "lock"}
                        onPress={() => {
                          Vibration.vibrate(40);
                          setBodyFatUnlocked(!bodyFatUnlocked);
                        }}
                      />
                    }
                    theme={GOALS_PROFILE_INPUT_THEME}
                    style={{ flex: 1 }}
                  />
                </View>
                <View style={styles.clearRow}>
                  <Button
                    mode="text"
                    icon="delete-outline"
                    onPress={clearManualWeight}
                    textColor={theme.colors.error}
                    rippleColor={theme.colors.errorContainer}
                    disabled={!hasSavedManualWeight}
                  >
                    Clear weight
                  </Button>
                  <Button
                    mode="text"
                    icon="delete-outline"
                    onPress={clearManualBodyFat}
                    textColor={theme.colors.error}
                    rippleColor={theme.colors.errorContainer}
                    disabled={!hasSavedManualBodyFat}
                  >
                    Clear body fat
                  </Button>
                </View>
                <Button
                  mode="contained"
                  icon="content-save-outline"
                  onPress={saveTargets}
                  style={{ marginTop: 8 }}
                >
                  Save
                </Button>

                <Text variant="labelMedium" style={{ marginTop: 6 }}>
                  Estimated Metabolism
                </Text>
                <Card
                  style={{
                    backgroundColor: theme.colors.surfaceVariant,
                    marginHorizontal: 0,
                    marginVertical: 6,
                  }}
                >
                  <Card.Content style={{ gap: 6 }}>
                    <Text variant="bodyMedium">
                      <Text style={{ fontWeight: "700" }}>BMR:</Text>{" "}
                      {metabolism.bmr
                        ? `${metabolism.bmr} kcal/day`
                        : "Need weight, height, age, and sex"}
                    </Text>
                    <Text variant="bodyMedium">
                      <Text style={{ fontWeight: "700" }}>TDEE:</Text>{" "}
                      {metabolism.tdee
                        ? `${metabolism.tdee} kcal/day`
                        : "Not available yet"}{" "}
                      (activity factor ×{getActivityFactor(data.activityLevel)})
                    </Text>
                    <Text variant="bodyMedium">
                      <Text style={{ fontWeight: "700" }}>Maintenance:</Text>{" "}
                      {metabolism.maintenanceCalories
                        ? `${metabolism.maintenanceCalories} kcal/day`
                        : "Not available yet"}
                    </Text>
                    {data.goalPhase !== "maintain" ? (
                      <Text variant="bodyMedium">
                        <Text style={{ fontWeight: "700" }}>
                          {goalModeLabel} Target:
                        </Text>{" "}
                        {goalModeCalories !== null
                          ? `${goalModeCalories} kcal/day`
                          : "Not available yet"}
                      </Text>
                    ) : null}
                  </Card.Content>
                </Card>
              </>
            ) : (
              <>
                <Text
                  variant="bodySmall"
                  style={[
                    styles.supportingText,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  Set custom calorie targets and macros if profile-based
                  metabolism is incomplete.
                </Text>
                <TextInput
                  label="Override calorie target"
                  value={baseTargetInput}
                  onChangeText={setBaseTargetInput}
                  keyboardType="numeric"
                  mode="outlined"
                  theme={GOALS_PROFILE_INPUT_THEME}
                />
                <TextInput
                  label="Calories per kg"
                  value={caloriesPerKgInput}
                  onChangeText={setCaloriesPerKgInput}
                  keyboardType="numeric"
                  mode="outlined"
                  theme={GOALS_PROFILE_INPUT_THEME}
                />

                <Text variant="labelMedium" style={{ marginTop: 6 }}>
                  Macro Overrides
                </Text>
                <Text
                  variant="bodySmall"
                  style={[
                    styles.supportingText,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
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
                    theme={GOALS_PROFILE_INPUT_THEME}
                  />
                  <TextInput
                    label="Carbs (g)"
                    value={carbsGoalInput}
                    onChangeText={setCarbsGoalInput}
                    placeholder="e.g. 200"
                    keyboardType="numeric"
                    mode="outlined"
                    style={styles.macroInput}
                    theme={GOALS_PROFILE_INPUT_THEME}
                  />
                  <TextInput
                    label="Fat (g)"
                    value={fatGoalInput}
                    onChangeText={setFatGoalInput}
                    placeholder="e.g. 65"
                    keyboardType="numeric"
                    mode="outlined"
                    style={styles.macroInput}
                    theme={GOALS_PROFILE_INPUT_THEME}
                  />
                  <TextInput
                    label="Fibre (g)"
                    value={fibreGoalInput}
                    onChangeText={setFibreGoalInput}
                    placeholder="e.g. 30"
                    keyboardType="numeric"
                    mode="outlined"
                    style={styles.macroInput}
                    theme={GOALS_PROFILE_INPUT_THEME}
                  />
                </View>

                <Button
                  mode="contained"
                  icon="content-save-outline"
                  onPress={saveTargets}
                  style={{ marginTop: 8 }}
                >
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
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setGoalAdjustmentPickerVisible(false)}
        >
          <Pressable
            style={[
              styles.modalCard,
              { backgroundColor: theme.colors.surface },
            ]}
            onPress={() => {}}
          >
            <Text variant="titleMedium" style={{ fontWeight: "700" }}>
              {goalAdjustmentEditorPhase === "cut"
                ? "Cut adjustment"
                : "Bulk adjustment"}
            </Text>
            <Text
              variant="bodySmall"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              Set how aggressive your cut/bulk should be.
            </Text>

            <SegmentedButtons
              value={goalAdjustmentTypeInput}
              onValueChange={(value) => {
                setGoalAdjustmentTypeInput(value as GoalAdjustmentType);
              }}
              buttons={[
                { value: "kcal", label: "kcal/day" },
                { value: "percent", label: "%/week" },
              ]}
              style={[
                styles.segmentedControl,
                { backgroundColor: theme.colors.elevation.level2 },
              ]}
              theme={segmentedButtonsTheme}
            />

            <View style={styles.goalAdjustChipRow}>
              {(goalAdjustmentTypeInput === "percent"
                ? [0.25, 0.5, 0.75, 1]
                : [250, 500, 750, 1000]
              ).map((value) => {
                const normalizedText =
                  goalAdjustmentTypeInput === "percent"
                    ? String(value)
                    : String(Math.round(value));
                const isSelected =
                  goalAdjustmentTypeInput === "percent"
                    ? Math.abs(
                        (parseNumberInput(goalPercentInput) ?? NaN) - value,
                      ) < 0.001
                    : String(value) === goalAdjustmentInput.trim();
                return (
                  <Chip
                    key={`goal-adj-${normalizedText}`}
                    selected={isSelected}
                    showSelectedCheck={false}
                    onPress={() => {
                      if (goalAdjustmentTypeInput === "percent") {
                        setGoalPercentInput(String(value));
                      } else {
                        setGoalAdjustmentInput(String(value));
                      }
                    }}
                    mode={isSelected ? "flat" : "outlined"}
                    style={
                      isSelected
                        ? { backgroundColor: theme.colors.primary }
                        : { borderColor: theme.colors.outlineVariant }
                    }
                    textStyle={
                      isSelected
                        ? { color: theme.colors.onPrimary, fontWeight: "800" }
                        : {
                            color: theme.colors.onSurfaceVariant,
                            fontWeight: "600",
                          }
                    }
                  >
                    {goalAdjustmentTypeInput === "percent"
                      ? `${value}%`
                      : value}
                  </Chip>
                );
              })}
            </View>

            <TextInput
              label={
                goalAdjustmentTypeInput === "percent"
                  ? "Adjustment (% body weight/week)"
                  : "Adjustment (kcal/day)"
              }
              value={
                goalAdjustmentTypeInput === "percent"
                  ? goalPercentInput
                  : goalAdjustmentInput
              }
              onChangeText={(value) => {
                if (goalAdjustmentTypeInput === "percent") {
                  setGoalPercentInput(value);
                } else {
                  setGoalAdjustmentInput(value);
                }
              }}
              keyboardType="numeric"
              mode="outlined"
              placeholder={
                goalAdjustmentTypeInput === "percent" ? "1.0" : "500"
              }
            />

            <Button
              mode="outlined"
              onPress={() => {
                const adjustmentType = goalAdjustmentTypeInput;
                const parsedKcal = parseNumberInput(goalAdjustmentInput);
                const parsedPercent = parseNumberInput(goalPercentInput);
                if (adjustmentType === "kcal") {
                  if (!parsedKcal || parsedKcal < 50 || parsedKcal > 1500) {
                    m3Alert.alert(
                      "Invalid adjustment",
                      "Enter goal adjustment between 50 and 1500 kcal.",
                    );
                    return;
                  }
                  const normalizedKcal = Math.round(parsedKcal);
                  setGoalAdjustmentInput(String(normalizedKcal));
                  setData((prev) =>
                    goalAdjustmentEditorPhase === "cut"
                      ? {
                          ...prev,
                          cutAdjustmentType: "kcal",
                          cutCalorieAdjustment: normalizedKcal,
                        }
                      : {
                          ...prev,
                          bulkAdjustmentType: "kcal",
                          bulkCalorieAdjustment: normalizedKcal,
                        },
                  );
                } else {
                  if (
                    !parsedPercent ||
                    parsedPercent < 0.1 ||
                    parsedPercent > 3
                  ) {
                    m3Alert.alert(
                      "Invalid percentage",
                      "Enter weekly change between 0.1% and 3.0%.",
                    );
                    return;
                  }
                  const normalizedPercent = roundTo(parsedPercent, 2);
                  setGoalPercentInput(String(normalizedPercent));
                  setData((prev) =>
                    goalAdjustmentEditorPhase === "cut"
                      ? {
                          ...prev,
                          cutAdjustmentType: "percent",
                          cutPercentPerWeek: normalizedPercent,
                        }
                      : {
                          ...prev,
                          bulkAdjustmentType: "percent",
                          bulkPercentPerWeek: normalizedPercent,
                        },
                  );
                }
                setGoalAdjustmentPickerVisible(false);
              }}
            >
              Done
            </Button>
          </Pressable>
        </Pressable>
      </Modal>
      {m3Alert.alertDialog}
      <Snackbar
        visible={savedSnackbarVisible}
        onDismiss={() => setSavedSnackbarVisible(false)}
        duration={2000}
        style={{ backgroundColor: theme.colors.primaryContainer }}
      >
        <Text style={{ color: theme.colors.onPrimaryContainer }}>
          Settings saved
        </Text>
      </Snackbar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 16, gap: 16 },
  card: { borderRadius: 24 },
  formArea: { gap: 4, paddingBottom: 8 },
  segmentedControl: {
    borderRadius: 14,
    overflow: "hidden",
  },
  supportingText: {},
  sexRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 6,
  },
  sexOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  activityRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  activityChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  goalModeLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  goalModeRow: {
    flexDirection: "row",
    gap: 8,
  },
  goalModeButtonWrap: {
    flex: 1,
    position: "relative",
  },
  goalModeButton: {
    flex: 1,
  },
  goalModeConfigBadge: {
    position: "absolute",
    bottom: -4,
    right: -4,
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  goalModeConfigIcon: {
    position: "absolute",
    bottom: 4,
    right: 4,
  },
  goalAdjustChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  macroGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  macroInput: { minWidth: "47%", flexGrow: 1 },
  heightRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
    minHeight: 56,
  },
  heightFtInputsRow: {
    flexDirection: "row",
    gap: 8,
  },
  heightFtInput: {
    flex: 0.55,
  },
  heightInInput: {
    flex: 0.45,
  },
  clearRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  bodyFatRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
    minHeight: 56,
  },
  weightRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
    minHeight: 56,
  },
  toggleOuter: {
    width: 60,
    height: 34,
    borderRadius: 19,
    justifyContent: "center",
    marginRight: 2,
    position: "relative",
    overflow: "hidden",
  },
  togglePill: {
    position: "absolute",
    top: 4,
    width: 28,
    height: 26,
    borderRadius: 15,
    zIndex: 1,
  },
  toggleLabelRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    width: "100%",
    height: "100%",
  },
  toggleLabel: {
    fontWeight: "700",
    fontSize: 13,
    zIndex: 2,
    width: 28,
    textAlign: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    borderRadius: 20,
    padding: 14,
    gap: 10,
    maxHeight: "80%",
  },
});
