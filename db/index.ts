import {
  SQLITE_DB_NAME,
  SOURCE_MANUAL,
  SOURCE_HEALTH_CONNECT,
} from "@/constants";

import { drizzle } from "drizzle-orm/op-sqlite";
import { asc, desc, eq, sql } from "drizzle-orm";
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

const mealDayExpr = sql<string>`substr(${schema.meals.loggedAt}, 1, 10)`;
const weightDayExpr = sql<string>`substr(${schema.weightHistory.recordedAt}, 1, 10)`;
const mealInstantExpr = sql<number>`julianday(${schema.meals.loggedAt})`;
const weightInstantExpr = sql<number>`julianday(${schema.weightHistory.recordedAt})`;
const bodyFatInstantExpr = sql<number>`julianday(${schema.bodyFatHistory.recordedAt})`;
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
  return await db
    .select()
    .from(schema.meals)
    .where(sql`substr(${schema.meals.loggedAt}, 1, 10) = ${dateKey}`)
    .orderBy(desc(mealInstantExpr));
}

/** All meals logged on or after the given ISO timestamp. */
export async function getMealsSince(since: string): Promise<Meal[]> {
  return await db
    .select()
    .from(schema.meals)
    .where(sql`julianday(${schema.meals.loggedAt}) >= julianday(${since})`)
    .orderBy(desc(mealInstantExpr));
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
      day: mealDayExpr,
      totalCalories: sql<number>`SUM(${schema.meals.calories})`,
    })
    .from(schema.meals)
    .where(sql`julianday(${schema.meals.loggedAt}) >= julianday(${since})`)
    .groupBy(mealDayExpr)
    .orderBy(mealDayExpr);
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
    .orderBy(desc(weightInstantExpr))
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
    .orderBy(desc(weightInstantExpr))
    .limit(1);

  return latest ?? null;
}

/** Weight series for graphs (last N days). */
export async function getWeightSeries(since: string): Promise<Weight[]> {
  return await db
    .select()
    .from(schema.weightHistory)
    .where(
      sql`julianday(${schema.weightHistory.recordedAt}) >= julianday(${since})`,
    )
    .orderBy(asc(weightInstantExpr));
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
    .where(
      sql`julianday(${schema.weightHistory.recordedAt}) >= julianday(${since})`,
    )
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
    .orderBy(desc(bodyFatInstantExpr))
    .limit(1);

  return latest ?? null;
}

/** Latest body-fat by source (for GoalsScreen manual override). */
export async function getLatestBodyFatBySource(
  source: typeof SOURCE_MANUAL | typeof SOURCE_HEALTH_CONNECT,
): Promise<BodyFat | null> {
  const [latest] = await db
    .select()
    .from(schema.bodyFatHistory)
    .where(eq(schema.bodyFatHistory.source, source))
    .orderBy(desc(bodyFatInstantExpr))
    .limit(1);

  return latest ?? null;
}

export async function deleteBodyFatBySource(
  source: typeof SOURCE_MANUAL | typeof SOURCE_HEALTH_CONNECT,
): Promise<void> {
  await db
    .delete(schema.bodyFatHistory)
    .where(eq(schema.bodyFatHistory.source, source));
}

/** Body fat series for graphs. */
export async function getBodyFatSeries(since: string): Promise<BodyFat[]> {
  return await db
    .select()
    .from(schema.bodyFatHistory)
    .where(
      sql`julianday(${schema.bodyFatHistory.recordedAt}) >= julianday(${since})`,
    )
    .orderBy(asc(bodyFatInstantExpr));
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
      day: mealDayExpr,
      totalCalories: sql<number>`SUM(${schema.meals.calories})`,
      avgWeight: sql<number | null>`AVG(${schema.weightHistory.weightKg})`,
    })
    .from(schema.meals)
    .leftJoin(schema.weightHistory, sql`${mealDayExpr} = ${weightDayExpr}`)
    .where(sql`julianday(${schema.meals.loggedAt}) >= julianday(${since})`)
    .groupBy(mealDayExpr)
    .orderBy(mealDayExpr);
}

// ── Export / Import helpers ──────────────────────────────────────────

/** Get all meals (for export) */
export async function getAllMeals(): Promise<Meal[]> {
  return await db.select().from(schema.meals).orderBy(desc(mealInstantExpr));
}

/** Get all weight history (for export) */
export async function getAllWeights(): Promise<Weight[]> {
  return await db
    .select()
    .from(schema.weightHistory)
    .orderBy(desc(weightInstantExpr));
}

/** Get all body fat history (for export) */
export async function getAllBodyFats(): Promise<BodyFat[]> {
  return await db
    .select()
    .from(schema.bodyFatHistory)
    .orderBy(desc(bodyFatInstantExpr));
}

/** Bulk import meals (INSERT OR IGNORE for idempotency) */
export async function importMealsBulk(
  mealsData: Meal[],
): Promise<{ imported: number; failed: number }> {
  return db.transaction(async (tx) => {
    let imported = 0;
    let failed = 0;
    for (const meal of mealsData) {
      try {
        const row = meal.id ? meal : { ...meal, id: makeMealId(meal) };
        await tx.insert(schema.meals).values(row).onConflictDoNothing();
        imported++;
      } catch {
        failed++;
      }
    }
    return { imported, failed };
  });
}

/** Bulk import weight history (INSERT OR IGNORE for idempotency) */
export async function importWeightsBulk(
  weightsData: Array<Weight | Omit<Weight, "id">>,
): Promise<{ imported: number; failed: number }> {
  return db.transaction(async (tx) => {
    let imported = 0;
    let failed = 0;
    for (const w of weightsData) {
      try {
        const row: Weight =
          "id" in w && typeof w.id === "string"
            ? (w as Weight)
            : {
                ...(w as Omit<Weight, "id">),
                id: makeWeightId(w as Omit<Weight, "id">),
              };
        await tx.insert(schema.weightHistory).values(row).onConflictDoNothing();
        imported++;
      } catch {
        failed++;
      }
    }
    return { imported, failed };
  });
}

/** Bulk import body fat history (INSERT OR IGNORE for idempotency) */
export async function importBodyFatsBulk(
  bodyFatsData: Array<BodyFat | Omit<BodyFat, "id">>,
): Promise<{ imported: number; failed: number }> {
  return db.transaction(async (tx) => {
    let imported = 0;
    let failed = 0;
    for (const bf of bodyFatsData) {
      try {
        const row: BodyFat =
          "id" in bf && typeof bf.id === "string"
            ? (bf as BodyFat)
            : {
                ...(bf as Omit<BodyFat, "id">),
                id: makeBodyFatId(bf as Omit<BodyFat, "id">),
              };
        await tx
          .insert(schema.bodyFatHistory)
          .values(row)
          .onConflictDoNothing();
        imported++;
      } catch {
        failed++;
      }
    }
    return { imported, failed };
  });
}
