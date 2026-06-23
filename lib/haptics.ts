import { Vibration } from "react-native";

/** Standardised haptic pulse durations, in milliseconds.
 *
 *  Centralised so every screen speaks the same vocabulary instead of
 *  scattering ad-hoc magic numbers (`Vibration.vibrate(12)`, `(18)`, …).
 *  Three intent-based levels cover everything the app needs:
 *
 *  - `tap`    light feedback for routine UI: opening, toggling, picking, and
 *             committing (adding a meal, saving a recipe).
 *  - `select` a fuller thunk for deliberate choices: segmented controls and
 *             long-press.
 *  - `warn`   a strong pulse for destructive or protected actions: clearing
 *             data and unlocking guarded fields.
 *
 *  Differences under ~15 ms are barely perceptible, so call sites should pick
 *  a level by *intent*, not by fine-tuning the number. */
export const HAPTIC_MS = {
  tap: 10,
  select: 20,
  warn: 40,
} as const;

export type HapticKind = keyof typeof HAPTIC_MS;

/** Fire a standardised haptic pulse. Defaults to a light `tap`. */
export function haptic(kind: HapticKind = "tap"): void {
  Vibration.vibrate(HAPTIC_MS[kind]);
}
