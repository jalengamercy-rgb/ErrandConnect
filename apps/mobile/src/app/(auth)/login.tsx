import { normalizeKenyanPhone } from '@errandconnect/shared';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AuthResult } from '@/lib/types';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [phoneInput, setPhoneInput] = useState('');
  const [password, setPassword] = useState('');
  const phone = normalizeKenyanPhone(phoneInput);

  const login = useMutation({
    mutationFn: () => api.post<AuthResult>('/auth/login', { phone, password }),
    onSuccess: signIn,
  });

  return (
    <Screen
      title="Welcome back"
      footer={<Button title="Log in" disabled={!phone || !password} loading={login.isPending} onPress={() => login.mutate()} />}
    >
      <TextField
        label="Mobile number"
        placeholder="0712 345 678"
        keyboardType="phone-pad"
        autoComplete="tel"
        value={phoneInput}
        onChangeText={setPhoneInput}
        autoFocus
      />
      <TextField label="Password" secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} />
      {login.error && <Notice tone="error">{login.error.message}</Notice>}
      <Button
        title="Forgot password?"
        variant="ghost"
        onPress={() => router.push({ pathname: '/phone', params: { purpose: 'RESET_PASSWORD' } })}
      />
    </Screen>
  );
}
