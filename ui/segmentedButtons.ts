import type { MD3Theme } from "react-native-paper";

/**
 * Corner radius applied to the SegmentedButtons container (style.borderRadius).
 *
 * React Native Paper sizes each segment's own corner radius as
 * `5 * theme.roundness`. The app's global roundness (8) would make each
 * segment radius 40, which is far larger than the container radius below.
 * When the segment radius exceeds the container radius, the selected
 * segment's fill is drawn with a tighter corner curve than the container,
 * so the container background bleeds through at the corners and looks like
 * colour "leaking" outside the buttons.
 *
 * We therefore clamp the segment roundness so the segment radius matches
 * the container radius. Keep this value in sync with the `borderRadius`
 * used on every `<SegmentedButtons style={...} />`.
 */
export const SEGMENTED_CONTROL_RADIUS = 14;

export function getAppSegmentedButtonsTheme(theme: MD3Theme) {
  return {
    // `5 * roundness` must equal SEGMENTED_CONTROL_RADIUS so the selected
    // segment fill aligns with the container's rounded corners.
    roundness: SEGMENTED_CONTROL_RADIUS / 5,
    colors: {
      secondaryContainer: theme.colors.primaryContainer,
      onSecondaryContainer: theme.colors.onPrimaryContainer,
      outline: theme.colors.outlineVariant,
    },
  };
}
