import { Stack } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import { AppState, StatusBar, useColorScheme } from "react-native";
import { PaperProvider } from "react-native-paper";
import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
  ThemeProvider,
} from "expo-router/react-navigation";

import {
  getCachedData,
  flushPendingStoredDataWrites,
  loadStoredData,
} from "@/data/storage";
import { ThemeModeProvider, useThemeMode } from "@/ui/themeMode";
import { AUTO_SYNC_INTERVAL_MS } from "@/constants";
import { syncHealthConnectData } from "@/lib/healthConnectSync";
import { useMigrations } from "drizzle-orm/op-sqlite/migrator";
import migrations from "@/drizzle/migrations";
import { database } from "@/db";
import { APP_DARK_THEME, APP_LIGHT_THEME } from "@/constants/Colors";

export default function RootLayout() {
  const [assetsReady, setAssetsReady] = useState(false);
  const syncInFlightRef = useRef(false);

  const runAutoSync = useCallback(async () => {
    const cached = getCachedData();
    if (!cached?.healthConnectAutoSync) return;
    if (syncInFlightRef.current) return;

    syncInFlightRef.current = true;
    try {
      await syncHealthConnectData();
    } finally {
      syncInFlightRef.current = false;
    }
  }, []);

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

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        void flushPendingStoredDataWrites();
      }

      const wasBackgrounded =
        previousState === "background" || previousState === "inactive";
      if (wasBackgrounded && nextState === "active") {
        void runAutoSync();
      }

      previousState = nextState;
    });

    return () => {
      subscription.remove();
    };
  }, [runAutoSync]);

  useEffect(() => {
    // Run an initial sync shortly after app launch, then repeat on interval.
    // We read healthConnectAutoSync from the cache populated by loadStoredData.
    const initialTimer = setTimeout(() => {
      void runAutoSync();
    }, 2000);
    const interval = setInterval(() => {
      void runAutoSync();
    }, AUTO_SYNC_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [runAutoSync]);

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
