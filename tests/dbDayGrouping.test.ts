import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

type MealRow = {
  id: string;
  calories: number;
  loggedAt: string;
};

function setupMealsDb(rows: MealRow[]) {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE meals (
      id TEXT PRIMARY KEY,
      calories INTEGER NOT NULL,
      logged_at TEXT NOT NULL
    );
  `);

  const insert = db.prepare(
    "INSERT INTO meals (id, calories, logged_at) VALUES (?, ?, ?)",
  );
  for (const row of rows) {
    insert.run(row.id, row.calories, row.loggedAt);
  }

  return db;
}

test("day filter using substr(logged_at, 1, 10) returns only matching local day", () => {
  const db = setupMealsDb([
    { id: "a", calories: 500, loggedAt: "2026-05-01T00:05:00.000+01:00" },
    { id: "b", calories: 700, loggedAt: "2026-05-01T23:59:59.999+01:00" },
    { id: "c", calories: 300, loggedAt: "2026-05-02T00:00:00.000+01:00" },
  ]);

  const rows = db
    .prepare(
      `
      SELECT id, logged_at as loggedAt
      FROM meals
      WHERE substr(logged_at, 1, 10) = ?
      ORDER BY julianday(logged_at) DESC
      `,
    )
    .all("2026-05-01") as Array<{ id: string; loggedAt: string }>;

  assert.deepEqual(
    rows.map((r) => r.id),
    ["b", "a"],
  );
});

test("daily grouping via substr(logged_at, 1, 10) aggregates and orders by day", () => {
  const db = setupMealsDb([
    { id: "a", calories: 500, loggedAt: "2026-04-30T22:00:00.000+01:00" },
    { id: "b", calories: 700, loggedAt: "2026-05-01T08:30:00.000+01:00" },
    { id: "c", calories: 300, loggedAt: "2026-05-01T21:15:00.000+01:00" },
    { id: "d", calories: 400, loggedAt: "2026-05-02T09:00:00.000+01:00" },
  ]);

  const rows = db
    .prepare(
      `
      SELECT
        substr(logged_at, 1, 10) as day,
        SUM(calories) as totalCalories
      FROM meals
      GROUP BY substr(logged_at, 1, 10)
      ORDER BY substr(logged_at, 1, 10)
      `,
    )
    .all() as Array<{ day: string; totalCalories: number }>;

  assert.deepEqual(rows, [
    { day: "2026-04-30", totalCalories: 500 },
    { day: "2026-05-01", totalCalories: 1000 },
    { day: "2026-05-02", totalCalories: 400 },
  ]);
});

test("since cutoff combines with day grouping without changing day-key semantics", () => {
  const db = setupMealsDb([
    { id: "a", calories: 500, loggedAt: "2026-05-01T09:00:00.000+01:00" },
    { id: "b", calories: 700, loggedAt: "2026-05-03T10:00:00.000+01:00" },
    { id: "c", calories: 200, loggedAt: "2026-05-03T19:00:00.000+01:00" },
    { id: "d", calories: 400, loggedAt: "2026-05-04T07:00:00.000+01:00" },
  ]);

  const since = "2026-05-03T00:00:00.000+01:00";
  const rows = db
    .prepare(
      `
      SELECT
        substr(logged_at, 1, 10) as day,
        SUM(calories) as totalCalories
      FROM meals
      WHERE julianday(logged_at) >= julianday(?)
      GROUP BY substr(logged_at, 1, 10)
      ORDER BY substr(logged_at, 1, 10)
      `,
    )
    .all(since) as Array<{ day: string; totalCalories: number }>;

  assert.deepEqual(rows, [
    { day: "2026-05-03", totalCalories: 900 },
    { day: "2026-05-04", totalCalories: 400 },
  ]);
});

test("julianday ordering remains chronological across mixed timezone offsets", () => {
  const db = setupMealsDb([
    { id: "a", calories: 100, loggedAt: "2026-10-25T01:10:00.000+01:00" },
    { id: "b", calories: 200, loggedAt: "2026-10-25T01:05:00.000+00:00" },
  ]);

  const rows = db
    .prepare(
      `
      SELECT id
      FROM meals
      ORDER BY julianday(logged_at) DESC
      `,
    )
    .all() as Array<{ id: string }>;

  assert.deepEqual(
    rows.map((row) => row.id),
    ["b", "a"],
  );
});
