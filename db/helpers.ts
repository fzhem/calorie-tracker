/** Deterministic ID helpers */
function epochMs(isoString: string): string {
  return String(Date.parse(isoString));
}

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SLUG_MAX_LENGTH);
}

export function makeMealId(meal: {
  loggedAt: string;
  title: string;
  calories: number;
}): string {
  return `${epochMs(meal.loggedAt)}-${slugify(meal.title)}-${meal.calories}`;
}

export function makeWeightId(point: {
  recordedAt: string;
  source: string;
  weightKg: number;
}): string {
  return `${epochMs(point.recordedAt)}-${point.source}-${point.weightKg}`;
}

export function makeBodyFatId(point: {
  recordedAt: string;
  bodyFatPercentage: number;
}): string {
  return `${epochMs(point.recordedAt)}-${point.bodyFatPercentage}`;
}

export function makeRecipeId(name: string): string {
  return `recipe-${slugify(name)}-${Date.now()}`;
}

import { SLUG_MAX_LENGTH } from "@/constants";
