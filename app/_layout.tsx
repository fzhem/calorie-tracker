import { Stack } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect, useMemo, useState } from "react";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import { StatusBar, useColorScheme } from "react-native";
import { PaperProvider } from "react-native-paper";
import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";

import { loadStoredData } from "@/data/storage";
import { ThemeModeProvider, useThemeMode } from "@/ui/themeMode";
import { useMigrations } from "drizzle-orm/op-sqlite/migrator";
import migrations from "@/drizzle/migrations";
import { database } from "@/db";
import { APP_DARK_THEME, APP_LIGHT_THEME } from "@/constants/Colors";

export default function RootLayout() {
  const [assetsReady, setAssetsReady] = useState(false);

  const { success: migrationSuccess, error: migrationError } = useMigrations(
    database,
    migrations,
  );

  useEffect(() => {
    if (migrationError) {
      console.error("Migration failed:", migrationError);
    }
  }, [migrationError]);

  useEffect(() => {
    async function prepare() {
      try {
        await SplashScreen.preventAutoHideAsync();
        await Font.loadAsync(MaterialCommunityIcons.font);
        await loadStoredData();
      } catch (e) {
        // Ignore errors, app will still load
      } finally {
        setAssetsReady(true);
        await SplashScreen.hideAsync();
      }
    }
    prepare();
  }, []);

  if (!assetsReady) {
    return null;
  }

  return (
    <ThemeModeProvider>
      <RootWithTheme />
    </ThemeModeProvider>
  );
}

function RootWithTheme() {
  const { mode } = useThemeMode();
  const systemScheme = useColorScheme();
  const resolvedMode =
    mode === "system" ? (systemScheme === "dark" ? "dark" : "light") : mode;
  const paperTheme = useMemo(
    () => (resolvedMode === "dark" ? APP_DARK_THEME : APP_LIGHT_THEME),
    [resolvedMode],
  );

  const navTheme = useMemo(() => {
    const baseNav =
      resolvedMode === "dark" ? NavigationDarkTheme : NavigationDefaultTheme;
    return {
      ...baseNav,
      colors: {
        ...baseNav.colors,
        background: paperTheme.colors.background,
        card: paperTheme.colors.surface,
        text: paperTheme.colors.onSurface,
        border: paperTheme.colors.outlineVariant,
        primary: paperTheme.colors.primary,
      },
    };
  }, [paperTheme, resolvedMode]);

  return (
    <PaperProvider theme={paperTheme}>
      <ThemeProvider value={navTheme}>
        <StatusBar
          barStyle={resolvedMode === "dark" ? "light-content" : "dark-content"}
          backgroundColor={paperTheme.colors.background}
        />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </ThemeProvider>
    </PaperProvider>
  );
}
