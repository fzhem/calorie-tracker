import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { kvStore } from './kvStore';

export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_MODE_STORAGE_KEY = 'calorie-tracker-theme-mode-v1';

type ThemeModeContextValue = {
  mode: ThemeMode;
  setMode: (nextMode: ThemeMode) => void;
};

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    try {
      const stored = kvStore.getString(THEME_MODE_STORAGE_KEY);
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
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

  return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

export function useThemeMode() {
  const context = useContext(ThemeModeContext);
  if (!context) {
    throw new Error('useThemeMode must be used within ThemeModeProvider');
  }
  return context;
}
