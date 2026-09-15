import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'site-release-manager.backend-mode';
export const BackendModeContext = createContext({
  backendMode: 'txt',
  setBackendMode: () => {},
  isTxtMode: true,
  isMongoMode: false,
  hasProvider: false,
});

function initialMode() {
  if (typeof window === 'undefined') return 'txt';
  return window.localStorage.getItem(STORAGE_KEY) === 'mongo' ? 'mongo' : 'txt';
}

export function BackendModeProvider({ children }) {
  const [backendMode, setBackendModeState] = useState(initialMode);
  const setBackendMode = (value) => setBackendModeState(value === 'mongo' ? 'mongo' : 'txt');

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, backendMode);
    document.documentElement.dataset.backendMode = backendMode;
  }, [backendMode]);

  const value = useMemo(() => ({
    backendMode,
    setBackendMode,
    isTxtMode: backendMode === 'txt',
    isMongoMode: backendMode === 'mongo',
    hasProvider: true,
  }), [backendMode]);

  return <BackendModeContext.Provider value={value}>{children}</BackendModeContext.Provider>;
}

export function useBackendMode() {
  return useContext(BackendModeContext);
}
