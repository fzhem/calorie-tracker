import type { MD3Theme } from "react-native-paper";

export function getAppSegmentedButtonsTheme(theme: MD3Theme) {
  return {
    colors: {
      secondaryContainer: theme.colors.primaryContainer,
      onSecondaryContainer: theme.colors.onPrimaryContainer,
      outline: theme.colors.outlineVariant,
    },
  };
}
