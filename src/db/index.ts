import {
  SQLITE_DB_NAME,
  ISO_DAY_START_SUFFIX,
  ISO_DAY_END_SUFFIX,
  SOURCE_MANUAL,
  SOURCE_HEALTH_CONNECT,
} from "../constants";

import { drizzle } from "drizzle-orm/op-sqlite";
import { and, asc, gte, lte, desc, eq, sql } from "drizzle-orm";
import { Platform } from "react-native";
import {
  IOS_LIBRARY_PATH, // Default iOS
  ANDROID_DATABASE_PATH, // Default Android
  ANDROID_EXTERNAL_FILES_PATH, // Android SD Card
  open,
} from "@op-engineering/op-sqlite";
import * as schema from "./schema";
import { makeWeightId, makeBodyFatId, makeMealId } from "./helpers";

const sqlite = open({
  name: SQLITE_DB_NAME,
  location:
    Platform.OS === "ios"
      ? IOS_LIBRARY_PATH
      : (ANDROID_EXTERNAL_FILES_PATH ?? ANDROID_DATABASE_PATH),
});
const db = drizzle(sqlite, { schema });
export { db as database };

const dayExpr = sql<string>`DATE(${schema.meals.loggedAt})`;
function normalizeOrigin<
  T extends {
    originAppId?: string | null;
    originAppName?: string | null;
    originDevice?: string | null;
  },
>(p: T) {
  return {
    originAppId: p.originAppId ?? null,
    originAppName: p.originAppName ?? null,
    originDevice: p.originDevice ?? null,
  };
}

// ── Meals ──────────────────────────────────────────────────────────────────
export type Meal = typeof schema.meals.$inferInsert;

export async function insertMeal(meal: Meal): Promise<void> {
  const row = {
    ...meal,
    proteinGrams: meal.proteinGrams ?? null,
    fatGrams: meal.fatGrams ?? null,
    carbsGrams: meal.carbsGrams ?? null,
    fibreGrams: meal.fibreGrams ?? null,
  };
  await db.insert(schema.meals).values(row);
}

/** All meals whose `loggedAt` falls on the given calendar day (ISO date key). */
export async function getMealsForDay(dateKey: string): Promise<Meal[]> {
  const start = `${dateKey}${ISO_DAY_START_SUFFIX}`;
  const end = `${dateKey}${ISO_DAY_END_SUFFIX}`;

  return await db
    .select()
    .from(schema.meals)
    .where(
      and(gte(schema.meals.loggedAt, start), lte(schema.meals.loggedAt, end)),
    )
    .orderBy(desc(schema.meals.loggedAt));
}

/** All meals logged on or after the given ISO timestamp. */
export async function getMealsSince(since: string): Promise<Meal[]> {
  return await db
    .select()
    .from(schema.meals)
    .where(gte(schema.meals.loggedAt, since))
    .orderBy(desc(schema.meals.loggedAt));
}

export async function deleteMeal(id: string): Promise<void> {
  await db.delete(schema.meals).where(eq(schema.meals.id, id));
}

export async function updateMeal(
  id: string,
  data: Partial<Omit<Meal, "id">>,
): Promise<void> {
  await db.update(schema.meals).set(data).where(eq(schema.meals.id, id));
}

/** Calories per day over the last N days (for GraphsScreen calorie chart). */

export async function getCaloriesPerDay(
  since: string,
): Promise<{ day: string; totalCalories: number }[]> {
  return await db
    .select({
      day: dayExpr,
      totalCalories: sql<number>`SUM(${schema.meals.calories})`,
    })
    .from(schema.meals)
    .where(gte(schema.meals.loggedAt, since))
    .groupBy(sql`DATE(${schema.meals.loggedAt})`)
    .orderBy(sql`DATE(${schema.meals.loggedAt})`);
}

// ── Weight ─────────────────────────────────────────────────────────────────
export type Weight = typeof schema.weightHistory.$inferSelect;
export async function insertWeight(point: Omit<Weight, "id">): Promise<void> {
  const id = makeWeightId(point);

  await db.insert(schema.weightHistory).values({
    id,
    recordedAt: point.recordedAt,
    weightKg: point.weightKg,
    source: point.source,
    ...normalizeOrigin(point),
  });
}

/** Latest weight point regardless of source. */
export async function getLatestWeight(): Promise<Weight | null> {
  const [latest] = await db
    .select()
    .from(schema.weightHistory)
    .orderBy(desc(schema.weightHistory.recordedAt))
    .limit(1);

  return latest ?? null;
}

/** Latest manual weight (used for GoalsScreen manual override). */
export async function getLatestWeightBySource(
  source: typeof SOURCE_MANUAL | typeof SOURCE_HEALTH_CONNECT,
): Promise<Weight | null> {
  const [latest] = await db
    .select()
    .from(schema.weightHistory)
    .where(eq(schema.weightHistory.source, source))
    .orderBy(desc(schema.weightHistory.recordedAt))
    .limit(1);

  return latest ?? null;
}

/** Weight series for graphs (last N days). */
export async function getWeightSeries(since: string): Promise<Weight[]> {
  return await db
    .select()
    .from(schema.weightHistory)
    .where(gte(schema.weightHistory.recordedAt, since))
    .orderBy(asc(schema.weightHistory.recordedAt));
}

