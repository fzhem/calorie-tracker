import { useFocusEffect } from "expo-router/react-navigation";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getLocalDateKey, parseAppDate, toLocalISOString } from "@/lib/dateKey";
import {
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  ToastAndroid,
  View,
  Vibration,
} from "react-native";
import {
  Button,
  Card,
  Chip,
  IconButton,
  ProgressBar,
  SegmentedButtons,
  Surface,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import { useM3Alert } from "@/ui/m3Alert";
import { getAppSegmentedButtonsTheme } from "@/ui/segmentedButtons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getAdjustedCalorieTarget,
  getAutoMacroTargets,
} from "@/domain/metabolism";
import { getMacroCalorieMismatch } from "@/domain/fibreCalories";
import {
  clearModelCache,
  getModelInstance,
  subscribeModelCache,
  getModelKeySnapshot,
} from "@/lib/modelCache";
import { checkModelMemory } from "@/lib/memoryUtils";
import {
  detectArchitecture,
  isLiteRTSupported,
  getArchitectureLabel,
  isBackendSupported,
  getBackendUnsupportedReason,
  type DeviceArchitecture,
} from "@/lib/architectureUtils";
import {
  DEFAULT_DATA,
  DEFAULT_MODEL_CONFIG,
  getCachedData,
  loadStoredData,
  saveStoredData,
} from "@/data/storage";
import type { StoredData } from "@/data/storage";
import type { Meal } from "@/db/index";

import {
  MAX_VISIBLE_ENTRIES,
  MAX_FAVOURITE_QUICK_ADDS,
  LOG_ENTRY_MAX_WIDTH,
} from "@/constants";

import {
  insertMeal,
  getMealsForDay,
  deleteMeal,
  updateMeal,
  getLatestWeightBySource,
  getLatestBodyFatBySource,
  insertRecipe,
  getAllRecipes,
  deleteRecipe,
  updateRecipe,
  type Recipe,
  type RecipeItem,
} from "@/db/index";
import { makeMealId } from "@/db/helpers";
import { invalidateMealCaches } from "@/lib/queryCache";
import {
  scaleRecipeItem,
  sumScaledRecipe,
  portionFactor,
  rescaleByGrams,
  roundTo,
  SCALE_DECIMALS,
} from "@/lib/recipeScale";
import {
  ensureModelLoaded,
  sendMessage,
  buildModelKey,
} from "@/lib/modelLoader";

export type NutritionResult = {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fibre: number;
  raw: string;
};

type LLMEstimateItem = {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fibre: number;
};

type LLMEstimatePayload = {
  items: LLMEstimateItem[];
};

type LLMRunStage = "idle" | "loading-model" | "estimating";

// Utility to get model path and system prompt from storage (async)
async function getModelConfig() {
  const stored = await loadStoredData();
  return {
    modelPath: stored.modelPath,
    systemPrompt: stored.systemPrompt,
  };
}

type QuickAddItem = {
  title: string;
  calories: number;
  proteinGrams?: number | null;
  fatGrams?: number | null;
  carbsGrams?: number | null;
  fibreGrams?: number | null;
};

type SortMode = "newest" | "oldest";
type QuickAddTab = "recent" | "favourites";

type EditEntryDraft = {
  id: string;
  title: string;
  calories: string;
  protein: string;
  fat: string;
  carbs: string;
  fibre: string;
};

type EditRecipeItemDraft = {
  title: string;
  calories: string;
  protein: string;
  fat: string;
  carbs: string;
  fibre: string;
  grams: string;
};

