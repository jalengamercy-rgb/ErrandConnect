import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { ME_QUERY_KEY, useAuth } from '@/lib/auth-context';
import type { Me } from '@/lib/types';

export default function VerifyEmailScreen() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');

  const send = useMutation({ mutationFn: () => api.post('/me/email/verify/request') });
  const confirm = useMutation({
    mutationFn: () => api.post<Me>('/me/email/verify/confirm', { code }),
    onSuccess: (updated) => {
      queryClient.setQueryData(ME_QUERY_KEY, updated);
      router.back();
    },
  });

  return (
    <Screen
      title="Verify your email"
      subtitle={`We'll send a code to ${me?.email}. Verified email raises your order limits (Level 2).`}
      footer={
        send.isSuccess ? (
          <Button title="Confirm" disabled={code.length !== 6} loading={confirm.isPending} onPress={() => confirm.mutate()} />
        ) : (
          <Button title="Send code" loading={send.isPending} onPress={() => send.mutate()} />
        )
      }
    >
      {send.isSuccess && (
        <TextField
          label="Code from your email"
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
          autoFocus
        />
      )}
      {send.error && <Notice tone="error">{send.error.message}</Notice>}
      {confirm.error && <Notice tone="error">{confirm.error.message}</Notice>}
    </Screen>
  );
}
