import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { kvStore } from "@/lib/kvStore";
import {
  THEME_MODE_STORAGE_KEY,
  THEME_MODE_SYSTEM,
  THEME_MODE_LIGHT,
  THEME_MODE_DARK,
} from "@/constants";

export type ThemeMode = "system" | "light" | "dark";

type ThemeModeContextValue = {
  mode: ThemeMode;
  setMode: (nextMode: ThemeMode) => void;
};

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(THEME_MODE_SYSTEM);

  useEffect(() => {
    try {
      const stored = kvStore.getString(THEME_MODE_STORAGE_KEY);
      if (
        stored === THEME_MODE_LIGHT ||
        stored === THEME_MODE_DARK ||
        stored === THEME_MODE_SYSTEM
      ) {
        setModeState(stored);
      }
    } catch {
      // Keep system as fallback if storage read fails.
    }
  }, []);

  const setMode = useCallback((nextMode: ThemeMode) => {
    setModeState(nextMode);
    try {
      kvStore.set(THEME_MODE_STORAGE_KEY, nextMode);
    } catch {
      // Ignore persistence failure and keep in-memory value.
    }
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return (
    <ThemeModeContext.Provider value={value}>
      {children}
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode() {
  const context = useContext(ThemeModeContext);
  if (!context) {
    throw new Error("useThemeMode must be used within ThemeModeProvider");
  }
  return context;
}
