import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from "react-native-paper";

export const APP_LIGHT_THEME: MD3Theme = {
  ...MD3LightTheme,
  roundness: 5,
  colors: {
    ...MD3LightTheme.colors,
    primary: "#146c43",
    onPrimary: "#ffffff",
    secondary: "#5b5f97",
    onSecondary: "#ffffff",
    tertiary: "#ff6d00",
    tertiaryContainer: "#ffe0b2",
    background: "#f8f9f3",
    surface: "#f8f9f3",
    surfaceVariant: "#dbe7dc",
    onSurfaceVariant: "#344f40",
    outline: "#6f8475",
    error: "#b71c1c",
    inversePrimary: "#4f378b",
  },
};

export const APP_DARK_THEME: MD3Theme = {
  ...MD3DarkTheme,
  roundness: 5,
  colors: {
    ...MD3DarkTheme.colors,
    primary: "#7fd8a5",
    onPrimary: "#003822",
    secondary: "#c2c5ff",
    onSecondary: "#2c2f64",
    tertiary: "#ffab40",
    tertiaryContainer: "#5d4037",
    background: "#000000",
    surface: "#000000",
    surfaceVariant: "#1c1f1d",
    onSurfaceVariant: "#c3c9c4",
    outline: "#7b837d",
    error: "#d32f2f",
    inversePrimary: "#4f378b",
    elevation: {
      level0: "#000000",
      level1: "#0d0f0e",
      level2: "#111412",
      level3: "#161a18",
      level4: "#181d1a",
      level5: "#1c221e",
    },
  },
};
