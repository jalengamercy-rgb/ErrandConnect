import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';

interface ScreenProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  /** Pinned to the bottom, e.g. the main button of a form. */
  footer?: ReactNode;
}

/** Scrollable page with safe-area padding, keyboard handling and a centred column on wide screens. */
export function Screen({ title, subtitle, children, footer }: ScreenProps) {
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.root} edges={['bottom', 'left', 'right']}>
        <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.column}>
              {title && (
                <View style={styles.header}>
                  <ThemedText type="subtitle">{title}</ThemedText>
                  {subtitle && <ThemedText themeColor="textSecondary">{subtitle}</ThemedText>}
                </View>
              )}
              {children}
            </View>
          </ScrollView>
          {footer && <View style={[styles.column, styles.footer]}>{footer}</View>}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { flexGrow: 1, alignItems: 'center', paddingVertical: Spacing.four },
  column: { width: '100%', maxWidth: MaxContentWidth, paddingHorizontal: Spacing.three, gap: Spacing.three, alignSelf: 'center' },
  header: { gap: Spacing.one, marginBottom: Spacing.two },
  footer: { paddingVertical: Spacing.three },
});
