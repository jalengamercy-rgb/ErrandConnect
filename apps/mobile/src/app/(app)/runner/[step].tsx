import { RUNNER_ONBOARDING_STEPS, type RunnerOnboardingStepKey } from '@errandconnect/shared';
import { Stack, useLocalSearchParams } from 'expo-router';

import { Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { STEP_FORMS } from '@/features/runner/steps';
import { useOnboarding } from '@/lib/queries';

/** Shows the form for one registration step, e.g. /runner/personal. */
export default function RunnerStepScreen() {
  const { step } = useLocalSearchParams<{ step: RunnerOnboardingStepKey }>();
  const { data, isLoading } = useOnboarding();
  const index = RUNNER_ONBOARDING_STEPS.findIndex((s) => s.key === step);
  const Form = STEP_FORMS[step];

  if (isLoading) return <Loading />;
  if (!data || index < 0 || !Form) {
    return (
      <Screen>
        <Notice tone="error">This step could not be found.</Notice>
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: `Step ${index + 1} of ${RUNNER_ONBOARDING_STEPS.length}` }} />
      <Form data={data} />
    </>
  );
}
