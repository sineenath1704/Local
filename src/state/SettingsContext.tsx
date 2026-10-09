import React, { createContext, useContext, useMemo, useState, useCallback } from "react";

/**
 * SettingsContext — app-level settings (language) + session (logout).
 * Logout is a stub for now (auth system not built yet).
 */
export type AppLanguage = "th" | "en";

interface SettingsState {
  language: AppLanguage;
  setLanguage: (lang: AppLanguage) => void;
  loggedOut: boolean;
  logout: () => void;
  resetSession: () => void;
}

const SettingsContext = createContext<SettingsState | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [language, setLang] = useState<AppLanguage>("th");
  const [loggedOut, setLoggedOut] = useState(false);

  const setLanguage = useCallback((lang: AppLanguage) => setLang(lang), []);
  const logout = useCallback(() => setLoggedOut(true), []);
  const resetSession = useCallback(() => setLoggedOut(false), []);

  const value = useMemo<SettingsState>(
    () => ({ language, setLanguage, loggedOut, logout, resetSession }),
    [language, setLanguage, loggedOut, logout, resetSession]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within a SettingsProvider");
  return ctx;
}
