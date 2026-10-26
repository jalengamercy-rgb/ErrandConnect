import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { passwordProblem } from '@/lib/validation';

export default function ResetPasswordScreen() {
  const { verificationToken } = useLocalSearchParams<{ verificationToken: string }>();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const problem = password ? passwordProblem(password) : undefined;
  const mismatch = confirm && confirm !== password ? 'Passwords do not match' : undefined;

  const reset = useMutation({ mutationFn: () => api.post('/auth/password/reset', { verificationToken, newPassword: password }) });

  if (reset.isSuccess) {
    return (
      <Screen title="Password changed" footer={<Button title="Log in" onPress={() => router.replace('/login')} />}>
        <Notice tone="success">Your password was reset and you were signed out of other devices.</Notice>
      </Screen>
    );
  }

  return (
    <Screen
      title="Choose a new password"
      footer={
        <Button title="Save password" disabled={!password || !!problem || confirm !== password} loading={reset.isPending} onPress={() => reset.mutate()} />
      }>
      <TextField label="New password" secureTextEntry autoComplete="new-password" value={password} onChangeText={setPassword} error={problem} />
      <TextField label="Confirm new password" secureTextEntry value={confirm} onChangeText={setConfirm} error={mismatch} />
      {reset.error && <Notice tone="error">{reset.error.message}</Notice>}
    </Screen>
  );
}
