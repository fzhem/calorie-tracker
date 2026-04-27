import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
  NavigationContainer,
} from "@react-navigation/native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useEffect, useMemo, useRef, useState } from "react";
import * as SplashScreen from "expo-splash-screen";
import * as Font from "expo-font";
import {
  Animated,
  Easing,
  Pressable,
  StatusBar,
  StyleSheet,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PaperProvider, type MD3Theme } from "react-native-paper";
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";

import GoalsScreen from "../screens/GoalsScreen";
import GraphsScreen from "../screens/GraphsScreen";
import LogScreen from "../screens/LogScreen";
import SettingsScreen from "../screens/SettingsScreen";
import { loadStoredData } from "../data/storage";
import { ThemeModeProvider, useThemeMode } from "../ui/themeMode";
import { useMigrations } from "drizzle-orm/op-sqlite/migrator";
import migrations from "../drizzle/migrations";
import { database } from "../db";
import { APP_DARK_THEME, APP_LIGHT_THEME } from "../constants/Colors";
import {
  TAB_ICON_LOG,
  TAB_ICON_GRAPHS,
  TAB_ICON_GOALS,
  TAB_ICON_SETTINGS,
  TAB_RIPPLE_DURATION_MS,
  TAB_BAR_HEIGHT_BASE,
  TAB_BAR_PADDING_TOP,
  TAB_BAR_PADDING_BOTTOM_MIN,
  TAB_ICON_SIZE_FOCUSED,
  TAB_ICON_SIZE_UNFOCUSED,
  TAB_LABEL_FONT_SIZE,
  TAB_LABEL_FONT_WEIGHT,
  TAB_LABEL_PADDING_BOTTOM,
  TAB_RIPPLE_SIZE,
  TAB_RIPPLE_BORDER_RADIUS,
} from "../constants";

const Tab = createBottomTabNavigator();

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const TAB_ICONS: Record<string, IconName> = {
  Log: TAB_ICON_LOG,
  Graphs: TAB_ICON_GRAPHS,
  Goals: TAB_ICON_GOALS,
  Settings: TAB_ICON_SETTINGS,
};

function RippleTabBarButton({
  children,
  onPress,
  onLongPress,
  accessibilityState,
  accessibilityLabel,
  testID,
  style,
  rippleColor,
}: BottomTabBarButtonProps & { rippleColor: string }) {
  const rippleScale = useRef(new Animated.Value(0)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;

  const triggerRipple = () => {
    rippleScale.setValue(0);
    rippleOpacity.setValue(0.24);

    Animated.parallel([
      Animated.timing(rippleScale, {
        toValue: 1,
        duration: TAB_RIPPLE_DURATION_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(rippleOpacity, {
        toValue: 0,
        duration: TAB_RIPPLE_DURATION_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  };

  return (
    <Pressable
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPressIn={triggerRipple}
      onLongPress={onLongPress}
      onPress={(event) => {
        onPress?.(event);
      }}
      style={style}
    >
      <View pointerEvents="none" style={styles.tabRippleContainer}>
        <Animated.View
          style={[
            styles.tabRipple,
            {
              backgroundColor: rippleColor,
              opacity: rippleOpacity,
              transform: [{ scale: rippleScale }],
            },
          ]}
        />
      </View>
      {children}
    </Pressable>
  );
}

export default function App() {
  const [assetsReady, setAssetsReady] = useState(false);

  const { success: migrationSuccess, error: migrationError } = useMigrations(database, migrations);

  useEffect(() => {
    if (migrationError) {
      console.error("Migration failed:", migrationError);
    }
  }, [migrationError]);

  useEffect(() => {
    async function prepare() {
      try {
        await SplashScreen.preventAutoHideAsync();
        // Preload fonts (MaterialCommunityIcons is used by react-native-paper and navigation)
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
      <AppWithTheme />
    </ThemeModeProvider>
  );
}

function AppWithTheme() {
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
      <StatusBar
        barStyle={resolvedMode === "dark" ? "light-content" : "dark-content"}
        backgroundColor={paperTheme.colors.background}
      />
      <AppTabs theme={paperTheme} navTheme={navTheme} />
    </PaperProvider>
  );
}

function AppTabs({
  theme,
  navTheme,
}: {
  theme: MD3Theme;
  navTheme: typeof NavigationDefaultTheme;
}) {
  const insets = useSafeAreaInsets();

  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        detachInactiveScreens
        screenOptions={({ route }) => ({
          lazy: true,
          freezeOnBlur: true,
          headerShown: false,
          tabBarStyle: {
            backgroundColor: theme.colors.surface,
            borderTopColor: theme.colors.outlineVariant,
            borderTopWidth: 1,
            height: TAB_BAR_HEIGHT_BASE + insets.bottom,
            paddingTop: TAB_BAR_PADDING_TOP,
            paddingBottom: Math.max(TAB_BAR_PADDING_BOTTOM_MIN, insets.bottom),
          },
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
          tabBarLabelStyle: {
            fontSize: TAB_LABEL_FONT_SIZE,
            fontWeight: TAB_LABEL_FONT_WEIGHT,
            paddingBottom: TAB_LABEL_PADDING_BOTTOM,
          },
          tabBarButton: (props) => (
            <RippleTabBarButton {...props} rippleColor={theme.colors.primary} />
          ),
          tabBarIcon: ({ focused, color }) => (
            <MaterialCommunityIcons
              name={TAB_ICONS[route.name] ?? "circle-outline"}
              color={color}
              size={focused ? TAB_ICON_SIZE_FOCUSED : TAB_ICON_SIZE_UNFOCUSED}
            />
          ),
        })}
      >
        <Tab.Screen name="Log" component={LogScreen} />
        <Tab.Screen name="Graphs" component={GraphsScreen} />
        <Tab.Screen name="Goals" component={GoalsScreen} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  tabRippleContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  tabRipple: {
    width: TAB_RIPPLE_SIZE,
    height: TAB_RIPPLE_SIZE,
    borderRadius: TAB_RIPPLE_BORDER_RADIUS,
  },
});
