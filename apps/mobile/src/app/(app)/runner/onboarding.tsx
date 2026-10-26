import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, Loading, Notice, ProgressBar } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useOnboarding, useOnboardingSaved } from '@/lib/queries';
import type { Onboarding } from '@/lib/types';

/** Registration hub: progress bar, the 15 steps, and the verification tracker once submitted. */
export default function RunnerOnboardingScreen() {
  const theme = useTheme();
  const { data, isLoading, error } = useOnboarding();
  const saved = useOnboardingSaved();
  const submit = useMutation({ mutationFn: () => api.post<Onboarding>('/runners/me/onboarding/submit'), onSuccess: saved });

  if (isLoading) return <Loading />;
  if (!data)
    return (
      <Screen>
        <Notice tone="error">{error?.message ?? 'Could not load your application'}</Notice>
      </Screen>
    );

  const editable = data.applicationStatus === 'DRAFT' || data.applicationStatus === 'REJECTED';

  return (
    <Screen
      footer={
        editable && (
          <Button title="Submit application" disabled={!data.canSubmit} loading={submit.isPending} onPress={() => submit.mutate()} />
        )
      }
    >
      {editable ? (
        <Card>
          <ThemedText type="smallBold">Profile {data.percentComplete}% complete</ThemedText>
          <ProgressBar percent={data.percentComplete} />
          <ThemedText type="small" themeColor="textSecondary">
            {data.canSubmit
              ? 'All required steps are done. Review and submit your application.'
              : `${data.missingRequired.length} required step${data.missingRequired.length === 1 ? '' : 's'} left.`}
          </ThemedText>
        </Card>
      ) : (
        <Card>
          <ThemedText type="smallBold">Verification status</ThemedText>
          {data.tracker.map((item) => (
            <ThemedText key={item.key} style={{ color: item.done ? theme.success : theme.textSecondary }}>
              {item.done ? '🟢' : '🟡'} {item.label}
            </ThemedText>
          ))}
        </Card>
      )}

      {data.applicationStatus === 'REJECTED' && (
        <Notice tone="error">Your application needs changes: {data.rejectionReason}. Update the details and submit again.</Notice>
      )}
      {submit.error && <Notice tone="error">{submit.error.message}</Notice>}

      {data.steps.map((step) => (
        <Pressable
          key={step.key}
          accessibilityRole="button"
          disabled={!editable || step.key === 'security'}
          onPress={() => (step.key === 'emergency-contact' ? router.push('/emergency-contact') : router.push(`/runner/${step.key}`))}
          style={({ pressed }) => [
            styles.step,
            { backgroundColor: theme.backgroundElement, borderColor: theme.border, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <View style={[styles.badge, { backgroundColor: step.complete ? theme.success : theme.backgroundSelected }]}>
            <ThemedText type="smallBold" style={{ color: step.complete ? '#fff' : theme.text }}>
              {step.complete ? '✓' : step.number}
            </ThemedText>
          </View>
          <View style={styles.stepText}>
            <ThemedText>{step.title}</ThemedText>
            {step.optional && (
              <ThemedText type="small" themeColor="textSecondary">
                Optional
              </ThemedText>
            )}
          </View>
          {editable && step.key !== 'security' && <ThemedText themeColor="textSecondary">›</ThemedText>}
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  badge: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepText: { flex: 1 },
});
