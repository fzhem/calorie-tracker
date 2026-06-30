import { Tabs } from "expo-router";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "react-native-paper";
import type { BottomTabBarButtonProps } from "expo-router/js-tabs";

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
} from "@/constants";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

const TAB_ICONS: Record<string, IconName> = {
  log: TAB_ICON_LOG,
  graphs: TAB_ICON_GRAPHS,
  goals: TAB_ICON_GOALS,
  settings: TAB_ICON_SETTINGS,
};

function RippleTabBarButton({
  children,
  onPress,
  onLongPress,
  accessibilityState,
  accessibilityLabel,
  testID,
  style,
}: BottomTabBarButtonProps) {
  const rippleScale = useRef(new Animated.Value(0)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;
  const theme = useTheme();

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
              backgroundColor: theme.colors.primary,
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

export default function TabLayout() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={({ route }) => ({
        lazy: true,
        freezeOnBlur: true,
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.colors.elevation.level2,
          borderTopColor: theme.colors.outlineVariant,
          borderTopWidth: 1,
          height: TAB_BAR_HEIGHT_BASE + insets.bottom,
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarLabelStyle: {
          fontSize: TAB_LABEL_FONT_SIZE,
          fontWeight: TAB_LABEL_FONT_WEIGHT,
          paddingBottom: TAB_LABEL_PADDING_BOTTOM,
        },
        tabBarButton: (props) => <RippleTabBarButton {...props} />,
        tabBarIcon: ({ focused, color }) => (
          <MaterialCommunityIcons
            name={TAB_ICONS[route.name] ?? "circle-outline"}
            color={color}
            size={focused ? TAB_ICON_SIZE_FOCUSED : TAB_ICON_SIZE_UNFOCUSED}
          />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="log" options={{ title: "Log" }} />
      <Tabs.Screen name="graphs" options={{ title: "Graphs" }} />
      <Tabs.Screen name="goals" options={{ title: "Goals" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabRippleContainer: {
    ...StyleSheet.absoluteFill,
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