function formatDisplayDate(value: string) {
  return parseAppDate(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function parseNumberInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Round to 1 decimal place to avoid floating-point display artifacts
 *  (e.g. summed recipe carbs showing as 43.50000000000001). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Short summary of a recipe's items: the top 3 by calories (descending),
 *  with a "+N more" suffix when there are additional items. */
function summarizeRecipeItems(items: RecipeItem[]): string {
  const sorted = [...items].sort((a, b) => b.calories - a.calories);
  const top = sorted.slice(0, 3).map((i) => i.title);
  const extra = sorted.length - top.length;
  const summary = top.join(", ");
  return extra > 0 ? `${summary}  +${extra} more` : summary;
}

function quickAddKey(item: QuickAddItem) {
  return `${item.title.toLowerCase()}-${item.calories}-${item.proteinGrams ?? ""}-${item.fatGrams ?? ""}-${item.carbsGrams ?? ""}-${item.fibreGrams ?? ""}`;
}

function formatMacroLine(item: {
  proteinGrams?: number | null;
  fatGrams?: number | null;
  carbsGrams?: number | null;
  fibreGrams?: number | null;
}) {
  const parts = [
    typeof item.proteinGrams === "number" ? `P ${item.proteinGrams}g` : null,
    typeof item.carbsGrams === "number" ? `C ${item.carbsGrams}g` : null,
    typeof item.fatGrams === "number" ? `F ${item.fatGrams}g` : null,
    typeof item.fibreGrams === "number" ? `Fib ${item.fibreGrams}g` : null,
  ].filter((value): value is string => !!value);
  return parts.join("  ");
}

const FIBRE_GRAMS_PER_1000_KCAL = 14;
const QUICK_LOG_INPUT_THEME = { animation: { scale: 0 } };

type QuickLogCardProps = {
  recentQuickAdds: QuickAddItem[];
  favouriteQuickAdds: QuickAddItem[];
  favouriteQuickAddKeys: Set<string>;
  isMacrosExpanded: boolean;
  onSetMacrosExpanded: (next: boolean) => void;
  onAddMeal: (item: QuickAddItem) => void;
  onQuickAddMeal: (item: QuickAddItem) => void;
  onToggleFavouriteQuickAdd: (item: QuickAddItem) => void;
  onOpenLlmEstimator: () => void;
  data: StoredData;
  isModelBlocked?: boolean;
  isModelWarning?: boolean;
  memoryUsagePercent?: number;
};

const QuickLogCard = memo(function QuickLogCard({
  recentQuickAdds,
  favouriteQuickAdds,
  favouriteQuickAddKeys,
  isMacrosExpanded,
  onSetMacrosExpanded,
  onAddMeal,
  onQuickAddMeal,
  onToggleFavouriteQuickAdd,
  onOpenLlmEstimator,
  data,
  isModelBlocked,
  isModelWarning,
  memoryUsagePercent,
}: QuickLogCardProps) {
  const theme = useTheme();
  const segmentedButtonsTheme = useMemo(
    () => getAppSegmentedButtonsTheme(theme),
    [
      theme.colors.onPrimaryContainer,
      theme.colors.outlineVariant,
      theme.colors.primaryContainer,
    ],
  );
  const [mealTitle, setMealTitle] = useState("");
  const [mealCalories, setMealCalories] = useState("");
  const [mealProtein, setMealProtein] = useState("");
  const [mealFat, setMealFat] = useState("");
  const [mealCarbs, setMealCarbs] = useState("");
  const [mealFibre, setMealFibre] = useState("");
  const [mealMultiplier, setMealMultiplier] = useState("1"); // New state for multiplier
  const [quickAddTab, setQuickAddTab] = useState<QuickAddTab>("favourites");

  const activeQuickAdds =
    quickAddTab === "favourites" ? favouriteQuickAdds : recentQuickAdds;

  const m3Alert = useM3Alert();
  const addDraftMismatch = useMemo(() => {
    const calories = parseNumberInput(mealCalories);
    if (!calories || calories <= 0) return null;
    return getMacroCalorieMismatch(
      Math.round(calories),
      {
        proteinGrams: mealProtein.trim() ? parseNumberInput(mealProtein) : null,
        fatGrams: mealFat.trim() ? parseNumberInput(mealFat) : null,
        carbsGrams: mealCarbs.trim() ? parseNumberInput(mealCarbs) : null,
        fibreGrams: mealFibre.trim() ? parseNumberInput(mealFibre) : null,
      },
      {
        approach: data.fibreCalorieApproach,
        tolerancePercent: data.calorieTolerancePercent,
      },
    );
  }, [
    mealCalories,
    mealCarbs,
    mealFat,
    mealProtein,
    mealFibre,
    data.fibreCalorieApproach,
    data.calorieTolerancePercent,
  ]);

  const handleAddMeal = useCallback(() => {
    const multiplier = parseNumberInput(mealMultiplier);
    if (!multiplier || multiplier <= 0) {
      m3Alert.alert(
        "Invalid multiplier",
        "Multiplier must be a positive number.",
      );
      return;
    }

    const calories = parseNumberInput(mealCalories);
    const protein = mealProtein.trim() ? parseNumberInput(mealProtein) : null;
    const fat = mealFat.trim() ? parseNumberInput(mealFat) : null;
    const carbs = mealCarbs.trim() ? parseNumberInput(mealCarbs) : null;
    const fibre = mealFibre.trim() ? parseNumberInput(mealFibre) : null;

    if (!mealTitle.trim()) {
      m3Alert.alert("Missing meal name", "Add a label.");
      return;
    }
    if (!calories || calories <= 0) {
      m3Alert.alert("Invalid calories", "Enter a positive number.");
      return;
    }
    if (protein !== null && protein < 0) {
      m3Alert.alert("Invalid protein", "Protein must be 0 or more.");
      return;
    }
    if (fat !== null && fat < 0) {
      m3Alert.alert("Invalid fat", "Fat must be 0 or more.");
      return;
    }
    if (carbs !== null && carbs < 0) {
      m3Alert.alert("Invalid carbs", "Carbs must be 0 or more.");
      return;
    }
    if (fibre !== null && fibre < 0) {
      m3Alert.alert("Invalid fibre", "Fibre must be 0 or more.");
      return;
    }

    onAddMeal({
      title: mealTitle.trim(),
      calories: Math.round(calories * multiplier),
      proteinGrams:
        protein !== null ? Math.round(protein * multiplier * 10) / 10 : null,
      fatGrams: fat !== null ? Math.round(fat * multiplier * 10) / 10 : null,
      carbsGrams:
        carbs !== null ? Math.round(carbs * multiplier * 10) / 10 : null,
      fibreGrams:
        fibre !== null ? Math.round(fibre * multiplier * 10) / 10 : null,
    });

    setMealTitle("");
    setMealCalories("");
    setMealProtein("");
    setMealFat("");
    setMealCarbs("");
    setMealFibre("");
    setMealMultiplier("1"); // Reset multiplier
    Vibration.vibrate(12);
  }, [
    mealCalories,
    mealCarbs,
    mealFat,
    mealFibre,
    mealMultiplier,
    mealProtein,
    mealTitle,
    onAddMeal,
  ]);

  return (
    <Card style={styles.card} mode="elevated">
      <Card.Title
        title="Quick Log"
        titleVariant="titleLarge"
        style={styles.quickLogHeader}
        titleStyle={styles.quickLogTitle}
        right={() => (
          <View style={styles.quickLogLlmButtonContainer}>
            {isModelWarning && !isModelBlocked && (
              <View
                style={[
                  styles.memoryStatusBadge,
                  { backgroundColor: theme.colors.tertiary },
                ]}
              >
                <MaterialCommunityIcons
                  name="alert"
                  size={10}
                  color={theme.colors.onTertiary}
                />
                <Text
                  style={[
                    styles.memoryStatusText,
                    { color: theme.colors.onTertiary },
                  ]}
                >
                  {memoryUsagePercent}% RAM
                </Text>
              </View>
            )}
            {isModelBlocked && (
              <View
                style={[
                  styles.memoryStatusBadge,
                  { backgroundColor: theme.colors.errorContainer },
                ]}
              >
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={10}
                  color={theme.colors.error}
                />
                <Text
                  style={[
                    styles.memoryStatusText,
                    { color: theme.colors.error },
                  ]}
                >
                  Blocked
                </Text>
              </View>
            )}
            <Button
              mode={isModelBlocked ? "contained-tonal" : "outlined"}
              compact
              icon={isModelBlocked ? "lock" : "robot"}
              onPress={onOpenLlmEstimator}
              disabled={isModelBlocked}
              style={styles.quickLogLlmButton}
              contentStyle={styles.quickLogLlmButtonContent}
            >
              Estimate Meal
            </Button>
          </View>
        )}
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
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
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
          style={({ pressed }) => [
            styles.macroSectionHeader,
            {
              backgroundColor: pressed
                ? theme.colors.elevation.level3
                : theme.colors.elevation.level1,
              borderColor: pressed
                ? theme.colors.primary
                : theme.colors.outlineVariant,
            },
          ]}
        >
          <View style={styles.macroSectionTitle}>
            <MaterialCommunityIcons
              name="nutrition"
              size={16}
              color={theme.colors.primary}
            />
            <Text
              variant="labelLarge"
              style={{ color: theme.colors.onSurface }}
            >
              Macros
            </Text>
            <Chip
              compact
              mode="flat"
              style={{ backgroundColor: theme.colors.surfaceVariant }}
              textStyle={{ color: theme.colors.onSurfaceVariant }}
            >
              Optional
            </Chip>
          </View>
          <MaterialCommunityIcons
            name={isMacrosExpanded ? "chevron-up" : "chevron-down"}
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
                value={mealFibre}
                onChangeText={setMealFibre}
                placeholder="8"
                keyboardType="numeric"
                mode="outlined"
                style={styles.macroInput}
                theme={QUICK_LOG_INPUT_THEME}
              />
            </View>
            {addDraftMismatch ? (
              <View style={styles.mismatchRow}>
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={14}
                  color={theme.colors.error}
                />
                <Text variant="bodySmall" style={{ color: theme.colors.error }}>
                  Macros estimate about {addDraftMismatch.macroCalories} kcal,
                  which differs from logged calories.
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
        <Button mode="contained" icon="plus" onPress={handleAddMeal}>
          Add entry
        </Button>
        {recentQuickAdds.length || favouriteQuickAdds.length ? (
          <View style={styles.quickAddSection}>
            <SegmentedButtons
              value={quickAddTab}
              onValueChange={(value) => setQuickAddTab(value as QuickAddTab)}
              buttons={[
                { value: "favourites", label: "Favourites", icon: "star" },
                { value: "recent", label: "Recents", icon: "history" },
              ]}
              style={[
                styles.segmentedControl,
                { backgroundColor: theme.colors.elevation.level2 },
              ]}
              theme={segmentedButtonsTheme}
            />
            {activeQuickAdds.length ? (
              <View>
                <View
                  style={[
                    styles.quickAddScrollFrame,
                    { borderColor: theme.colors.outlineVariant },
                  ]}
                >
                  <ScrollView
                    style={styles.quickAddScroll}
                    showsVerticalScrollIndicator={false}
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={styles.quickAddRow}
                  >
                    {activeQuickAdds.map((item) => {
                      const key = quickAddKey(item);
                      const isFavourite = favouriteQuickAddKeys.has(key);
                      return (
                        <View key={key} style={styles.quickAddItem}>
                          <Chip
                            icon="plus"
                            compact
                            onPress={() => onQuickAddMeal(item)}
                          >
                            {item.title} ({item.calories})
                          </Chip>
                          <IconButton
                            icon={isFavourite ? "star" : "star-outline"}
                            size={18}
                            iconColor={theme.colors.tertiary}
                            onPress={() => onToggleFavouriteQuickAdd(item)}
                            accessibilityLabel={
                              isFavourite ? "Remove favourite" : "Add favourite"
                            }
                          />
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
                {activeQuickAdds.length > 3 ? (
                  <View style={styles.quickAddScrollHint}>
                    <MaterialCommunityIcons
                      name="chevron-double-down"
                      size={14}
                      color={theme.colors.onSurfaceVariant}
                    />
                    <Text
                      variant="labelSmall"
                      style={{ color: theme.colors.onSurfaceVariant }}
                    >
                      Scroll for more
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <Text
                variant="bodyMedium"
                style={{ color: theme.colors.onSurfaceVariant }}
              >
                No favourites yet. Star an item from Recents.
              </Text>
            )}
          </View>
        ) : null}
      </Card.Content>
      {m3Alert.alertDialog}
    </Card>
  );
});

export default function LogScreen() {
  // LLM prompt state
  const [llmPrompt, setLlmPrompt] = useState("");
  const [llmResult, setLlmResult] = useState<string | null>(null);
  const [llmError, setLlmError] = useState("");
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmStage, setLlmStage] = useState<LLMRunStage>("idle");
  const [llmStageStartedAt, setLlmStageStartedAt] = useState<number | null>(
    null,
  );
  const [llmStageElapsedSec, setLlmStageElapsedSec] = useState(0);
  const [modelPath, setModelPath] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string>("");

  // Device architecture state
  const [deviceArchitecture, setDeviceArchitecture] =
    useState<DeviceArchitecture | null>(null);

  // Load modelPath and systemPrompt from storage on mount
  useEffect(() => {
    getModelConfig().then(({ modelPath, systemPrompt }) => {
      setModelPath(modelPath);
      setSystemPrompt(systemPrompt);
    });
  }, []);

  // Detect device architecture on mount
  useEffect(() => {
    setDeviceArchitecture(detectArchitecture());
  }, []);

  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      getModelConfig()
        .then(
          ({ modelPath: nextModelPath, systemPrompt: nextSystemPrompt }) => {
            if (!isActive) return;
            const changed =
              nextModelPath !== modelPath || nextSystemPrompt !== systemPrompt;
            setModelPath(nextModelPath);
            setSystemPrompt(nextSystemPrompt);
            if (changed) {
              clearModelCache();
              // Clear stale errors from a previous estimation attempt.
              // The model may have been unloaded by a backend switch in Settings,
              // so an old "Failed to load model" error is no longer relevant.
              setLlmError("");
            }
          },
        )
        .catch(() => {
          if (!isActive) return;
          setLlmError("Could not refresh LLM model settings.");
        });

      return () => {
        isActive = false;
      };
    }, [modelPath, systemPrompt]),
  );

  // Model instance cache — backed by module-level singleton so Settings can observe it
  const loadedModelKey = useSyncExternalStore(
    subscribeModelCache,
    getModelKeySnapshot,
  );

  // Evict model from JS cache when app goes to background so a stale native reference
  // can't crash the app on resume. The model will be re-loaded on the next run.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") {
        clearModelCache();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!llmLoading || !llmStageStartedAt) {
      setLlmStageElapsedSec(0);
      return;
    }

    const timer = setInterval(() => {
      setLlmStageElapsedSec(
        Math.max(0, Math.floor((Date.now() - llmStageStartedAt) / 1000)),
      );
    }, 500);

    return () => clearInterval(timer);
  }, [llmLoading, llmStageStartedAt]);

  const beginLlmStage = (stage: LLMRunStage) => {
    setLlmStage(stage);
    setLlmStageStartedAt(Date.now());
    setLlmStageElapsedSec(0);
  };

  const handleLlmPrompt = async () => {
    const backend = data.inferenceBackend ?? "litert";
    if (
      !deviceArchitecture ||
      !isBackendSupported(backend, deviceArchitecture)
    ) {
      setLlmError(
        deviceArchitecture
          ? getBackendUnsupportedReason(backend, deviceArchitecture)
          : "Checking device architecture compatibility. Please try again.",
      );
      setLlmLoading(false);
      setLlmStage("idle");
      setLlmStageStartedAt(null);
      return;
    }

    setLlmLoading(true);
    beginLlmStage("estimating");
    setLlmError("");
    setLlmResult(null);
    const resolveModelPath =
      data.estimateModelPath ?? data.modelPath ?? modelPath;
    if (!resolveModelPath) {
      setLlmError("No model file selected in settings.");
      setLlmLoading(false);
      setLlmStage("idle");
      setLlmStageStartedAt(null);
      return;
    }
    const resolvedCleanedPath = resolveModelPath.startsWith("file:///")
      ? resolveModelPath.replace("file:///", "/")
      : resolveModelPath;

    // Check if model file exists before loading
    try {
      const { File } = await import("expo-file-system");
      const fileForCheck = new File(resolveModelPath);
      if (!fileForCheck.exists) {
        const fileName = fileForCheck.uri.split("/").pop();
        setLlmError(
          `Model file not found: ${fileName}. Please select or download a model in settings.`,
        );
        setLlmLoading(false);
        setLlmStage("idle");
        setLlmStageStartedAt(null);
        return;
      }
    } catch (e) {
      // If file check fails, fallback to old error
      setLlmError("Could not check model file existence.");
      setLlmLoading(false);
      setLlmStage("idle");
      setLlmStageStartedAt(null);
      return;
    }

    const modelConfig =
      data.perModelConfig?.[resolvedCleanedPath] ?? DEFAULT_MODEL_CONFIG;
    try {
      beginLlmStage("loading-model");
      await ensureModelLoaded({
        modelPath: resolvedCleanedPath,
        systemPrompt,
        modelConfig,
        inferenceBackend: backend,
      });
    } catch (err) {
      setLlmError("Failed to load model: " + err);
      setLlmLoading(false);
      setLlmStage("idle");
      setLlmStageStartedAt(null);
      return;
    }
    // Re-acquire after loading (already cached by ensureModelLoaded)
    const model = getModelInstance();
    if (!model) {
      setLlmError("Model instance not available after loading.");
      setLlmLoading(false);
      setLlmStage("idle");
      setLlmStageStartedAt(null);
      return;
    }
    try {
      const response = await sendMessage(model, llmPrompt);
      beginLlmStage("estimating");
      setLlmResult(response);
    } catch (err) {
      setLlmError(`Failed to run model. ${err}`);
    } finally {
      setLlmLoading(false);
      setLlmStage("idle");
      setLlmStageStartedAt(null);
    }
  };
  const m3Alert = useM3Alert();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [data, setData] = useState<StoredData>(
    () => getCachedData() ?? DEFAULT_DATA,
  );

  const todayKey = getLocalDateKey(new Date());
  const [entries, setEntries] = useState<Meal[]>([]);
  const [latestHCWeightKg, setLatestHCWeightKg] = useState<number | null>(null);
  const [latestHCBodyFatPercent, setLatestHCBodyFatPercent] = useState<
    number | null
  >(null);
  const [isReady, setIsReady] = useState(false);
  const hasCompletedInitialLoad = useRef(false);
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [macroModalVisible, setMacroModalVisible] = useState(false);
  const [editDraft, setEditDraft] = useState<EditEntryDraft | null>(null);
  const [showEditMacros, setShowEditMacros] = useState(false);
  const [llmModalVisible, setLlmModalVisible] = useState(false);

  // ── Recipe state ──────────────────────────────────────────────
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeModalVisible, setRecipeModalVisible] = useState(false);
  const [createRecipeModalVisible, setCreateRecipeModalVisible] =
    useState(false);
  const [createRecipeName, setCreateRecipeName] = useState("");
  const [createRecipeUrl, setCreateRecipeUrl] = useState("");
  const [createRecipeServings, setCreateRecipeServings] = useState("1");
  const [selectedRecipeItems, setSelectedRecipeItems] = useState<
    QuickAddItem[]
  >([]);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(
    new Set(),
  );

  useEffect(() => {
    loadStoredData()
      .then((next) => setData(next))
      .catch(() =>
        m3Alert.alert("Storage error", "Saved data could not be loaded."),
      )
      .finally(() => {
        hasCompletedInitialLoad.current = true;
        setIsReady(true);
      });
    // Load recipes on initial mount (useFocusEffect only runs after focus changes)
    getAllRecipes()
      .then(setRecipes)
      .catch(() => {});
  }, []);

  // Load today's entries from DB
  useEffect(() => {
    if (!isReady) return;
    getMealsForDay(todayKey)
      .then(setEntries)
      .catch(() => {});
  }, [isReady, todayKey]);

  // Load latest health-connect weight for calorie target calculation
  useEffect(() => {
    if (!isReady) return;
    getLatestWeightBySource("health-connect")
      .then((point) => setLatestHCWeightKg(point?.weightKg ?? null))
      .catch(() => {});
  }, [isReady]);

  // Load latest health-connect body fat for calorie target calculation
  useEffect(() => {
    if (!isReady) return;
    getLatestBodyFatBySource("health-connect")
      .then((point) =>
        setLatestHCBodyFatPercent(point?.bodyFatPercentage ?? null),
      )
      .catch(() => {});
  }, [isReady]);

  useFocusEffect(
    useCallback(() => {
      if (!hasCompletedInitialLoad.current) return;
      loadStoredData()
        .then((next) => setData(next))
        .catch(() =>
          m3Alert.alert("Storage error", "Saved data could not be loaded."),
        );
      // Refresh today's entries from DB on focus
      const key = getLocalDateKey(new Date());
      getMealsForDay(key)
        .then(setEntries)
        .catch(() => {});
      // Refresh saved recipes
      getAllRecipes()
        .then(setRecipes)
        .catch(() => {});
      // Refresh HC weight and body fat so metabolism recalculates
      getLatestWeightBySource("health-connect")
        .then((point) => setLatestHCWeightKg(point?.weightKg ?? null))
        .catch(() => {});
      getLatestBodyFatBySource("health-connect")
        .then((point) =>
          setLatestHCBodyFatPercent(point?.bodyFatPercentage ?? null),
        )
        .catch(() => {});
    }, []),
  );

  // Persist settings (but not meal entries – those are in SQLite)
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

  // todayKey computed earlier above the state declarations
  const todayEntries = entries;
  const sortedTodayEntries = useMemo(() => {
    const list = [...todayEntries];
    list.sort((a, b) => {
      const aTime = parseAppDate(a.loggedAt).getTime();
      const bTime = parseAppDate(b.loggedAt).getTime();
      return sortMode === "newest" ? bTime - aTime : aTime - bTime;
    });
    return list;
  }, [sortMode, todayEntries]);
  const recentQuickAdds = useMemo(() => {
    const unique = new Map<string, QuickAddItem>();
    for (const entry of entries) {
      const key = quickAddKey({ title: entry.title, calories: entry.calories });
      if (!unique.has(key)) {
        unique.set(key, {
          title: entry.title,
          calories: entry.calories,
          proteinGrams: entry.proteinGrams ?? null,
          fatGrams: entry.fatGrams ?? null,
          carbsGrams: entry.carbsGrams ?? null,
          fibreGrams: entry.fibreGrams ?? null,
        });
      }
      if (unique.size >= 8) break;
    }
    return Array.from(unique.values());
  }, [entries]);
  const favouriteQuickAdds = useMemo(
    () => data.favouriteQuickAdds ?? [],
    [data.favouriteQuickAdds],
  );
  const favouriteQuickAddKeys = useMemo(
    () => new Set(favouriteQuickAdds.map(quickAddKey)),
    [favouriteQuickAdds],
  );
  const visibleEntries = useMemo(
    () => sortedTodayEntries.slice(0, MAX_VISIBLE_ENTRIES),
    [sortedTodayEntries],
  );
  const todayCalories = todayEntries.reduce((sum, e) => sum + e.calories, 0);
  const { adjustedTarget, goalDelta, metabolism } = useMemo(
    () =>
      getAdjustedCalorieTarget(data, latestHCWeightKg, latestHCBodyFatPercent),
    [data, latestHCWeightKg, latestHCBodyFatPercent],
  );
  const remaining = adjustedTarget - todayCalories;
  const progress = Math.min(todayCalories / Math.max(adjustedTarget, 1), 1);

  const autoMacroTargets = useMemo(
    () => getAutoMacroTargets(adjustedTarget, data.goalPhase ?? "maintain"),
    [adjustedTarget, data.goalPhase],
  );

  // Calculate macro totals
  const todayTotalProtein = todayEntries.reduce(
    (sum, e) => sum + (e.proteinGrams ?? 0),
    0,
  );
  const todayTotalFat = todayEntries.reduce(
    (sum, e) => sum + (e.fatGrams ?? 0),
    0,
  );
  const todayTotalCarbs = todayEntries.reduce(
    (sum, e) => sum + (e.carbsGrams ?? 0),
    0,
  );
  const todayTotalFibre = todayEntries.reduce(
    (sum, e) => sum + (e.fibreGrams ?? 0),
    0,
  );

  const proteinGoal = data.proteinGoalGrams ?? autoMacroTargets.proteinGrams;
  const fatGoal = data.fatGoalGrams ?? autoMacroTargets.fatGrams;
  const carbsGoal = data.carbsGoalGrams ?? autoMacroTargets.carbsGrams;
  const fibreGoal =
    data.fibreGoalGrams ??
    Math.max(
      0,
      Math.round((adjustedTarget / 1000) * FIBRE_GRAMS_PER_1000_KCAL),
    );

  const proteinProgress = proteinGoal
    ? Math.min(todayTotalProtein / proteinGoal, 1)
    : 0;
  const fatProgress = fatGoal ? Math.min(todayTotalFat / fatGoal, 1) : 0;
  const carbsProgress = carbsGoal
    ? Math.min(todayTotalCarbs / carbsGoal, 1)
    : 0;
  const fibreProgress = fibreGoal
    ? Math.min(todayTotalFibre / fibreGoal, 1)
    : 0;

  const hasMacroGoals = proteinGoal > 0 || fatGoal > 0 || carbsGoal > 0;

  const editDraftMismatch = useMemo(() => {
    if (!editDraft) return null;
    const calories = parseNumberInput(editDraft.calories);
    if (!calories || calories <= 0) return null;
    return getMacroCalorieMismatch(
      Math.round(calories),
      {
        proteinGrams: editDraft.protein.trim()
          ? parseNumberInput(editDraft.protein)
          : null,
        fatGrams: editDraft.fat.trim() ? parseNumberInput(editDraft.fat) : null,
        carbsGrams: editDraft.carbs.trim()
          ? parseNumberInput(editDraft.carbs)
          : null,
        fibreGrams: editDraft.fibre.trim()
          ? parseNumberInput(editDraft.fibre)
          : null,
      },
      {
        approach: data.fibreCalorieApproach,
        tolerancePercent: data.calorieTolerancePercent,
      },
    );
  }, [editDraft, data.fibreCalorieApproach, data.calorieTolerancePercent]);

  const macroGoalModeIcon =
    data.proteinGoalGrams !== null ||
    data.carbsGoalGrams !== null ||
    data.fatGoalGrams !== null ||
    data.fibreGoalGrams !== null
      ? "tune"
      : "brightness-auto";
  const macroGoalModeText =
    data.proteinGoalGrams !== null ||
    data.carbsGoalGrams !== null ||
    data.fatGoalGrams !== null ||
    data.fibreGoalGrams !== null
      ? "Custom macro targets"
      : "Auto macro targets";

  const activeGoalAdjustmentType =
    data.goalPhase === "cut"
      ? (data.cutAdjustmentType ?? "kcal")
      : data.goalPhase === "bulk"
        ? (data.bulkAdjustmentType ?? "kcal")
        : "kcal";
  const goalModeLabel =
    data.goalPhase === "cut"
      ? "Cut"
      : data.goalPhase === "bulk"
        ? "Bulk"
        : "Maintain";
  const goalModeIcon =
    data.goalPhase === "cut"
      ? "trending-down"
      : data.goalPhase === "bulk"
        ? "trending-up"
        : "target";
  const goalModeTint =
    data.goalPhase === "cut"
      ? theme.colors.error
      : data.goalPhase === "bulk"
        ? theme.colors.primary
        : theme.colors.secondary;
  const goalModeBg =
    data.goalPhase === "cut"
      ? theme.colors.errorContainer
      : data.goalPhase === "bulk"
        ? theme.colors.primaryContainer
        : theme.colors.secondaryContainer;
  const goalModeOnBg =
    data.goalPhase === "cut"
      ? theme.colors.onErrorContainer
      : data.goalPhase === "bulk"
        ? theme.colors.onPrimaryContainer
        : theme.colors.onSecondaryContainer;
  const goalModeDetail =
    data.goalPhase === "maintain"
      ? ""
      : activeGoalAdjustmentType === "percent"
        ? `${data.goalPhase === "cut" ? "-" : "+"}${data.goalPhase === "cut" ? (data.cutPercentPerWeek ?? 1) : (data.bulkPercentPerWeek ?? 1)}% / week`
        : `${goalDelta > 0 ? "+" : ""}${goalDelta} kcal / day`;

  const macroPalette = useMemo(
    () => ({
      protein: {
        color: theme.dark ? "#ffb27a" : "#a34a12",
        background: theme.dark ? "#4d2813" : "#ffe7d7",
      },
      carbs: {
        color: theme.dark ? "#ffd56e" : "#976700",
        background: theme.dark ? "#4c3902" : "#fff0c5",
      },
      fat: {
        color: theme.dark ? "#8fc8ff" : "#1c5f97",
        background: theme.dark ? "#1b3550" : "#dbeeff",
      },
      fibre: {
        color: theme.dark ? "#96e0a0" : "#257536",
        background: theme.dark ? "#1b3921" : "#dff4e2",
      },
    }),
    [theme.dark],
  );

  const addMeal = useCallback((item: QuickAddItem) => {
    const now = toLocalISOString(new Date());
    const meal = {
      id: makeMealId({
        loggedAt: now,
        title: item.title,
        calories: item.calories,
      }),
      title: item.title,
      calories: item.calories,
      proteinGrams: item.proteinGrams ?? null,
      fatGrams: item.fatGrams ?? null,
      carbsGrams: item.carbsGrams ?? null,
      fibreGrams: item.fibreGrams ?? null,
      loggedAt: now,
    };
    insertMeal(meal).catch(() => {});
    invalidateMealCaches();
    setEntries((prev) => [meal, ...prev]);
  }, []);

  const quickAddMeal = useCallback((item: QuickAddItem) => {
    const now = toLocalISOString(new Date());
    const meal = {
      id: makeMealId({
        loggedAt: now,
        title: item.title,
        calories: item.calories,
      }),
      title: item.title,
      calories: item.calories,
      proteinGrams: item.proteinGrams ?? null,
      fatGrams: item.fatGrams ?? null,
      carbsGrams: item.carbsGrams ?? null,
      fibreGrams: item.fibreGrams ?? null,
      loggedAt: now,
    };
    insertMeal(meal).catch(() => {});
    invalidateMealCaches();
    setEntries((prev) => [meal, ...prev]);
    Vibration.vibrate(10);
  }, []);

  const toggleEntrySelection = useCallback((id: string) => {
    setSelectedEntryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleFavouriteQuickAdd = useCallback((item: QuickAddItem) => {
    Vibration.vibrate(10);
    const key = quickAddKey(item);
    setData((prev) => {
      const current = prev.favouriteQuickAdds ?? [];
      const exists = current.some((fav) => quickAddKey(fav) === key);
      const nextFavourites = exists
        ? current.filter((fav) => quickAddKey(fav) !== key)
        : [item, ...current].slice(0, MAX_FAVOURITE_QUICK_ADDS);
      return { ...prev, favouriteQuickAdds: nextFavourites };
    });
  }, []);

  const deleteEntry = useCallback((id: string) => {
    deleteMeal(id).catch(() => {});
    invalidateMealCaches();
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const openEditEntry = useCallback((entry: Meal) => {
    Vibration.vibrate(10);
    setShowEditMacros(false);
    setEditDraft({
      id: entry.id,
      title: entry.title,
      calories: `${entry.calories}`,
      protein:
        typeof entry.proteinGrams === "number" ? `${entry.proteinGrams}` : "",
      fat: typeof entry.fatGrams === "number" ? `${entry.fatGrams}` : "",
      carbs: typeof entry.carbsGrams === "number" ? `${entry.carbsGrams}` : "",
      fibre: typeof entry.fibreGrams === "number" ? `${entry.fibreGrams}` : "",
    });
  }, []);

  const closeEditModal = useCallback(() => {
    setShowEditMacros(false);
    setEditDraft(null);
  }, []);

  const saveEditedEntry = useCallback(() => {
    if (!editDraft) return;
    const calories = parseNumberInput(editDraft.calories);
    const protein = editDraft.protein.trim()
      ? parseNumberInput(editDraft.protein)
      : null;
    const fat = editDraft.fat.trim() ? parseNumberInput(editDraft.fat) : null;
    const carbs = editDraft.carbs.trim()
      ? parseNumberInput(editDraft.carbs)
      : null;
    const fibre = editDraft.fibre.trim()
      ? parseNumberInput(editDraft.fibre)
      : null;

    if (!editDraft.title.trim()) {
      m3Alert.alert("Missing meal name", "Add a label.");
      return;
    }
    if (!calories || calories <= 0) {
      m3Alert.alert("Invalid calories", "Enter a positive number.");
      return;
    }
    if (protein !== null && protein < 0) {
      m3Alert.alert("Invalid protein", "Protein must be 0 or more.");
      return;
    }
    if (fat !== null && fat < 0) {
      m3Alert.alert("Invalid fat", "Fat must be 0 or more.");
      return;
    }
    if (carbs !== null && carbs < 0) {
      m3Alert.alert("Invalid carbs", "Carbs must be 0 or more.");
      return;
    }
    if (fibre !== null && fibre < 0) {
      m3Alert.alert("Invalid fibre", "Fibre must be 0 or more.");
      return;
    }

    const updatedEntry = {
      title: editDraft.title.trim(),
      calories: Math.round(calories),
      proteinGrams: protein !== null ? Math.round(protein * 10) / 10 : null,
      fatGrams: fat !== null ? Math.round(fat * 10) / 10 : null,
      carbsGrams: carbs !== null ? Math.round(carbs * 10) / 10 : null,
      fibreGrams: fibre !== null ? Math.round(fibre * 10) / 10 : null,
    };
    updateMeal(editDraft.id, updatedEntry).catch(() => {});
    invalidateMealCaches();
    setEntries((prev) =>
      prev.map((entry) =>
        entry.id === editDraft.id ? { ...entry, ...updatedEntry } : entry,
      ),
    );
    closeEditModal();
  }, [closeEditModal, editDraft]);

  const renderedEntries = useMemo(() => {
    return visibleEntries.map((entry) => {
      const isSelected = selectedEntryIds.has(entry.id);
      const mismatch = getMacroCalorieMismatch(entry.calories, entry, {
        approach: data.fibreCalorieApproach,
        tolerancePercent: data.calorieTolerancePercent,
      });
      const entryAsQuickAdd: QuickAddItem = {
        title: entry.title,
        calories: entry.calories,
        proteinGrams: entry.proteinGrams ?? null,
        fatGrams: entry.fatGrams ?? null,
        carbsGrams: entry.carbsGrams ?? null,
        fibreGrams: entry.fibreGrams ?? null,
      };
      const isEntryFavourite = favouriteQuickAddKeys.has(
        quickAddKey(entryAsQuickAdd),
      );

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
                <Text
                  variant="labelMedium"
                  style={{ color: theme.colors.primary, fontWeight: "700" }}
                >
                  {entry.calories} kcal
                </Text>
              </View>
            </View>
            <Text
              variant="bodySmall"
              numberOfLines={1}
              style={[
                styles.entryMeta,
                { color: theme.colors.onSurfaceVariant },
              ]}
            >
              {formatDisplayDate(entry.loggedAt)}
              {formatMacroLine(entry) ? `  •  ${formatMacroLine(entry)}` : ""}
            </Text>
            {mismatch ? (
              <View style={styles.mismatchRow}>
                <MaterialCommunityIcons
                  name="alert-circle-outline"
                  size={14}
                  color={theme.colors.error}
                />
                <Text
                  variant="bodySmall"
                  numberOfLines={1}
                  style={{ color: theme.colors.error }}
                >
                  Macros imply ~{mismatch.macroCalories} kcal.
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.entryActions}>
            <IconButton
              icon={
                selectedEntryIds.has(entry.id)
                  ? "checkbox-marked-outline"
                  : "checkbox-blank-outline"
              }
              size={18}
              iconColor={
                selectedEntryIds.has(entry.id)
                  ? theme.colors.primary
                  : theme.colors.onSurfaceVariant
              }
              style={styles.entryActionIcon}
              onPress={() => toggleEntrySelection(entry.id)}
              accessibilityLabel={
                selectedEntryIds.has(entry.id)
                  ? "Deselect entry"
                  : "Select entry for recipe"
              }
            />
            <IconButton
              icon={isEntryFavourite ? "star" : "star-outline"}
              size={18}
              iconColor={theme.colors.tertiary}
              style={styles.entryActionIcon}
              onPress={() => toggleFavouriteQuickAdd(entryAsQuickAdd)}
              accessibilityLabel={
                isEntryFavourite ? "Remove favourite" : "Add favourite"
              }
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
    favouriteQuickAddKeys,
    openEditEntry,
    selectedEntryIds,
    theme.colors.elevation.level1,
    theme.colors.error,
    theme.colors.onSurface,
    theme.colors.onSurfaceVariant,
    theme.colors.outlineVariant,
    theme.colors.primary,
    toggleEntrySelection,
    toggleFavouriteQuickAdd,
    visibleEntries,
    data.calorieTolerancePercent,
  ]);

  // Parse LLM result for use in rendering and button handler.
  // Handles three output formats:
  //   1. Markdown code block:  ```json\n{...}\n```
  //   2. Raw JSON string:      {"items":[...]}
  //   3. JSON embedded in text: some prose... {"items":[...]} ...more prose
  const llmResultParsed = useMemo<LLMEstimatePayload | null>(() => {
    if (!llmResult) return null;

    function tryParse(jsonString: string): LLMEstimatePayload | null {
      try {
        const parsed = JSON.parse(jsonString) as unknown;
        if (!parsed || typeof parsed !== "object") return null;
        const items = (parsed as { items?: unknown }).items;
        if (!Array.isArray(items)) return null;
        return { items: items as LLMEstimateItem[] };
      } catch {
        return null;
      }
    }

    // Case 1: markdown code block (```json or plain ```)
    const codeBlockMatch = llmResult.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      const result = tryParse(codeBlockMatch[1].trim());
      if (result) return result;
    }

    // Case 2: the whole string is already JSON
    const direct = tryParse(llmResult.trim());
    if (direct) return direct;

    // Case 3: JSON object embedded somewhere in the text
    const start = llmResult.indexOf("{");
    const end = llmResult.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return tryParse(llmResult.slice(start, end + 1));
    }

    return null;
  }, [llmResult]);

  const isModelInMemory = useMemo(() => {
    if (!modelPath || !loadedModelKey) return false;
    const cleanedModelPath = modelPath.startsWith("file:///")
      ? modelPath.replace("file:///", "/")
      : modelPath;
    const modelConfig =
      data.perModelConfig?.[cleanedModelPath] ?? DEFAULT_MODEL_CONFIG;
    // Reuse the exact key builder from modelLoader so this comparison stays in
    // sync with how ensureModelLoaded builds the loaded key (which includes the
    // inference backend and fully-normalized config).
    const activeModelKey = buildModelKey({
      modelPath: cleanedModelPath,
      systemPrompt,
      modelConfig,
      inferenceBackend: data.inferenceBackend ?? "litert",
    });
    return loadedModelKey === activeModelKey;
  }, [
    loadedModelKey,
    modelPath,
    systemPrompt,
    data.perModelConfig,
    data.inferenceBackend,
  ]);

  const showModelStatusHint = useCallback(() => {
    const message = isModelInMemory
      ? "Model is in memory and ready for faster responses."
      : "Model is not in memory yet. Run one estimate to load it.";
    if (Platform.OS === "android") {
      ToastAndroid.show(message, ToastAndroid.SHORT);
      return;
    }
    m3Alert.alert("Model status", message);
  }, [isModelInMemory]);

  // Determine which model key is currently selected and check if it's blocked
  const selectedModelKey = useMemo(() => {
    if (!modelPath) return null;
    const fileName = modelPath.split("/").pop() ?? "";
    if (fileName.includes("gemma-4-E2B")) return "GEMMA_4_E2B_IT";
    if (fileName.includes("gemma-4-E4B")) return "GEMMA_4_E4B_IT";
    return null;
  }, [modelPath]);

  const memoryCheck = useMemo(() => {
    if (!selectedModelKey) return null;
    return checkModelMemory(selectedModelKey);
  }, [selectedModelKey]);

  // Block model if architecture doesn't support LiteRT
  const isArchitectureBlocked = useMemo(() => {
    return (
      deviceArchitecture !== null && !isLiteRTSupported(deviceArchitecture)
    );
  }, [deviceArchitecture]);

  const isModelBlocked =
    isArchitectureBlocked || memoryCheck?.status === "blocked";
  const isModelWarning = memoryCheck?.status === "warning";

  // ── Recipe handlers ──────────────────────────────────────────
  const handleSaveAsRecipe = useCallback(() => {
    if (selectedEntryIds.size === 0) {
      m3Alert.alert(
        "No entries selected",
        "Select entries to save as a recipe.",
      );
      return;
    }
    const items: QuickAddItem[] = entries
      .filter((e) => selectedEntryIds.has(e.id))
      .map((e) => ({
        title: e.title,
        calories: e.calories,
        proteinGrams: e.proteinGrams ?? null,
        fatGrams: e.fatGrams ?? null,
        carbsGrams: e.carbsGrams ?? null,
        fibreGrams: e.fibreGrams ?? null,
      }));
    setSelectedRecipeItems(items);
    setCreateRecipeName("");
    setCreateRecipeUrl("");
    setCreateRecipeServings("1");
    setCreateRecipeModalVisible(true);
  }, [entries, selectedEntryIds]);

  const handleCreateRecipe = useCallback(async () => {
    if (!createRecipeName.trim()) {
      m3Alert.alert("Missing name", "Enter a name for your recipe.");
      return;
    }
    if (selectedRecipeItems.length === 0) {
      m3Alert.alert("No items", "Add at least one item to the recipe.");
      return;
    }
    const servings = parseNumberInput(createRecipeServings);
    try {
      await insertRecipe({
        name: createRecipeName.trim(),
        items: selectedRecipeItems,
        url: createRecipeUrl,
        servings: servings && servings > 0 ? servings : 1,
      });
      const updated = await getAllRecipes();
      setRecipes(updated);
      setCreateRecipeModalVisible(false);
      setSelectedEntryIds(new Set());
      setCreateRecipeName("");
      setCreateRecipeUrl("");
      setCreateRecipeServings("1");
      setSelectedRecipeItems([]);
      Vibration.vibrate(10);
    } catch {
      m3Alert.alert("Error", "Could not save recipe.");
    }
  }, [
    createRecipeName,
    createRecipeUrl,
    createRecipeServings,
    selectedRecipeItems,
  ]);

  const [editRecipeId, setEditRecipeId] = useState<string | null>(null);
  const [editRecipeName, setEditRecipeName] = useState("");
  const [editRecipeUrl, setEditRecipeUrl] = useState("");
  const [editRecipeServings, setEditRecipeServings] = useState("1");
  const [editRecipeItems, setEditRecipeItems] = useState<EditRecipeItemDraft[]>(
    [],
  );
  const [editRecipeShowMacros, setEditRecipeShowMacros] = useState<Set<number>>(
    new Set(),
  );

  const handleEditRecipe = useCallback((recipe: Recipe) => {
    Vibration.vibrate(10);
    setEditRecipeId(recipe.id);
    setEditRecipeName(recipe.name);
    setEditRecipeUrl(recipe.url ?? "");
    setEditRecipeServings(
      typeof recipe.servings === "number" && recipe.servings > 0
        ? `${recipe.servings}`
        : "1",
    );
    const items: RecipeItem[] = JSON.parse(recipe.itemsJson);
    setEditRecipeItems(
      items.map((i) => ({
        title: i.title,
        calories: `${i.calories}`,
        protein: typeof i.proteinGrams === "number" ? `${i.proteinGrams}` : "",
        fat: typeof i.fatGrams === "number" ? `${i.fatGrams}` : "",
        carbs: typeof i.carbsGrams === "number" ? `${i.carbsGrams}` : "",
        fibre: typeof i.fibreGrams === "number" ? `${i.fibreGrams}` : "",
        grams: typeof i.grams === "number" && i.grams > 0 ? `${i.grams}` : "",
      })),
    );
    setEditRecipeShowMacros(new Set());
  }, []);

  const handleEditRecipeItemChange = useCallback(
    (idx: number, field: keyof EditRecipeItemDraft, value: string) => {
      setEditRecipeItems((prev) =>
        prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)),
      );
    },
    [],
  );

  const handleEditRecipeRemoveItem = useCallback((idx: number) => {
    setEditRecipeItems((prev) => prev.filter((_, i) => i !== idx));
    setEditRecipeShowMacros((prev) => {
      const next = new Set(prev);
      next.delete(idx);
      // Decrement all indices >= idx
      const adjusted = new Set<number>();
      for (const v of next) {
        if (v > idx) adjusted.add(v - 1);
        else adjusted.add(v);
      }
      return adjusted;
    });
  }, []);

  const handleEditRecipeAddItem = useCallback(() => {
    setEditRecipeItems((prev) => [
      ...prev,
      {
        title: "",
        calories: "",
        protein: "",
        fat: "",
        carbs: "",
        fibre: "",
        grams: "",
      },
    ]);
  }, []);

  // Snapshot of grams-at-focus per item index, used to compute the rescale
  // ratio when the grams field loses focus. Rescaling on blur (rather than on
  // every keystroke) avoids jarring intermediate values while typing.
  const gramsAtFocusRef = useRef<Map<number, number>>(new Map());

  const handleEditRecipeGramsFocus = useCallback(
    (idx: number) => {
      const draft = editRecipeItems[idx];
      const g = draft ? parseNumberInput(draft.grams) : null;
      gramsAtFocusRef.current.set(idx, g && g > 0 ? g : 0);
    },
    [editRecipeItems],
  );

  const handleEditRecipeGramsBlur = useCallback(
    (idx: number) => {
      const draft = editRecipeItems[idx];
      if (!draft) return;
      const fromGrams = gramsAtFocusRef.current.get(idx) ?? 0;
      gramsAtFocusRef.current.delete(idx);
      const toGrams = parseNumberInput(draft.grams);
      if (!toGrams || toGrams <= 0) return;
      if (fromGrams <= 0 || toGrams === fromGrams) return;
      // Build a transient RecipeItem from the draft, rescale by the gram ratio,
      // then write the scaled values back as strings.
      const base: RecipeItem = {
        title: draft.title,
        calories: parseNumberInput(draft.calories) ?? 0,
        proteinGrams: draft.protein.trim()
          ? parseNumberInput(draft.protein)
          : null,
        fatGrams: draft.fat.trim() ? parseNumberInput(draft.fat) : null,
        carbsGrams: draft.carbs.trim() ? parseNumberInput(draft.carbs) : null,
        fibreGrams: draft.fibre.trim() ? parseNumberInput(draft.fibre) : null,
      };
      const scaled = rescaleByGrams(base, fromGrams, toGrams);
      setEditRecipeItems((prev) =>
        prev.map((item, i) =>
          i === idx
            ? {
                ...item,
                grams: `${scaled.grams ?? toGrams}`,
                calories: `${scaled.calories}`,
                protein:
                  scaled.proteinGrams != null ? `${scaled.proteinGrams}` : "",
                fat: scaled.fatGrams != null ? `${scaled.fatGrams}` : "",
                carbs: scaled.carbsGrams != null ? `${scaled.carbsGrams}` : "",
                fibre: scaled.fibreGrams != null ? `${scaled.fibreGrams}` : "",
              }
            : item,
        ),
      );
    },
    [editRecipeItems],
  );

  const toggleEditRecipeMacros = useCallback((idx: number) => {
    setEditRecipeShowMacros((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const handleSaveRecipeEdit = useCallback(async () => {
    if (!editRecipeId || !editRecipeName.trim()) {
      setEditRecipeId(null);
      setTimeout(
        () => m3Alert.alert("Missing name", "Enter a name for your recipe."),
        100,
      );
      return;
    }
    // Validate and build RecipeItem[] from editRecipeItems
    const items: RecipeItem[] = [];
    for (let i = 0; i < editRecipeItems.length; i++) {
      const draft = editRecipeItems[i];
      const calories = parseNumberInput(draft.calories);
      if (!draft.title.trim()) {
        setTimeout(
          () =>
            m3Alert.alert("Missing item name", `Item ${i + 1} needs a name.`),
          100,
        );
        return;
      }
      if (!calories || calories <= 0) {
        setTimeout(
          () =>
            m3Alert.alert(
              "Invalid calories",
              `Item ${i + 1} needs valid calories.`,
            ),
          100,
        );
        return;
      }
      const protein = draft.protein.trim()
        ? parseNumberInput(draft.protein)
        : null;
      const fat = draft.fat.trim() ? parseNumberInput(draft.fat) : null;
      const carbs = draft.carbs.trim() ? parseNumberInput(draft.carbs) : null;
      const fibre = draft.fibre.trim() ? parseNumberInput(draft.fibre) : null;
      const gramsRaw = draft.grams.trim()
        ? parseNumberInput(draft.grams)
        : null;
      items.push({
        title: draft.title.trim(),
        calories: roundTo(calories, SCALE_DECIMALS),
        proteinGrams:
          protein !== null ? roundTo(protein, SCALE_DECIMALS) : null,
        fatGrams: fat !== null ? roundTo(fat, SCALE_DECIMALS) : null,
        carbsGrams: carbs !== null ? roundTo(carbs, SCALE_DECIMALS) : null,
        fibreGrams: fibre !== null ? roundTo(fibre, SCALE_DECIMALS) : null,
        grams: gramsRaw && gramsRaw > 0 ? Math.round(gramsRaw * 10) / 10 : null,
      });
    }
    if (items.length === 0) {
      setTimeout(
        () => m3Alert.alert("No items", "Add at least one item to the recipe."),
        100,
      );
      return;
    }
    try {
      const servings = parseNumberInput(editRecipeServings);
      await updateRecipe(editRecipeId, {
        name: editRecipeName.trim(),
        items,
        url: editRecipeUrl,
        servings: servings && servings > 0 ? servings : 1,
      });
      const updated = await getAllRecipes();
      setRecipes(updated);
      setEditRecipeId(null);
      setEditRecipeName("");
      setEditRecipeUrl("");
      setEditRecipeServings("1");
      setEditRecipeItems([]);
      setEditRecipeShowMacros(new Set());
      Vibration.vibrate(10);
    } catch {
      setEditRecipeId(null);
      setTimeout(() => m3Alert.alert("Error", "Could not update recipe."), 100);
    }
  }, [
    editRecipeId,
    editRecipeName,
    editRecipeUrl,
    editRecipeServings,
    editRecipeItems,
  ]);

  const handleDeleteRecipe = useCallback(
    async (id: string) => {
      // Optimistic removal: remove immediately, restore on failure
      const snapshot = recipes;
      setRecipes((prev) => prev.filter((r) => r.id !== id));
      try {
        await deleteRecipe(id);
      } catch {
        setRecipes(snapshot);
      }
    },
    [recipes],
  );

  const [applyRecipe, setApplyRecipe] = useState<Recipe | null>(null);
  const [applyPortions, setApplyPortions] = useState("1");

  const handleOpenApplyRecipe = useCallback((recipe: Recipe) => {
    Vibration.vibrate(10);
    setApplyRecipe(recipe);
    setApplyPortions("1");
  }, []);

  const handleAddRecipeToLog = useCallback(
    (recipe: Recipe, portions: number) => {
      const items: RecipeItem[] = JSON.parse(recipe.itemsJson);
      const servings =
        typeof recipe.servings === "number" && recipe.servings > 0
          ? recipe.servings
          : 1;
      const factor = portions / servings;
      for (const item of items) {
        const scaled = scaleRecipeItem(item, factor);
        // Meals store integer calories (meals.calories is an integer column)
        // and follow the manual-entry macro convention (1 decimal place), so
        // round down from the full-precision scaled values here.
        addMeal({
          title: scaled.title,
          calories: Math.round(scaled.calories),
          proteinGrams:
            scaled.proteinGrams != null ? round1(scaled.proteinGrams) : null,
          fatGrams: scaled.fatGrams != null ? round1(scaled.fatGrams) : null,
          carbsGrams:
            scaled.carbsGrams != null ? round1(scaled.carbsGrams) : null,
          fibreGrams:
            scaled.fibreGrams != null ? round1(scaled.fibreGrams) : null,
        });
      }
      Vibration.vibrate(10);
    },
    [addMeal],
  );

  const handleOpenRecipeModal = useCallback(() => {
    Vibration.vibrate(10);
    getAllRecipes()
      .then(setRecipes)
      .catch(() => {});
    setRecipeModalVisible(true);
  }, []);

  const handleOpenLlmEstimator = useCallback(() => {
    if (deviceArchitecture) {
      const backend = data.inferenceBackend ?? "litert";
      if (!isBackendSupported(backend, deviceArchitecture)) {
        m3Alert.alert(
          "AI Features Not Available",
          `AI meal estimation is not supported on this device architecture (${getArchitectureLabel(deviceArchitecture)}) with the ${backend} backend.\n\n${getBackendUnsupportedReason(backend, deviceArchitecture)}`,
        );
        return;
      }
    }
    if (isModelBlocked) {
      m3Alert.alert(
        "Low Device Memory",
        `The selected model (${selectedModelKey}) requires ${memoryCheck?.usagePercent ?? "?"}% of available RAM, which exceeds the 60% safety threshold. This may cause device instability.\n\nPlease select a smaller model or free up device memory, then try again.`,
      );
      return;
    }
    setLlmModalVisible(true);
  }, [
    data.inferenceBackend,
    deviceArchitecture,
    isModelBlocked,
    selectedModelKey,
    memoryCheck?.usagePercent,
  ]);

  return (
    <>
      {m3Alert.alertDialog}
      <View
        style={[
          styles.root,
          { paddingTop: insets.top, backgroundColor: theme.colors.background },
        ]}
      >
        <ScrollView contentContainerStyle={styles.scroll}>
          <Surface
            style={[
              styles.heroCard,
              { backgroundColor: theme.colors.elevation.level2 },
            ]}
            elevation={3}
          >
            <View style={styles.goalBadgeRow}>
              <Chip
                icon={goalModeIcon}
                compact
                style={[styles.goalBadge, { backgroundColor: goalModeBg }]}
                textStyle={{ color: goalModeOnBg, fontWeight: "700" }}
              >
                {goalModeLabel}
              </Chip>
              <Text
                variant="bodySmall"
                style={{ color: goalModeTint, fontWeight: "700" }}
              >
                {goalModeDetail}
              </Text>
            </View>
            <View style={styles.progressSection}>
              <View style={styles.progressRow}>
                <Text
                  variant="bodyMedium"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  {todayCalories} / {adjustedTarget} kcal
                </Text>
                <Text
                  variant="bodyMedium"
                  style={{
                    color:
                      remaining < 0 ? theme.colors.error : theme.colors.primary,
                  }}
                >
                  {remaining >= 0
                    ? `${remaining} kcal left`
                    : `${Math.abs(remaining)} kcal over`}
                </Text>
              </View>
              <View style={styles.metabolismRow}>
                <View style={styles.metabolismChip}>
                  <MaterialCommunityIcons
                    name="fire"
                    size={12}
                    color={theme.colors.onSurfaceVariant}
                  />
                  <Text
                    variant="labelSmall"
                    style={{ color: theme.colors.onSurfaceVariant }}
                  >
                    BMR {metabolism.bmr ? `${metabolism.bmr}` : "N/A"}
                  </Text>
                </View>
                <View style={styles.metabolismChip}>
                  <MaterialCommunityIcons
                    name="lightning-bolt"
                    size={12}
                    color={theme.colors.onSurfaceVariant}
                  />
                  <Text
                    variant="labelSmall"
                    style={{ color: theme.colors.onSurfaceVariant }}
                  >
                    TDEE {metabolism.tdee ? `${metabolism.tdee}` : "N/A"}
                  </Text>
                </View>
                <View style={styles.metabolismChip}>
                  <MaterialCommunityIcons
                    name="target"
                    size={12}
                    color={theme.colors.onSurfaceVariant}
                  />
                  <Text
                    variant="labelSmall"
                    style={{ color: theme.colors.onSurfaceVariant }}
                  >
                    Maintenance{" "}
                    {metabolism.maintenanceCalories
                      ? `${metabolism.maintenanceCalories}`
                      : "N/A"}
                  </Text>
                </View>
              </View>
              <ProgressBar
                progress={progress}
                color={
                  remaining < 0 ? theme.colors.error : theme.colors.primary
                }
                style={styles.progressBar}
              />
              {hasMacroGoals ? (
                <Pressable
                  onPress={() => {
                    Vibration.vibrate(10);
                    setMacroModalVisible(true);
                  }}
                  style={({ pressed }) => [
                    styles.macroSummaryBar,
                    {
                      backgroundColor: pressed
                        ? theme.colors.elevation.level3
                        : theme.colors.elevation.level1,
                      borderColor: pressed
                        ? theme.colors.primary
                        : theme.colors.outlineVariant,
                    },
                  ]}
                >
                  <View style={styles.macroSummaryContent}>
                    {proteinGoal !== null ? (
                      <View
                        style={[
                          styles.macroToken,
                          { backgroundColor: macroPalette.protein.background },
                        ]}
                      >
                        <Text
                          variant="labelSmall"
                          style={{
                            color: macroPalette.protein.color,
                            fontWeight: "700",
                          }}
                        >
                          P {Math.round(todayTotalProtein)}/
                          {Math.round(proteinGoal)}
                        </Text>
                      </View>
                    ) : null}
                    {carbsGoal !== null ? (
                      <View
                        style={[
                          styles.macroToken,
                          { backgroundColor: macroPalette.carbs.background },
                        ]}
                      >
                        <Text
                          variant="labelSmall"
                          style={{
                            color: macroPalette.carbs.color,
                            fontWeight: "700",
                          }}
                        >
                          C {Math.round(todayTotalCarbs)}/
                          {Math.round(carbsGoal)}
                        </Text>
                      </View>
                    ) : null}
                    {fatGoal !== null ? (
                      <View
                        style={[
                          styles.macroToken,
                          { backgroundColor: macroPalette.fat.background },
                        ]}
                      >
                        <Text
                          variant="labelSmall"
                          style={{
                            color: macroPalette.fat.color,
                            fontWeight: "700",
                          }}
                        >
                          F {Math.round(todayTotalFat)}/{Math.round(fatGoal)}
                        </Text>
                      </View>
                    ) : null}
                    <View
                      style={[
                        styles.macroToken,
                        { backgroundColor: macroPalette.fibre.background },
                      ]}
                    >
                      <Text
                        variant="labelSmall"
                        style={{
                          color: macroPalette.fibre.color,
                          fontWeight: "700",
                        }}
                      >
                        Fib {Math.round(todayTotalFibre)}/
                        {Math.round(fibreGoal)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.macroSummaryMeta}>
                    <MaterialCommunityIcons
                      name={macroGoalModeIcon}
                      size={16}
                      color={theme.colors.onSurfaceVariant}
                    />
                    <MaterialCommunityIcons
                      name="chevron-down"
                      size={16}
                      color={theme.colors.onSurfaceVariant}
                    />
                  </View>
                </Pressable>
              ) : null}
            </View>
          </Surface>

          <QuickLogCard
            recentQuickAdds={recentQuickAdds}
            favouriteQuickAdds={favouriteQuickAdds}
            favouriteQuickAddKeys={favouriteQuickAddKeys}
            isMacrosExpanded={data.quickLogMacrosExpanded}
            onSetMacrosExpanded={(next) =>
              setData((prev) => ({ ...prev, quickLogMacrosExpanded: next }))
            }
            onAddMeal={addMeal}
            onQuickAddMeal={quickAddMeal}
            onToggleFavouriteQuickAdd={toggleFavouriteQuickAdd}
            onOpenLlmEstimator={handleOpenLlmEstimator}
            data={data}
            isModelBlocked={isModelBlocked}
            isModelWarning={isModelWarning}
            memoryUsagePercent={memoryCheck?.usagePercent}
          />

          <Card style={styles.card} mode="elevated">
            <Card.Title
              title="Today's Entries"
              titleVariant="titleLarge"
              rightStyle={styles.entriesHeaderRight}
              right={() => (
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  {selectedEntryIds.size > 0 ? (
                    <Button
                      mode="contained-tonal"
                      compact
                      icon="bookmark-outline"
                      onPress={handleSaveAsRecipe}
                      style={{ marginRight: 8 }}
                    >
                      Save ({selectedEntryIds.size})
                    </Button>
                  ) : null}
                  <Button
                    mode="text"
                    compact
                    icon={
                      sortMode === "newest"
                        ? "sort-clock-descending"
                        : "sort-clock-ascending"
                    }
                    style={styles.entriesSortButton}
                    contentStyle={styles.entriesSortButtonContent}
                    labelStyle={styles.entriesSortButtonLabel}
                    onPress={() =>
                      setSortMode((prev) =>
                        prev === "newest" ? "oldest" : "newest",
                      )
                    }
                  >
                    {sortMode === "newest" ? "Newest" : "Oldest"}
                  </Button>
                </View>
              )}
            />
            <Card.Content style={styles.entriesList}>
              {visibleEntries.length ? (
                renderedEntries
              ) : (
                <View style={styles.emptyState}>
                  <MaterialCommunityIcons
                    name="silverware-fork-knife"
                    size={40}
                    color={theme.colors.onSurfaceVariant}
                    style={{ opacity: 0.4 }}
                  />
                  <Text
                    variant="bodyMedium"
                    style={[
                      styles.emptyText,
                      { color: theme.colors.onSurfaceVariant },
                    ]}
                  >
                    No entries logged today yet.
                  </Text>
                  <Text
                    variant="bodySmall"
                    style={{
                      color: theme.colors.onSurfaceVariant,
                      opacity: 0.6,
                    }}
                  >
                    Use the Quick Log above to add a meal.
                  </Text>
                </View>
              )}
            </Card.Content>
          </Card>

          {recipes.length > 0 ? (
            <Card style={styles.card} mode="elevated">
              <Card.Title
                title="My Recipes"
                titleVariant="titleLarge"
                right={() => (
                  <IconButton
                    icon="book-open-variant"
                    size={20}
                    onPress={handleOpenRecipeModal}
                  />
                )}
              />
              <Card.Content style={styles.entriesList}>
                {recipes.slice(0, 5).map((recipe) => {
                  const itemCount = JSON.parse(recipe.itemsJson).length;
                  return (
                    <Surface
                      key={recipe.id}
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
                        <View style={styles.entryTitleRow}>
                          <Text
                            variant="titleSmall"
                            numberOfLines={2}
                            style={[
                              styles.entryTitle,
                              { flex: 1, color: theme.colors.onSurface },
                            ]}
                          >
                            {recipe.name}
                          </Text>
                          <Text
                            variant="labelMedium"
                            style={{
                              color: theme.colors.primary,
                              fontWeight: "700",
                            }}
                          >
                            {recipe.totalCalories} kcal
                          </Text>
                        </View>
                        <Text
                          variant="bodySmall"
                          style={{ color: theme.colors.onSurfaceVariant }}
                        >
                          {itemCount} items
                          {recipe.totalProteinGrams
                            ? `  •  P ${round1(recipe.totalProteinGrams)}g`
                            : ""}
                          {recipe.totalCarbsGrams
                            ? `  C ${round1(recipe.totalCarbsGrams)}g`
                            : ""}
                          {recipe.totalFatGrams
                            ? `  F ${round1(recipe.totalFatGrams)}g`
                            : ""}
                        </Text>
                      </View>
                      <View style={styles.entryActions}>
                        <IconButton
                          icon="plus-circle-outline"
                          size={20}
                          iconColor={theme.colors.primary}
                          onPress={() => handleOpenApplyRecipe(recipe)}
                          accessibilityLabel="Add recipe to log"
                        />
                      </View>
                    </Surface>
                  );
                })}
                {recipes.length > 5 ? (
                  <Button
                    mode="text"
                    compact
                    icon="dots-horizontal"
                    onPress={handleOpenRecipeModal}
                  >
                    Show all {recipes.length} recipes
                  </Button>
                ) : null}
              </Card.Content>
            </Card>
          ) : null}
        </ScrollView>

        <Modal
          visible={llmModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setLlmModalVisible(false)}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setLlmModalVisible(false)}
          >
            <Pressable
              style={[
                styles.modalCard,
                { backgroundColor: theme.colors.surface },
              ]}
              onPress={() => {}}
            >
              <Text variant="titleMedium" style={{ fontWeight: "700" }}>
                Meal Estimator
              </Text>
              {isModelWarning && !isModelBlocked && memoryCheck && (
                <View
                  style={[
                    styles.llmMemoryWarning,
                    { backgroundColor: theme.colors.tertiaryContainer },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="alert"
                    size={16}
                    color={theme.colors.tertiary}
                  />
                  <Text
                    variant="labelSmall"
                    style={{ color: theme.colors.tertiary, flex: 1 }}
                  >
                    Model uses {memoryCheck.usagePercent}% of available RAM
                  </Text>
                </View>
              )}
              <TextInput
                label="Describe your meal"
                value={llmPrompt}
                onChangeText={setLlmPrompt}
                placeholder="e.g. 2 eggs, 1 slice toast, 1 tbsp butter"
                multiline
                mode="outlined"
                theme={QUICK_LOG_INPUT_THEME}
                right={
                  <TextInput.Icon
                    icon={isModelInMemory ? "memory" : "circle-outline"}
                    color={
                      isModelInMemory
                        ? theme.colors.primary
                        : theme.colors.error
                    }
                    onPress={showModelStatusHint}
                    style={{ alignSelf: "center" }}
                  />
                }
              />
              <Button
                mode="contained"
                icon="robot"
                loading={llmLoading}
                onPress={handleLlmPrompt}
                disabled={llmLoading || !llmPrompt.trim()}
              >
                Estimate Calories & Macros
              </Button>
              {llmLoading ? (
                <View style={{ marginTop: 8, gap: 6 }}>
                  <ProgressBar indeterminate />
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant }}
                  >
                    {llmStage === "loading-model"
                      ? `Loading model into memory... ${llmStageElapsedSec}s`
                      : `Estimating nutrition... ${llmStageElapsedSec}s`}
                  </Text>
                </View>
              ) : null}
              {llmError ? (
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.error, marginTop: 8 }}
                >
                  {llmError}
                </Text>
              ) : null}
              {llmResult ? (
                <View style={{ marginTop: 12 }}>
                  {!llmResultParsed ? (
                    <Text
                      variant="bodySmall"
                      style={{ color: theme.colors.onSurfaceVariant }}
                    >
                      Couldn't understand the model output. Try rephrasing your
                      meal.
                    </Text>
                  ) : !llmResultParsed.items ||
                    !Array.isArray(llmResultParsed.items) ||
                    llmResultParsed.items.every(
                      (item: LLMEstimateItem) => !item.calories,
                    ) ? (
                    <Text
                      variant="bodySmall"
                      style={{ color: theme.colors.onSurfaceVariant }}
                    >
                      No food items identified in the model output.
                    </Text>
                  ) : (
                    <View style={{ marginTop: 4 }}>
                      {llmResultParsed.items.map(
                        (item: LLMEstimateItem, idx: number) => (
                          <View
                            key={idx}
                            style={{
                              marginBottom: 6,
                              padding: 8,
                              borderRadius: 8,
                              backgroundColor: theme.colors.surfaceVariant,
                            }}
                          >
                            <Text
                              variant="labelLarge"
                              style={{
                                fontWeight: "700",
                                color: theme.colors.primary,
                              }}
                            >
                              {item.name}
                            </Text>
                            <Text variant="bodySmall">
                              Calories: {item.calories} kcal
                            </Text>
                            <Text variant="bodySmall">
                              Protein: {item.protein}g | Carbs: {item.carbs}g |
                              Fat: {item.fat}g | Fibre: {item.fibre}g
                            </Text>
                          </View>
                        ),
                      )}
                      <Button
                        mode="outlined"
                        icon="plus"
                        style={{ marginTop: 8 }}
                        onPress={() => {
                          if (
                            !llmResultParsed ||
                            !Array.isArray(llmResultParsed.items)
                          )
                            return;
                          llmResultParsed.items.forEach(
                            (item: LLMEstimateItem) => {
                              addMeal({
                                title: item.name,
                                calories: item.calories,
                                proteinGrams: item.protein,
                                fatGrams: item.fat,
                                carbsGrams: item.carbs,
                                fibreGrams: item.fibre,
                              });
                            },
                          );
                          setLlmPrompt("");
                          setLlmResult(null);
                          setLlmModalVisible(false);
                        }}
                      >
                        Add to Log
                      </Button>
                    </View>
                  )}
                </View>
              ) : null}
              <Button mode="text" onPress={() => setLlmModalVisible(false)}>
                Close
              </Button>
            </Pressable>
          </Pressable>
        </Modal>

        <Modal
          visible={editDraft !== null}
          transparent
          animationType="fade"
          onRequestClose={closeEditModal}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeEditModal}>
            <Pressable
              style={[
                styles.modalCard,
                { backgroundColor: theme.colors.surface },
              ]}
              onPress={() => {}}
            >
              <Text variant="titleMedium" style={{ fontWeight: "700" }}>
                Edit Entry
              </Text>
              <TextInput
                label="Meal"
                value={editDraft?.title ?? ""}
                onChangeText={(value) =>
                  setEditDraft((prev) =>
                    prev ? { ...prev, title: value } : prev,
                  )
                }
                mode="outlined"
                theme={QUICK_LOG_INPUT_THEME}
              />
              <TextInput
                label="Calories (kcal)"
                value={editDraft?.calories ?? ""}
                onChangeText={(value) =>
                  setEditDraft((prev) =>
                    prev ? { ...prev, calories: value } : prev,
                  )
                }
                keyboardType="numeric"
                mode="outlined"
                theme={QUICK_LOG_INPUT_THEME}
              />
              <Pressable
                onPress={() => setShowEditMacros((prev) => !prev)}
                style={({ pressed }) => [
                  styles.macroSectionHeader,
                  {
                    backgroundColor: pressed
                      ? theme.colors.elevation.level3
                      : theme.colors.elevation.level1,
                    borderColor: pressed
                      ? theme.colors.primary
                      : theme.colors.outlineVariant,
                  },
                ]}
              >
                <View style={styles.macroSectionTitle}>
                  <MaterialCommunityIcons
                    name="nutrition"
                    size={16}
                    color={theme.colors.primary}
                  />
                  <Text
                    variant="labelLarge"
                    style={{ color: theme.colors.onSurface }}
                  >
                    Macros
                  </Text>
                  <Chip
                    compact
                    mode="flat"
                    style={{
                      backgroundColor: theme.colors.surfaceVariant,
                    }}
                    textStyle={{ color: theme.colors.onSurfaceVariant }}
                  >
                    Optional
                  </Chip>
                </View>
                <MaterialCommunityIcons
                  name={showEditMacros ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={theme.colors.onSurfaceVariant}
                />
              </Pressable>
              {editDraftMismatch ? (
                <View style={styles.mismatchRow}>
                  <MaterialCommunityIcons
                    name="alert-circle-outline"
                    size={14}
                    color={theme.colors.error}
                  />
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.error }}
                  >
                    Macros estimate about {editDraftMismatch.macroCalories}{" "}
                    kcal, which differs from logged calories.
                  </Text>
                </View>
              ) : null}
              {showEditMacros ? (
                <View style={styles.macroGrid}>
                  <TextInput
                    label="Protein (g)"
                    value={editDraft?.protein ?? ""}
                    onChangeText={(value) =>
                      setEditDraft((prev) =>
                        prev ? { ...prev, protein: value } : prev,
                      )
                    }
                    keyboardType="numeric"
                    mode="outlined"
                    style={styles.macroInput}
                    theme={QUICK_LOG_INPUT_THEME}
                  />
                  <TextInput
                    label="Carbs (g)"
                    value={editDraft?.carbs ?? ""}
                    onChangeText={(value) =>
                      setEditDraft((prev) =>
                        prev ? { ...prev, carbs: value } : prev,
                      )
                    }
                    keyboardType="numeric"
                    mode="outlined"
                    style={styles.macroInput}
                    theme={QUICK_LOG_INPUT_THEME}
                  />
                  <TextInput
                    label="Fat (g)"
                    value={editDraft?.fat ?? ""}
                    onChangeText={(value) =>
                      setEditDraft((prev) =>
                        prev ? { ...prev, fat: value } : prev,
                      )
                    }
                    keyboardType="numeric"
                    mode="outlined"
                    style={styles.macroInput}
                    theme={QUICK_LOG_INPUT_THEME}
                  />
                  <TextInput
                    label="Fibre (g)"
                    value={editDraft?.fibre ?? ""}
                    onChangeText={(value) =>
                      setEditDraft((prev) =>
                        prev ? { ...prev, fibre: value } : prev,
                      )
                    }
                    keyboardType="numeric"
                    mode="outlined"
                    style={styles.macroInput}
                    theme={QUICK_LOG_INPUT_THEME}
                  />
                </View>
              ) : null}
              <View style={styles.editActionsRow}>
                <Button mode="text" onPress={closeEditModal}>
                  Cancel
                </Button>
                <Button mode="contained" onPress={saveEditedEntry}>
                  Save
                </Button>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        <Modal
          visible={macroModalVisible}
          transparent
          animationType="none"
          onRequestClose={() => setMacroModalVisible(false)}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setMacroModalVisible(false)}
          >
            <Pressable
              style={[
                styles.modalCard,
                { backgroundColor: theme.colors.surface },
              ]}
              onPress={() => {}}
            >
              <Text
                variant="titleMedium"
                style={{ fontWeight: "700", marginBottom: 4 }}
              >
                Today's Macros
              </Text>
              <View style={styles.macroModeRow}>
                <MaterialCommunityIcons
                  name={macroGoalModeIcon}
                  size={16}
                  color={theme.colors.onSurfaceVariant}
                />
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  {macroGoalModeText}
                </Text>
              </View>

              {proteinGoal !== null ? (
                <View style={styles.macroRow}>
                  <View style={styles.macroLabel}>
                    <View style={styles.macroRowHeader}>
                      <MaterialCommunityIcons
                        name="food-steak"
                        size={16}
                        color={macroPalette.protein.color}
                      />
                      <Text
                        variant="labelSmall"
                        style={{
                          fontWeight: "700",
                          color: macroPalette.protein.color,
                        }}
                      >
                        Protein
                      </Text>
                    </View>
                    <Text
                      variant="bodySmall"
                      style={{ color: theme.colors.onSurfaceVariant }}
                    >
                      {Math.round(todayTotalProtein)} /{" "}
                      {Math.round(proteinGoal)} g
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
                      <MaterialCommunityIcons
                        name="bread-slice-outline"
                        size={16}
                        color={macroPalette.carbs.color}
                      />
                      <Text
                        variant="labelSmall"
                        style={{
                          fontWeight: "700",
                          color: macroPalette.carbs.color,
                        }}
                      >
                        Carbs
                      </Text>
                    </View>
                    <Text
                      variant="bodySmall"
                      style={{ color: theme.colors.onSurfaceVariant }}
                    >
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
                      <MaterialCommunityIcons
                        name="water-outline"
                        size={16}
                        color={macroPalette.fat.color}
                      />
                      <Text
                        variant="labelSmall"
                        style={{
                          fontWeight: "700",
                          color: macroPalette.fat.color,
                        }}
                      >
                        Fat
                      </Text>
                    </View>
                    <Text
                      variant="bodySmall"
                      style={{ color: theme.colors.onSurfaceVariant }}
                    >
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
                    <MaterialCommunityIcons
                      name="leaf"
                      size={16}
                      color={macroPalette.fibre.color}
                    />
                    <Text
                      variant="labelSmall"
                      style={{
                        fontWeight: "700",
                        color: macroPalette.fibre.color,
                      }}
                    >
                      Fibre
                    </Text>
                  </View>
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant }}
                  >
                    {Math.round(todayTotalFibre)} / {Math.round(fibreGoal)} g
                  </Text>
                </View>
                <ProgressBar
                  progress={fibreProgress}
                  color={macroPalette.fibre.color}
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

        {/* ── Recipe Browser Modal ───────────────────────────────── */}
        <Modal
          visible={recipeModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setRecipeModalVisible(false)}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setRecipeModalVisible(false)}
          >
            <Pressable
              style={[
                styles.modalCard,
                { backgroundColor: theme.colors.surface, maxHeight: 500 },
              ]}
              onPress={() => {}}
            >
              <Text variant="titleMedium" style={{ fontWeight: "700" }}>
                My Recipes
              </Text>
              {recipes.length === 0 ? (
                <Text
                  variant="bodyMedium"
                  style={{
                    color: theme.colors.onSurfaceVariant,
                    textAlign: "center",
                    paddingVertical: 16,
                  }}
                >
                  No saved recipes yet.
                </Text>
              ) : (
                <ScrollView
                  style={{ maxHeight: 360 }}
                  showsVerticalScrollIndicator
                  nestedScrollEnabled
                >
                  {recipes.map((recipe) => {
                    const items: RecipeItem[] = JSON.parse(recipe.itemsJson);
                    return (
                      <Surface
                        key={recipe.id}
                        style={[
                          styles.entryRow,
                          {
                            backgroundColor: theme.colors.elevation.level1,
                            borderColor: theme.colors.outlineVariant,
                            marginBottom: 8,
                          },
                        ]}
                        elevation={1}
                      >
                        <Text
                          variant="labelMedium"
                          style={{
                            position: "absolute",
                            top: 8,
                            right: 10,
                            color: theme.colors.primary,
                            fontWeight: "700",
                          }}
                        >
                          {recipe.totalCalories} kcal
                        </Text>
                        <View style={[styles.entryMain, { gap: 2 }]}>
                          <Text
                            variant="titleSmall"
                            numberOfLines={1}
                            style={{
                              color: theme.colors.onSurface,
                              paddingRight: 50,
                            }}
                          >
                            {recipe.name}
                          </Text>
                          <Text
                            variant="bodySmall"
                            numberOfLines={2}
                            style={{ color: theme.colors.onSurfaceVariant }}
                          >
                            {summarizeRecipeItems(items)}
                          </Text>
                          {recipe.totalProteinGrams ? (
                            <Text
                              variant="bodySmall"
                              numberOfLines={1}
                              style={{ color: theme.colors.onSurfaceVariant }}
                            >
                              P {round1(recipe.totalProteinGrams)}g C{" "}
                              {round1(recipe.totalCarbsGrams ?? 0)}g F{" "}
                              {round1(recipe.totalFatGrams ?? 0)}g
                            </Text>
                          ) : null}
                          {(() => {
                            const servings =
                              typeof recipe.servings === "number" &&
                              recipe.servings > 0
                                ? recipe.servings
                                : 1;
                            if (servings <= 1) return null;
                            const perServing = Math.round(
                              recipe.totalCalories / servings,
                            );
                            return (
                              <Text
                                variant="bodySmall"
                                numberOfLines={1}
                                style={{
                                  color: theme.colors.onSurfaceVariant,
                                  fontStyle: "italic",
                                }}
                              >
                                Makes {round1(servings)} servings · {perServing}{" "}
                                kcal each
                              </Text>
                            );
                          })()}
                        </View>
                        <View style={styles.entryActions}>
                          <IconButton
                            icon="plus-circle-outline"
                            size={20}
                            iconColor={theme.colors.primary}
                            onPress={() => {
                              handleOpenApplyRecipe(recipe);
                              setRecipeModalVisible(false);
                            }}
                            accessibilityLabel="Add recipe to log"
                          />
                          {recipe.url ? (
                            <IconButton
                              icon="open-in-new"
                              size={18}
                              iconColor={theme.colors.primary}
                              onPress={() =>
                                recipe.url
                                  ? Linking.openURL(recipe.url).catch(() => {})
                                  : null
                              }
                              accessibilityLabel="Open recipe link"
                            />
                          ) : null}
                          <IconButton
                            icon="pencil-outline"
                            size={18}
                            onPress={() => handleEditRecipe(recipe)}
                            accessibilityLabel="Edit recipe"
                          />
                          <IconButton
                            icon="delete-outline"
                            size={18}
                            iconColor={theme.colors.error}
                            onPress={() => handleDeleteRecipe(recipe.id)}
                            accessibilityLabel="Delete recipe"
                          />
                        </View>
                      </Surface>
                    );
                  })}
                </ScrollView>
              )}
              <Button mode="text" onPress={() => setRecipeModalVisible(false)}>
                Close
              </Button>
            </Pressable>
          </Pressable>
        </Modal>

        {/* ── Edit Recipe Modal ──────────────────────────────────── */}
        <Modal
          visible={editRecipeId !== null}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setEditRecipeId(null);
            setEditRecipeName("");
            setEditRecipeItems([]);
            setEditRecipeShowMacros(new Set());
          }}
        >
          <View style={styles.modalBackdrop}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => {
                setEditRecipeId(null);
                setEditRecipeName("");
                setEditRecipeUrl("");
                setEditRecipeServings("1");
                setEditRecipeItems([]);
                setEditRecipeShowMacros(new Set());
              }}
            />
            <View
              style={[
                styles.modalCard,
                { backgroundColor: theme.colors.surface, maxHeight: 560 },
              ]}
            >
              <Text variant="titleMedium" style={{ fontWeight: "700" }}>
                Edit Recipe
              </Text>
              <TextInput
                label="Recipe Name"
                value={editRecipeName}
                onChangeText={setEditRecipeName}
                placeholder="Enter recipe name"
                mode="outlined"
                theme={QUICK_LOG_INPUT_THEME}
              />
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "stretch",
                  gap: 8,
                }}
              >
                <TextInput
                  label="Recipe link (optional)"
                  value={editRecipeUrl}
                  onChangeText={setEditRecipeUrl}
                  placeholder="https://…"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  mode="outlined"
                  theme={QUICK_LOG_INPUT_THEME}
                  style={{ flex: 1 }}
                />
                <TextInput
                  label="Servings"
                  value={editRecipeServings}
                  onChangeText={setEditRecipeServings}
                  placeholder="1"
                  keyboardType="numeric"
                  mode="outlined"
                  theme={QUICK_LOG_INPUT_THEME}
                  style={{ width: 96 }}
                />
              </View>
              <ScrollView
                style={{ maxHeight: 300 }}
                showsVerticalScrollIndicator
                nestedScrollEnabled
              >
                {editRecipeItems.map((draft, idx) => {
                  const showMacros = editRecipeShowMacros.has(idx);
                  const draftCalories = parseNumberInput(draft.calories);
                  const itemMismatch =
                    draftCalories && draftCalories > 0
                      ? getMacroCalorieMismatch(
                          Math.round(draftCalories),
                          {
                            proteinGrams: draft.protein.trim()
                              ? parseNumberInput(draft.protein)
                              : null,
                            fatGrams: draft.fat.trim()
                              ? parseNumberInput(draft.fat)
                              : null,
                            carbsGrams: draft.carbs.trim()
                              ? parseNumberInput(draft.carbs)
                              : null,
                            fibreGrams: draft.fibre.trim()
                              ? parseNumberInput(draft.fibre)
                              : null,
                          },
                          {
                            approach: data.fibreCalorieApproach,
                            tolerancePercent: data.calorieTolerancePercent,
                          },
                        )
                      : null;
                  return (
                    <Surface
                      key={idx}
                      style={[
                        styles.entryRow,
                        {
                          backgroundColor: theme.colors.elevation.level1,
                          borderColor: theme.colors.outlineVariant,
                          marginBottom: 8,
                          flexDirection: "column",
                          alignItems: "stretch",
                          gap: 6,
                        },
                      ]}
                      elevation={1}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <TextInput
                          label="Item name"
                          value={draft.title}
                          onChangeText={(v) =>
                            handleEditRecipeItemChange(idx, "title", v)
                          }
                          placeholder="e.g. Oatmeal"
                          mode="outlined"
                          theme={QUICK_LOG_INPUT_THEME}
                          style={{ flex: 1 }}
                        />
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 2,
                          }}
                        >
                          <TextInput
                            label="Calories"
                            value={draft.calories}
                            onChangeText={(v) =>
                              handleEditRecipeItemChange(idx, "calories", v)
                            }
                            placeholder="kcal"
                            keyboardType="numeric"
                            mode="outlined"
                            theme={QUICK_LOG_INPUT_THEME}
                            style={{ minWidth: 72 }}
                          />
                          <IconButton
                            icon="trash-can-outline"
                            size={18}
                            iconColor={theme.colors.error}
                            onPress={() => handleEditRecipeRemoveItem(idx)}
                            accessibilityLabel="Remove item"
                          />
                        </View>
                      </View>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <TextInput
                          label="Grams"
                          value={draft.grams}
                          onChangeText={(v) =>
                            handleEditRecipeItemChange(idx, "grams", v)
                          }
                          onFocus={() => handleEditRecipeGramsFocus(idx)}
                          onBlur={() => handleEditRecipeGramsBlur(idx)}
                          placeholder="0"
                          keyboardType="numeric"
                          mode="outlined"
                          theme={QUICK_LOG_INPUT_THEME}
                          style={{ width: 100 }}
                        />
                        <View
                          style={{
                            flex: 1,
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <MaterialCommunityIcons
                            name="scale"
                            size={14}
                            color={theme.colors.onSurfaceVariant}
                          />
                          <Text
                            variant="labelSmall"
                            style={{
                              color: theme.colors.onSurfaceVariant,
                              flex: 1,
                            }}
                          >
                            {!draft.grams.trim() ||
                            (parseNumberInput(draft.grams) ?? 0) <= 0
                              ? "First entry sets the weight — no rescale"
                              : "Adjust to rescale calories & macros"}
                          </Text>
                        </View>
                      </View>
                      <Pressable
                        onPress={() => toggleEditRecipeMacros(idx)}
                        style={({ pressed }) => [
                          styles.macroSectionHeader,
                          {
                            backgroundColor: pressed
                              ? theme.colors.elevation.level3
                              : theme.colors.elevation.level1,
                            borderColor: pressed
                              ? theme.colors.primary
                              : theme.colors.outlineVariant,
                          },
                        ]}
                      >
                        <View style={styles.macroSectionTitle}>
                          <MaterialCommunityIcons
                            name="nutrition"
                            size={16}
                            color={theme.colors.primary}
                          />
                          <Text
                            variant="labelLarge"
                            style={{ color: theme.colors.onSurface }}
                          >
                            Macros
                          </Text>
                          <Chip
                            compact
                            mode="flat"
                            style={{
                              backgroundColor: theme.colors.surfaceVariant,
                            }}
                            textStyle={{ color: theme.colors.onSurfaceVariant }}
                          >
                            Optional
                          </Chip>
                        </View>
                        <MaterialCommunityIcons
                          name={showMacros ? "chevron-up" : "chevron-down"}
                          size={18}
                          color={theme.colors.onSurfaceVariant}
                        />
                      </Pressable>
                      {itemMismatch ? (
                        <View style={styles.mismatchRow}>
                          <MaterialCommunityIcons
                            name="alert-circle-outline"
                            size={14}
                            color={theme.colors.error}
                          />
                          <Text
                            variant="bodySmall"
                            style={{ color: theme.colors.error }}
                          >
                            Macros estimate about {itemMismatch.macroCalories}{" "}
                            kcal, which differs from logged calories.
                          </Text>
                        </View>
                      ) : null}
                      {showMacros ? (
                        <View style={styles.macroGrid}>
                          <TextInput
                            label="Protein (g)"
                            value={draft.protein}
                            onChangeText={(v) =>
                              handleEditRecipeItemChange(idx, "protein", v)
                            }
                            placeholder="0"
                            keyboardType="numeric"
                            mode="outlined"
                            style={styles.macroInput}
                            theme={QUICK_LOG_INPUT_THEME}
                          />
                          <TextInput
                            label="Carbs (g)"
                            value={draft.carbs}
                            onChangeText={(v) =>
                              handleEditRecipeItemChange(idx, "carbs", v)
                            }
                            placeholder="0"
                            keyboardType="numeric"
                            mode="outlined"
                            style={styles.macroInput}
                            theme={QUICK_LOG_INPUT_THEME}
                          />
                          <TextInput
                            label="Fat (g)"
                            value={draft.fat}
                            onChangeText={(v) =>
                              handleEditRecipeItemChange(idx, "fat", v)
                            }
                            placeholder="0"
                            keyboardType="numeric"
                            mode="outlined"
                            style={styles.macroInput}
                            theme={QUICK_LOG_INPUT_THEME}
                          />
                          <TextInput
                            label="Fibre (g)"
                            value={draft.fibre}
                            onChangeText={(v) =>
                              handleEditRecipeItemChange(idx, "fibre", v)
                            }
                            placeholder="0"
                            keyboardType="numeric"
                            mode="outlined"
                            style={styles.macroInput}
                            theme={QUICK_LOG_INPUT_THEME}
                          />
                        </View>
                      ) : null}
                    </Surface>
                  );
                })}
              </ScrollView>
              <Button
                mode="outlined"
                icon="plus"
                compact
                onPress={handleEditRecipeAddItem}
                style={{ alignSelf: "flex-start" }}
              >
                Add Item
              </Button>
              <View style={styles.editActionsRow}>
                <Button
                  mode="text"
                  onPress={() => {
                    setEditRecipeId(null);
                    setEditRecipeName("");
                    setEditRecipeUrl("");
                    setEditRecipeServings("1");
                    setEditRecipeItems([]);
                    setEditRecipeShowMacros(new Set());
                  }}
                >
                  Cancel
                </Button>
                <Button
                  mode="contained"
                  icon="check"
                  onPress={handleSaveRecipeEdit}
                >
                  Save
                </Button>
              </View>
            </View>
          </View>
        </Modal>

        {/* ── Create Recipe Modal ────────────────────────────────── */}
        <Modal
          visible={createRecipeModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setCreateRecipeModalVisible(false);
            setSelectedEntryIds(new Set());
            setCreateRecipeName("");
            setSelectedRecipeItems([]);
          }}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              setCreateRecipeModalVisible(false);
              setSelectedEntryIds(new Set());
              setCreateRecipeName("");
              setSelectedRecipeItems([]);
            }}
          >
            <Pressable
              style={[
                styles.modalCard,
                { backgroundColor: theme.colors.surface },
              ]}
              onPress={() => {}}
            >
              <Text variant="titleMedium" style={{ fontWeight: "700" }}>
                Save as Recipe
              </Text>
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.onSurfaceVariant }}
              >
                {selectedRecipeItems.length} item(s) selected
              </Text>
              <TextInput
                label="Recipe Name"
                value={createRecipeName}
                onChangeText={setCreateRecipeName}
                placeholder="e.g. My Breakfast"
                mode="outlined"
                theme={QUICK_LOG_INPUT_THEME}
              />
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "stretch",
                  gap: 8,
                }}
              >
                <TextInput
                  label="Recipe link (optional)"
                  value={createRecipeUrl}
                  onChangeText={setCreateRecipeUrl}
                  placeholder="https://…"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  mode="outlined"
                  theme={QUICK_LOG_INPUT_THEME}
                  style={{ flex: 1 }}
                />
                <TextInput
                  label="Servings"
                  value={createRecipeServings}
                  onChangeText={setCreateRecipeServings}
                  placeholder="1"
                  keyboardType="numeric"
                  mode="outlined"
                  theme={QUICK_LOG_INPUT_THEME}
                  style={{ width: 96 }}
                />
              </View>
              <ScrollView
                style={{ maxHeight: 200 }}
                showsVerticalScrollIndicator
                nestedScrollEnabled
              >
                {selectedRecipeItems.map((item, idx) => (
                  <Surface
                    key={idx}
                    style={[
                      styles.entryRow,
                      {
                        backgroundColor: theme.colors.elevation.level1,
                        borderColor: theme.colors.outlineVariant,
                        marginBottom: 4,
                      },
                    ]}
                    elevation={0}
                  >
                    <View style={styles.entryMain}>
                      <View style={styles.entryTitleRow}>
                        <Text
                          variant="bodyMedium"
                          numberOfLines={1}
                          style={{ flex: 1, color: theme.colors.onSurface }}
                        >
                          {item.title}
                        </Text>
                        <Text
                          variant="labelSmall"
                          style={{
                            color: theme.colors.primary,
                            fontWeight: "700",
                          }}
                        >
                          {item.calories} kcal
                        </Text>
                      </View>
                    </View>
                  </Surface>
                ))}
              </ScrollView>
              <View style={styles.editActionsRow}>
                <Button
                  mode="text"
                  onPress={() => {
                    setCreateRecipeModalVisible(false);
                    setSelectedEntryIds(new Set());
                    setCreateRecipeName("");
                    setSelectedRecipeItems([]);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  mode="contained"
                  icon="bookmark-outline"
                  onPress={handleCreateRecipe}
                >
                  Save Recipe
                </Button>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* ── Log Recipe (apply) Modal ──────────────────────────── */}
        <Modal
          visible={applyRecipe !== null}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setApplyRecipe(null);
            setApplyPortions("1");
          }}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              setApplyRecipe(null);
              setApplyPortions("1");
            }}
          >
            <Pressable
              onPress={() => {}}
              style={[
                styles.modalCard,
                { backgroundColor: theme.colors.surface },
              ]}
            >
              <Text variant="titleMedium" style={{ fontWeight: "700" }}>
                Log Recipe
              </Text>
              {applyRecipe
                ? (() => {
                    const servings =
                      typeof applyRecipe.servings === "number" &&
                      applyRecipe.servings > 0
                        ? applyRecipe.servings
                        : 1;
                    const portionsRaw = parseNumberInput(applyPortions);
                    const portions =
                      portionsRaw && portionsRaw > 0 ? portionsRaw : 1;
                    const totals = sumScaledRecipe(
                      JSON.parse(applyRecipe.itemsJson) as RecipeItem[],
                      portionFactor(servings, portions),
                    );
                    const perServingKcal = Math.round(
                      applyRecipe.totalCalories / servings,
                    );
                    return (
                      <>
                        <Text
                          variant="titleSmall"
                          style={{ color: theme.colors.onSurface }}
                        >
                          {applyRecipe.name}
                        </Text>
                        <Text
                          variant="bodySmall"
                          style={{ color: theme.colors.onSurfaceVariant }}
                        >
                          Makes {round1(servings)} serving
                          {servings === 1 ? "" : "s"} · {perServingKcal} kcal
                          each
                        </Text>

                        <Text variant="labelLarge" style={{ marginTop: 8 }}>
                          How many portions are you logging?
                        </Text>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <IconButton
                            icon="minus"
                            size={20}
                            onPress={() =>
                              setApplyPortions(
                                `${
                                  Math.round(Math.max(1, portions - 1) * 100) /
                                  100
                                }`,
                              )
                            }
                            accessibilityLabel="Fewer portions"
                          />
                          <TextInput
                            value={applyPortions}
                            onChangeText={setApplyPortions}
                            onBlur={() => {
                              const parsed = parseNumberInput(applyPortions);
                              if (parsed === null || parsed <= 0) {
                                setApplyPortions("1");
                              }
                            }}
                            keyboardType="numeric"
                            mode="outlined"
                            theme={QUICK_LOG_INPUT_THEME}
                            style={{ flex: 1, textAlign: "center" }}
                          />
                          <IconButton
                            icon="plus"
                            size={20}
                            onPress={() =>
                              setApplyPortions(
                                `${Math.round((portions + 1) * 100) / 100}`,
                              )
                            }
                            accessibilityLabel="More portions"
                          />
                        </View>

                        <View
                          style={[
                            styles.macroSummaryBar,
                            {
                              borderColor: theme.colors.outlineVariant,
                              backgroundColor: theme.colors.elevation.level1,
                            },
                          ]}
                        >
                          <Text
                            style={{
                              fontWeight: "700",
                              color: theme.colors.primary,
                            }}
                          >
                            {totals.calories} kcal
                          </Text>
                          <Text
                            variant="bodySmall"
                            style={{ color: theme.colors.onSurfaceVariant }}
                          >
                            P {round1(totals.proteinGrams)}g C{" "}
                            {round1(totals.carbsGrams)}g F{" "}
                            {round1(totals.fatGrams)}g
                          </Text>
                        </View>
                        {servings !== 1 && portions !== servings ? (
                          <Text
                            variant="bodySmall"
                            style={{
                              color: theme.colors.onSurfaceVariant,
                              fontStyle: "italic",
                            }}
                          >
                            Logging {round1(portions)} of {round1(servings)}{" "}
                            servings.
                          </Text>
                        ) : null}

                        <View style={styles.editActionsRow}>
                          <Button
                            mode="text"
                            onPress={() => {
                              setApplyRecipe(null);
                              setApplyPortions("1");
                            }}
                          >
                            Cancel
                          </Button>
                          <Button
                            mode="contained"
                            icon="check"
                            disabled={portionsRaw === null || portionsRaw <= 0}
                            onPress={() => {
                              if (applyRecipe) {
                                handleAddRecipeToLog(applyRecipe, portions);
                              }
                              setApplyRecipe(null);
                              setApplyPortions("1");
                            }}
                          >
                            Add to Log
                          </Button>
                        </View>
                      </>
                    );
                  })()
                : null}
            </Pressable>
          </Pressable>
        </Modal>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { padding: 16, gap: 16 },
  segmentedControl: {
    borderRadius: 14,
    overflow: "hidden",
  },
  heroCard: { borderRadius: 24, padding: 16, gap: 4 },
  progressSection: { gap: 8 },
  progressRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressBar: { height: 10, borderRadius: 999 },
  metabolismRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  metabolismChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "transparent",
  },
  macroSummaryBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  macroSummaryContent: {
    flexDirection: "row",
    gap: 2,
    flex: 1,
    flexWrap: "nowrap",
  },
  macroSummaryMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginLeft: 8,
  },
  macroToken: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalCard: {
    borderRadius: 20,
    padding: 20,
    gap: 12,
    maxWidth: LOG_ENTRY_MAX_WIDTH,
    width: "100%",
  },
  macrosSection: { marginTop: 8, paddingTop: 8, borderTopWidth: 1 },
  macroRow: { marginBottom: 8, gap: 8 },
  macroModeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  macroLabel: { gap: 4 },
  macroRowHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  macroBar: { height: 8, borderRadius: 999 },
  card: { borderRadius: 24 },
  goalBadge: { borderRadius: 999 },
  goalBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  formArea: { gap: 12, paddingBottom: 10 },
  macroGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  macroInput: { minWidth: "47%", flexGrow: 1 },
  quickAddSection: { gap: 8, marginBottom: 8 },
  quickAddScrollFrame: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
  },
  quickAddScroll: { maxHeight: 164 },
  quickAddRow: {
    flexDirection: "column",
    gap: 8,
    paddingRight: 4,
    paddingBottom: 2,
  },
  quickAddScrollHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: 4,
  },
  quickAddItem: { flexDirection: "row", alignItems: "center", gap: 2 },
  quickLogHeader: { minHeight: 56, paddingVertical: 6 },
  quickLogTitle: { marginLeft: -2 },
  quickLogLlmButtonContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginRight: 4,
  },
  quickLogLlmButton: { marginRight: 0 },
  quickLogLlmButtonContent: { paddingHorizontal: 4 },
  memoryStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 8,
  },
  memoryStatusText: {
    fontSize: 10,
    fontWeight: "700",
  },
  llmMemoryWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: 8,
  },
  macroSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  macroSectionTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  entriesHeaderRight: { marginRight: 8 },
  entriesSortButton: { marginVertical: 0, minWidth: 120 },
  entriesSortButtonContent: { paddingHorizontal: 2 },
  entriesSortButtonLabel: { marginHorizontal: 4 },
  entriesList: { gap: 8 },
  editActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 8,
  },
  mismatchRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  entryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  entryMain: { flex: 1, gap: 4, marginRight: 8 },
  entryTopLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  entryTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  entryTitle: { flexShrink: 1 },
  entryMeta: {},
  entryActions: { flexDirection: "row", alignItems: "center", marginRight: -6 },
  entryActionIcon: { margin: 0 },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {},
});
