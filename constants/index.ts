// ─────────────────────────────────────────────────────────────
// Application-wide constants
// ─────────────────────────────────────────────────────────────

// ── Storage & DB Keys ────────────────────────────────────────
export const STORAGE_KEY = "calorie-tracker-storage-v1";
export const MMKV_INSTANCE_ID = "calorie-tracker-mmkv-v1";
export const THEME_MODE_STORAGE_KEY = "calorie-tracker-theme-mode-v1";
export const SQLITE_DB_NAME = "calorie-tracker-db";
export const EXPORT_FILENAME_PREFIX = "calorie-tracker-export_";

// ── Database Table Names ─────────────────────────────────────
export const DB_TABLE_MEALS = "meals";
export const DB_TABLE_WEIGHT_HISTORY = "weight_history";
export const DB_TABLE_BODY_FAT_HISTORY = "body_fat_history";
export const RECIPE_TABLE = "recipes";

// ── Database Index Names ─────────────────────────────────────
export const IDX_MEALS_LOGGED_AT = "idx_meals_logged_at";
export const IDX_WEIGHT_RECORDED_AT = "idx_weight_recorded_at";
export const IDX_WEIGHT_SOURCE = "idx_weight_source";
export const IDX_BODYFAT_RECORDED_AT = "idx_bodyfat_recorded_at";

// ── Source Enum Values ───────────────────────────────────────
export const SOURCE_MANUAL = "manual";
export const SOURCE_HEALTH_CONNECT = "health-connect";

// ── Sex / Gender Enum Values ─────────────────────────────────
export const SEX_UNSPECIFIED = "unspecified";
export const SEX_MALE = "male";
export const SEX_FEMALE = "female";

// ── Activity Levels ──────────────────────────────────────────
export const ACTIVITY_SEDENTARY = "sedentary";
export const ACTIVITY_LIGHT = "light";
export const ACTIVITY_MODERATE = "moderate";
export const ACTIVITY_HEAVY = "heavy";
export const ACTIVITY_ATHLETE = "athlete";

// ── Goal Phases ──────────────────────────────────────────────
export const PHASE_MAINTAIN = "maintain";
export const PHASE_CUT = "cut";
export const PHASE_BULK = "bulk";

// ── Goal Adjustment Types ────────────────────────────────────
export const ADJUSTMENT_TYPE_KCAL = "kcal";
export const ADJUSTMENT_TYPE_PERCENT = "percent";

// ── Theme Mode Values ────────────────────────────────────────
export const THEME_MODE_SYSTEM = "system";
export const THEME_MODE_LIGHT = "light";
export const THEME_MODE_DARK = "dark";
export const THEME_MODE_AMOLED = "amoled";

// ── Metabolism Constants ─────────────────────────────────────
/** kcal required to gain or lose 1 kg of body weight */
export const KCAL_PER_KG_BODY_WEIGHT = 7700;

/** Activity factor multipliers by level */
export const ACTIVITY_FACTOR_BY_LEVEL: Record<string, number> = {
  [ACTIVITY_SEDENTARY]: 1.2,
  [ACTIVITY_LIGHT]: 1.375,
  [ACTIVITY_MODERATE]: 1.55,
  [ACTIVITY_HEAVY]: 1.725,
  [ACTIVITY_ATHLETE]: 1.9,
};

/** Mifflin-St Jeor BMR formula coefficients */
export const BMR_WEIGHT_COEFF = 10;
export const BMR_HEIGHT_COEFF = 6.25;
export const BMR_AGE_COEFF = 5;
export const BMR_MALE_OFFSET = 5;
export const BMR_FEMALE_OFFSET = -161;

/** Calories per gram of macronutrients */
export const CALORIES_PER_GRAM_PROTEIN = 4;
export const CALORIES_PER_GRAM_CARBS = 4;
export const CALORIES_PER_GRAM_FAT = 9;

// ── Fibre Calorie Approaches ─────────────────────────────────
// Controls how dietary fibre contributes to the "macros estimate about
// X kcal" calculation. Different labelling systems use different factors:
//   FDA — US basic 4-4-9: fibre counts as an ordinary carb (4 kcal/g)
//   NET — fibre-subtracted / "net carbs": fibre contributes 0 kcal/g
//   EU  — EU / FSANZ metabolisable energy: fibre counts at 2 kcal/g
//
// EU is the most accurate reflection of metabolisable energy and is the
// app default.
export const FIBRE_CALORIE_APPROACH_FDA = "fda";
export const FIBRE_CALORIE_APPROACH_NET = "net";
export const FIBRE_CALORIE_APPROACH_EU = "eu";
export type FibreCalorieApproach =
  | typeof FIBRE_CALORIE_APPROACH_FDA
  | typeof FIBRE_CALORIE_APPROACH_NET
  | typeof FIBRE_CALORIE_APPROACH_EU;
