import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { THEMES, buildSemantic, type ThemeKey, type SemanticTokens, type ThemeColors } from './visualLanguage';

export interface ThemeContextValue {
  themeKey: ThemeKey;
  COLORS: ThemeColors;
  SEMANTIC: SemanticTokens;
  toggleTheme: () => void;
  setTheme: (key: ThemeKey) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ 
  children, 
  initialTheme = 'dark' 
}: { 
  children: ReactNode; 
  initialTheme?: ThemeKey;
}) {
  const [themeKey, setThemeKey] = useState<ThemeKey>(initialTheme);

  useEffect(() => {
    if (themeKey === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [themeKey]);

  const value = useMemo(() => {
    const palette = THEMES[themeKey];
    const semantic = buildSemantic(palette);

    const toggleTheme = () => {
      setThemeKey(prev => prev === 'dark' ? 'light' : 'dark');
    };

    return {
      themeKey,
      COLORS: palette,
      SEMANTIC: semantic,
      toggleTheme,
      setTheme: setThemeKey,
    };
  }, [themeKey]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

export function useThemeTokens(): SemanticTokens {
  return useTheme().SEMANTIC;
}
