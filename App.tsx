import type { NavigationState } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getDb } from './src/db/database';
import { RootNavigator } from './src/navigation/RootNavigator';
import { loadDraft } from './src/draftStore';
import { PrefsContext, applyPrefs, loadPrefs, savePrefs, type Prefs } from './src/prefs';
import { colors, spacing, themed } from './src/theme';

export default function App() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every settings change; keying the tree on it redraws every screen with
  // the new colours/language, and navState puts you back where you were.
  const [version, setVersion] = useState(0);
  const navState = useRef<NavigationState | undefined>(undefined);

  useEffect(() => {
    getDb()
      // Bring back any workout left unsaved by a crash before the Log tab mounts.
      .then(loadDraft)
      .then(loadPrefs)
      .then(setPrefs)
      .catch((e) => setError(String(e)));
  }, []);

  function update(change: Partial<Prefs>) {
    if (!prefs) return;
    const next = { ...prefs, ...change };
    applyPrefs(next);
    setPrefs(next);
    setVersion((v) => v + 1);
    savePrefs(next).catch(() => {});
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Could not open database</Text>
        <Text style={styles.errorBody}>{error}</Text>
      </View>
    );
  }

  if (!prefs) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <PrefsContext.Provider value={{ prefs, update }}>
        <RootNavigator key={version} initialState={navState.current} onStateChange={(s) => (navState.current = s)} />
      </PrefsContext.Provider>
    </SafeAreaProvider>
  );
}

const styles = themed(() => ({
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  errorTitle: {
    color: colors.danger,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  errorBody: {
    color: colors.textMuted,
    textAlign: 'center',
  },
}));