export const FIBRE_CALORIE_APPROACHES: FibreCalorieApproach[] = [
  FIBRE_CALORIE_APPROACH_FDA,
  FIBRE_CALORIE_APPROACH_NET,
  FIBRE_CALORIE_APPROACH_EU,
];
export const DEFAULT_FIBRE_CALORIE_APPROACH = FIBRE_CALORIE_APPROACH_EU;

/** kcal per gram of fibre under the default (EU) approach. */
export const CALORIES_PER_GRAM_FIBRE = 2;

// ── Default Macro Nutritient Ratios (by phase) ───────────────
export const DEFAULT_MACRO_RATIOS = {
  [PHASE_MAINTAIN]: { protein: 0.3, carbs: 0.4, fat: 0.3 },
  [PHASE_CUT]: { protein: 0.35, carbs: 0.35, fat: 0.3 },
  [PHASE_BULK]: { protein: 0.3, carbs: 0.45, fat: 0.25 },
} as const;

// ── Default Numeric Values (correspond to StoredData defaults) ─
export const DEFAULT_BASE_TARGET_CALORIES = 2100;
export const DEFAULT_CALORIES_PER_KG = 30;
export const DEFAULT_CALORIE_ADJUSTMENT = 500;
export const DEFAULT_PERCENT_PER_WEEK = 1;
export const DEFAULT_CALORIE_TOLERANCE_PERCENT = 12;
export const DEFAULT_GRAPH_TOLERANCE_CALORIES = 100;
export const DEFAULT_ACTIVITY_LEVEL = ACTIVITY_MODERATE;
export const DEFAULT_SEX = SEX_MALE;

// ── Quick-Add Adjustment Presets ─────────────────────────────
export const QUICK_ADJUST_PERCENT_PRESETS = [0.25, 0.5, 0.75, 1];
export const QUICK_ADJUST_KCAL_PRESETS = [250, 500, 750, 1000];

// ── Inference Backend Selection ───────────────────────────────
export const BACKEND_LITERT = "litert";
export const BACKEND_LLAMA_CPP = "llama-cpp";
export const DEFAULT_INFERENCE_BACKEND = BACKEND_LITERT;
export type InferenceBackend = typeof BACKEND_LITERT | typeof BACKEND_LLAMA_CPP;

// ── Model Config Defaults ────────────────────────────────────
export const DEFAULT_MODEL_TEMPERATURE = 0.2;
export const DEFAULT_MODEL_MAX_TOKENS = 2048;
export const DEFAULT_MODEL_TOP_K = 64;
export const DEFAULT_MODEL_TOP_P = 0.95;
export const DEFAULT_MODEL_BACKEND = "cpu";

// ── Truncation / Slice Limits ────────────────────────────────
export const SLUG_MAX_LENGTH = 40;
export const MAX_VISIBLE_ENTRIES = 40;
export const MAX_FAVOURITE_QUICK_ADDS = 24;
export const TREND_RECENT_POINTS = 5;

// ── Animation & Timing ───────────────────────────────────────
export const TAB_RIPPLE_DURATION_MS = 320;
export const DEBOUNCE_DELAY_MS = 500;
export const AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// ── Tab Bar UI ───────────────────────────────────────────────
export const TAB_BAR_HEIGHT_BASE = 66;
export const TAB_BAR_PADDING_TOP = 8;
export const TAB_BAR_PADDING_BOTTOM_MIN = 10;
export const TAB_ICON_SIZE_FOCUSED = 24;
export const TAB_ICON_SIZE_UNFOCUSED = 22;
export const TAB_LABEL_FONT_SIZE = 12;
export const TAB_LABEL_FONT_WEIGHT: "700" = "700" as const;
export const TAB_LABEL_PADDING_BOTTOM = 3;

// ── Tab Ripple ───────────────────────────────────────────────
export const TAB_RIPPLE_SIZE = 140;
export const TAB_RIPPLE_BORDER_RADIUS = 70;

// ── Log Screen ───────────────────────────────────────────────
export const LOG_ENTRY_MAX_WIDTH = 500;

// ── Graph Defaults ───────────────────────────────────────────
export const GRAPH_MAX_DAYS_SHORT = 7;
export const GRAPH_MAX_DAYS_MEDIUM = 90;
export const GRAPH_MAX_DAYS_LONG = 365;

// ── Weight Trend EMA ─────────────────────────────────────────
export const TREND_EMA_ALPHA = 0.4;
export const TREND_EMA_GAMMA = 0.2;

// ── Tab Icon Names ───────────────────────────────────────────
export const TAB_ICON_LOG = "food-apple-outline";
export const TAB_ICON_GRAPHS = "chart-bar";
export const TAB_ICON_GOALS = "bullseye";
export const TAB_ICON_SETTINGS = "cog-outline";
