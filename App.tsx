import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme as NavigationDarkTheme, DefaultTheme as NavigationDefaultTheme, NavigationContainer } from '@react-navigation/native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MD3DarkTheme, MD3LightTheme, PaperProvider, type MD3Theme } from 'react-native-paper';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';

import GoalsScreen from './screens/GoalsScreen';
import GraphsScreen from './screens/GraphsScreen';
import LogScreen from './screens/LogScreen';
import SettingsScreen from './screens/SettingsScreen';
import { loadStoredData } from './storage';
import { ThemeModeProvider, useThemeMode } from './themeMode';

const Tab = createBottomTabNavigator();

const APP_LIGHT_THEME: MD3Theme = {
  ...MD3LightTheme,
  roundness: 5,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#146c43',
    onPrimary: '#ffffff',
    secondary: '#5b5f97',
    onSecondary: '#ffffff',
    tertiary: '#9a3d2e',
    background: '#f8f9f3',
    surface: '#f8f9f3',
    surfaceVariant: '#dbe7dc',
    onSurfaceVariant: '#344f40',
    outline: '#6f8475',
    error: '#ba1a1a',
  },
};

const APP_DARK_THEME: MD3Theme = {
  ...MD3DarkTheme,
  roundness: 5,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#7fd8a5',
    onPrimary: '#003822',
    secondary: '#c2c5ff',
    onSecondary: '#2c2f64',
    tertiary: '#ffb4a8',
    background: '#000000',
    surface: '#000000',
    surfaceVariant: '#1c1f1d',
    onSurfaceVariant: '#c3c9c4',
    outline: '#7b837d',
    error: '#ffb4ab',
    elevation: {
      level0: '#000000',
      level1: '#0d0f0e',
      level2: '#111412',
      level3: '#161a18',
      level4: '#181d1a',
      level5: '#1c221e',
    },
  },
};

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const TAB_ICONS: Record<string, IconName> = {
  Log: 'food-apple-outline',
  Graphs: 'chart-bar',
  Goals: 'bullseye',
  Settings: 'cog-outline',
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
        duration: 320,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(rippleOpacity, {
        toValue: 0,
        duration: 320,
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
  useEffect(() => {
    loadStoredData()
      .catch(() => {
        // Screens already handle storage errors; keep app startup resilient.
      });
  }, []);

  return (
    <ThemeModeProvider>
      <AppWithTheme />
    </ThemeModeProvider>
  );
}

function AppWithTheme() {
  const { mode } = useThemeMode();
  const systemScheme = useColorScheme();
  const resolvedMode = mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;
  const paperTheme = useMemo(
    () => (resolvedMode === 'dark' ? APP_DARK_THEME : APP_LIGHT_THEME),
    [resolvedMode],
  );

  const navTheme = useMemo(() => {
    const baseNav = resolvedMode === 'dark' ? NavigationDarkTheme : NavigationDefaultTheme;
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
            height: 66 + insets.bottom,
            paddingTop: 8,
            paddingBottom: Math.max(10, insets.bottom),
          },
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
          tabBarLabelStyle: { fontSize: 12, fontWeight: '700', paddingBottom: 3 },
          tabBarButton: (props) => <RippleTabBarButton {...props} rippleColor={theme.colors.primary} />,
          tabBarIcon: ({ focused, color }) => (
            <MaterialCommunityIcons
              name={TAB_ICONS[route.name] ?? 'circle-outline'}
              color={color}
              size={focused ? 24 : 22}
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
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tabRipple: {
    width: 140,
    height: 140,
    borderRadius: 70,
  },
});
