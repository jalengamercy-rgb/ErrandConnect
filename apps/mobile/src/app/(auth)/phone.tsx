import { normalizeKenyanPhone } from '@errandconnect/shared';
import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api, ApiError } from '@/lib/api';

/** Step 1 of sign-up and password reset: enter phone, receive an SMS code. */
export default function PhoneScreen() {
  const { purpose = 'REGISTER', accountType } = useLocalSearchParams<{ purpose: 'REGISTER' | 'RESET_PASSWORD'; accountType?: string }>();
  const [input, setInput] = useState('');
  const phone = normalizeKenyanPhone(input);

  const request = useMutation({
    mutationFn: () => api.post('/auth/otp/request', { phone, purpose }),
    onSuccess: () => router.push({ pathname: '/verify', params: { phone: phone!, purpose, accountType: accountType ?? '' } }),
  });
  const alreadyRegistered = request.error instanceof ApiError && request.error.status === 409;

  return (
    <Screen
      title={purpose === 'REGISTER' ? 'Your phone number' : 'Reset your password'}
      subtitle="We'll send you a 6-digit code by SMS."
      footer={<Button title="Send code" disabled={!phone} loading={request.isPending} onPress={() => request.mutate()} />}>
      <TextField
        label="Mobile number"
        placeholder="0712 345 678"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        value={input}
        onChangeText={setInput}
        error={input.length >= 9 && !phone ? 'Enter a valid Safaricom, Airtel or Telkom number' : undefined}
        autoFocus
      />
      {request.error && <Notice tone="error">{request.error.message}</Notice>}
      {alreadyRegistered && <Button title="Go to log in" variant="secondary" onPress={() => router.replace('/login')} />}
    </Screen>
  );
}
