import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';

/** Step 2: enter the SMS code. */
export default function VerifyScreen() {
  const { phone, purpose, accountType } = useLocalSearchParams<{ phone: string; purpose: 'REGISTER' | 'RESET_PASSWORD'; accountType: string }>();
  const [code, setCode] = useState('');

  const verify = useMutation({
    mutationFn: () => api.post<{ verificationToken: string }>('/auth/otp/verify', { phone, purpose, code }),
    onSuccess: ({ verificationToken }) => {
      if (purpose === 'REGISTER') {
        router.replace({ pathname: '/register', params: { verificationToken, accountType, phone } });
      } else {
        router.replace({ pathname: '/reset-password', params: { verificationToken } });
      }
    },
  });

  const resend = useMutation({ mutationFn: () => api.post('/auth/otp/request', { phone, purpose }) });

  return (
    <Screen
      title="Enter the code"
      subtitle={`We sent a 6-digit code to ${phone}.`}
      footer={<Button title="Verify" disabled={code.length !== 6} loading={verify.isPending} onPress={() => verify.mutate()} />}>
      <TextField
        label="Verification code"
        placeholder="123456"
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={6}
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
        autoFocus
      />
      {verify.error && <Notice tone="error">{verify.error.message}</Notice>}
      {resend.isSuccess && <Notice tone="success">A new code is on its way.</Notice>}
      {resend.error && <Notice tone="error">{resend.error.message}</Notice>}
      <ThemedText type="small" themeColor="textSecondary">
        Didn&apos;t get it? Wait a minute, then resend.
      </ThemedText>
      <Button title="Resend code" variant="ghost" loading={resend.isPending} onPress={() => resend.mutate()} />
    </Screen>
  );
}
