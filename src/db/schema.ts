import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from "drizzle-orm/sqlite-core";

import {
  DB_TABLE_MEALS,
  DB_TABLE_WEIGHT_HISTORY,
  DB_TABLE_BODY_FAT_HISTORY,
  IDX_MEALS_LOGGED_AT,
  IDX_WEIGHT_RECORDED_AT,
  IDX_WEIGHT_SOURCE,
  IDX_BODYFAT_RECORDED_AT,
  SOURCE_MANUAL,
  SOURCE_HEALTH_CONNECT,
} from "../constants";

export const meals = sqliteTable(
  DB_TABLE_MEALS,
  {
    id: text("id").primaryKey(),

    title: text("title").notNull(),
    calories: integer("calories").notNull(),

    proteinGrams: real("protein_g"),
    fatGrams: real("fat_g"),
    carbsGrams: real("carbs_g"),
    fibreGrams: real("fibre_g"),

    loggedAt: text("logged_at").notNull(),
  },
  (table) => [index(IDX_MEALS_LOGGED_AT).on(table.loggedAt)],
);

export const weightHistory = sqliteTable(
  DB_TABLE_WEIGHT_HISTORY,
  {
    id: text("id").primaryKey(),

    recordedAt: text("recorded_at").notNull(),
    weightKg: real("weight_kg").notNull(),

    source: text("source", {
      enum: [SOURCE_MANUAL, SOURCE_HEALTH_CONNECT],
    }).notNull(),

    originAppId: text("origin_app_id"),
    originAppName: text("origin_app_name"),
    originDevice: text("origin_device"),
  },
  (table) => [
    index(IDX_WEIGHT_RECORDED_AT).on(table.recordedAt),
    index(IDX_WEIGHT_SOURCE).on(table.source),
  ],
);

export const bodyFatHistory = sqliteTable(
  DB_TABLE_BODY_FAT_HISTORY,
  {
    id: text("id").primaryKey(),

    recordedAt: text("recorded_at").notNull(),
    bodyFatPercentage: real("body_fat_percentage").notNull(),

    source: text("source").default(SOURCE_HEALTH_CONNECT).notNull(),

    originAppId: text("origin_app_id"),
    originAppName: text("origin_app_name"),
    originDevice: text("origin_device"),
  },
  (table) => [index(IDX_BODYFAT_RECORDED_AT).on(table.recordedAt)],
);