/** Weekly averages (for GraphsScreen weight trend). */
const avgWeight = sql<number>`
  ROUND(AVG(${schema.weightHistory.weightKg}), 2)
`;
export async function getWeeklyAverageWeight(
  since: string,
): Promise<{ weekStart: string; avgWeight: number }[]> {
  const weekStart = sql<string>`
    DATE(${schema.weightHistory.recordedAt}, 'weekday 0', '-6 days')
  `;

  return await db
    .select({
      weekStart,
      avgWeight: avgWeight,
    })
    .from(schema.weightHistory)
    .where(gte(schema.weightHistory.recordedAt, since))
    .groupBy(weekStart)
    .orderBy(weekStart);
}

// ── Body Fat ───────────────────────────────────────────────────────────────
export type BodyFat = typeof schema.bodyFatHistory.$inferSelect;
export async function insertBodyFat(point: Omit<BodyFat, "id">): Promise<void> {
  const id = makeBodyFatId(point);

  await db.insert(schema.bodyFatHistory).values({
    id,
    recordedAt: point.recordedAt,
    bodyFatPercentage: point.bodyFatPercentage,
    source: point.source,
    ...normalizeOrigin(point),
  });
}

/** Latest body-fat measurement. */

export async function getLatestBodyFat(): Promise<BodyFat | null> {
  const [latest] = await db
    .select()
    .from(schema.bodyFatHistory)
    .orderBy(desc(schema.bodyFatHistory.recordedAt))
    .limit(1);

  return latest ?? null;
}

/** Body fat series for graphs. */
export async function getBodyFatSeries(since: string): Promise<BodyFat[]> {
  return await db
    .select()
    .from(schema.bodyFatHistory)
    .where(gte(schema.bodyFatHistory.recordedAt, since))
    .orderBy(asc(schema.bodyFatHistory.recordedAt));
}

export async function updateWeight(
  id: string,
  data: Partial<Omit<Weight, "id">>,
): Promise<void> {
  await db
    .update(schema.weightHistory)
    .set(data)
    .where(eq(schema.weightHistory.id, id));
}

export async function deleteWeightBySource(
  source: typeof SOURCE_MANUAL | typeof SOURCE_HEALTH_CONNECT,
): Promise<void> {
  await db
    .delete(schema.weightHistory)
    .where(eq(schema.weightHistory.source, source));
}

// ── Combined ───────────────────────────────────────────────────────────────

export async function getCaloriesVsWeight(
  since: string,
): Promise<{ day: string; totalCalories: number; avgWeight: number | null }[]> {
  return await db
    .select({
      day: dayExpr,
      totalCalories: sql<number>`SUM(${schema.meals.calories})`,
      avgWeight: sql<number | null>`AVG(${schema.weightHistory.weightKg})`,
    })
    .from(schema.meals)
    .leftJoin(
      schema.weightHistory,
      sql`DATE(${schema.meals.loggedAt}) = DATE(${schema.weightHistory.recordedAt})`,
    )
    .where(gte(schema.meals.loggedAt, since))
    .groupBy(dayExpr)
    .orderBy(dayExpr);
}

// ── Export / Import helpers ──────────────────────────────────────────

/** Get all meals (for export) */
export async function getAllMeals(): Promise<Meal[]> {
  return await db
    .select()
    .from(schema.meals)
    .orderBy(desc(schema.meals.loggedAt));
}

/** Get all weight history (for export) */
export async function getAllWeights(): Promise<Weight[]> {
  return await db
    .select()
    .from(schema.weightHistory)
    .orderBy(desc(schema.weightHistory.recordedAt));
}

/** Get all body fat history (for export) */
export async function getAllBodyFats(): Promise<BodyFat[]> {
  return await db
    .select()
    .from(schema.bodyFatHistory)
    .orderBy(desc(schema.bodyFatHistory.recordedAt));
}

/** Bulk import meals (INSERT OR IGNORE for idempotency) */
export async function importMealsBulk(mealsData: Meal[]): Promise<number> {
  return db.transaction(async (tx) => {
    let count = 0;
    for (const meal of mealsData) {
      try {
        const row = meal.id ? meal : { ...meal, id: makeMealId(meal) };
        await tx.insert(schema.meals).values(row).onConflictDoNothing();
        count++;
      } catch {
        // skip problematic rows
      }
    }
    return count;
  });
}

/** Bulk import weight history (INSERT OR IGNORE for idempotency) */
export async function importWeightsBulk(
  weightsData: Weight[],
): Promise<number> {
  return db.transaction(async (tx) => {
    let count = 0;
    for (const w of weightsData) {
      try {
        const row = (w as any).id ? w : { ...w, id: makeWeightId(w) };
        await tx.insert(schema.weightHistory).values(row).onConflictDoNothing();
        count++;
      } catch {
        // skip problematic rows
      }
    }
    return count;
  });
}

/** Bulk import body fat history (INSERT OR IGNORE for idempotency) */
export async function importBodyFatsBulk(
  bodyFatsData: BodyFat[],
): Promise<number> {
  return db.transaction(async (tx) => {
    let count = 0;
    for (const bf of bodyFatsData) {
      try {
        const row = (bf as any).id ? bf : { ...bf, id: makeBodyFatId(bf) };
        await tx.insert(schema.bodyFatHistory).values(row).onConflictDoNothing();
        count++;
      } catch {
        // skip problematic rows
      }
    }
    return count;
  });
}
