import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Coloured message box for errors, warnings and confirmations. */
export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'warning' | 'success'; children: ReactNode }) {
  const theme = useTheme();
  const color = { info: theme.primary, error: theme.danger, warning: theme.warning, success: theme.success }[tone];
  return (
    <View accessibilityRole={tone === 'error' ? 'alert' : undefined} style={[styles.notice, { borderColor: color }]}>
      <ThemedText type="small" style={{ color }}>
        {children}
      </ThemedText>
    </View>
  );
}

export function ProgressBar({ percent }: { percent: number }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={[styles.track, { backgroundColor: theme.backgroundSelected }]}
    >
      <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, percent))}%`, backgroundColor: theme.primary }]} />
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      {children}
    </ThemedView>
  );
}

export function Loading() {
  const theme = useTheme();
  return (
    <ThemedView style={styles.loading}>
      <ActivityIndicator size="large" color={theme.primary} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  notice: { borderLeftWidth: 4, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Radius.small },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  card: { borderRadius: Radius.medium, padding: Spacing.three, gap: Spacing.two },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
