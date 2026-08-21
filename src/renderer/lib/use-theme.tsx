import { useCallback, useLayoutEffect, type ReactNode } from "react";
import { applyCodexThemeVariant } from "./codex-theme-variant";
import {
  appScope,
  atomWithExternalStore,
  scopedAtomWithInitializer,
  useScopedAtom,
  useScopedAtomValue,
} from "./maitai";

type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  resolved: Resolved;
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = "nodex-theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

const themePreferenceAtom = scopedAtomWithInitializer<Theme>(
  appScope,
  () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
  },
  { debugLabel: "theme-preference" },
);

const systemDarkAtom = atomWithExternalStore(appScope, {
  debugLabel: "system-dark-preference",
  getSnapshot: () => window.matchMedia(MEDIA_QUERY).matches,
  subscribe: (listener) => {
    const mediaQuery = window.matchMedia(MEDIA_QUERY);
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  },
});

function syncDocumentThemeClasses(resolved: Resolved): void {
  const root = document.documentElement;
  const isDark = resolved === "dark";

  root.classList.toggle("dark", isDark);
  applyCodexThemeVariant(root, resolved, document.body);

  if (root.dataset.codexWindowType !== "electron") return;

  root.classList.toggle("electron-dark", isDark);
  root.classList.toggle("electron-light", !isDark);
}

function useThemeInternal(): ThemeContextValue {
  const [theme, setThemeState] = useScopedAtom(themePreferenceAtom);
  const systemDark = useScopedAtomValue(systemDarkAtom);

  const resolved: Resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  const setTheme = useCallback(
    (next: Theme) => {
      localStorage.setItem(STORAGE_KEY, next);
      setThemeState(next);
    },
    [setThemeState],
  );

  return { theme, resolved, setTheme };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const value = useThemeInternal();
  useLayoutEffect(() => {
    syncDocumentThemeClasses(value.resolved);
  }, [value.resolved]);
  return children;
}

export function useTheme(): ThemeContextValue {
  return useThemeInternal();
}
