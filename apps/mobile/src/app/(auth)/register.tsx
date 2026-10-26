import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { AuthResult } from '@/lib/types';
import { passwordProblem } from '@/lib/validation';

/** Step 3: name, password, PIN and agreements. */
export default function RegisterScreen() {
  const { verificationToken, accountType, phone } = useLocalSearchParams<{ verificationToken: string; accountType: 'CUSTOMER' | 'RUNNER'; phone: string }>();
  const { signIn } = useAuth();
  const isRunner = accountType === 'RUNNER';

  const [form, setForm] = useState({ firstName: '', middleName: '', lastName: '', email: '', password: '', confirm: '', pin: '', referralCode: '' });
  const [agree, setAgree] = useState({ terms: false, privacy: false, gps: isRunner, marketing: false });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const errors = {
    password: form.password && passwordProblem(form.password),
    confirm: form.confirm && form.confirm !== form.password ? 'Passwords do not match' : undefined,
    pin: form.pin && !/^\d{4}$/.test(form.pin) ? 'PIN must be 4 digits' : undefined,
  };
  const ready =
    form.firstName.trim() && form.lastName.trim() && form.password && form.confirm && form.pin &&
    !errors.password && !errors.confirm && !errors.pin && agree.terms && agree.privacy;

  const register = useMutation({
    mutationFn: () =>
      api.post<AuthResult>('/auth/register', {
        verificationToken,
        accountType,
        firstName: form.firstName,
        middleName: form.middleName || undefined,
        lastName: form.lastName,
        email: form.email || undefined,
        password: form.password,
        pin: form.pin,
        referralCode: form.referralCode || undefined,
        acceptTerms: agree.terms,
        acceptPrivacy: agree.privacy,
        allowGps: agree.gps,
        allowMarketing: agree.marketing,
      }),
    onSuccess: signIn,
  });

  return (
    <Screen
      title={isRunner ? 'Create your runner account' : 'Create your account'}
      subtitle={`Phone ${phone} verified ✓`}
      footer={<Button title="Create account" disabled={!ready} loading={register.isPending} onPress={() => register.mutate()} />}>
      <TextField label="First name" autoComplete="given-name" value={form.firstName} onChangeText={set('firstName')} />
      <TextField label="Middle name" optional autoComplete="additional-name" value={form.middleName} onChangeText={set('middleName')} />
      <TextField label="Last name" autoComplete="family-name" value={form.lastName} onChangeText={set('lastName')} />
      <TextField
        label="Email"
        optional={!isRunner}
        hint={isRunner ? 'Required later in your runner application' : undefined}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        value={form.email}
        onChangeText={set('email')}
      />
      <TextField
        label="Password"
        hint="At least 8 characters with a letter and a number"
        secureTextEntry
        autoComplete="new-password"
        value={form.password}
        onChangeText={set('password')}
        error={errors.password || undefined}
      />
      <TextField label="Confirm password" secureTextEntry value={form.confirm} onChangeText={set('confirm')} error={errors.confirm} />
      <TextField
        label="4-digit security PIN"
        hint="Used to confirm payments and sensitive actions"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={4}
        value={form.pin}
        onChangeText={(t) => set('pin')(t.replace(/\D/g, ''))}
        error={errors.pin}
      />
      <TextField label="Referral code" optional autoCapitalize="characters" value={form.referralCode} onChangeText={set('referralCode')} />

      <ThemedText type="smallBold">Agreements</ThemedText>
      <Checkbox label="I agree to the Terms & Conditions" checked={agree.terms} onChange={(v) => setAgree((a) => ({ ...a, terms: v }))} />
      <Checkbox label="I agree to the Privacy Policy" checked={agree.privacy} onChange={(v) => setAgree((a) => ({ ...a, privacy: v }))} />
      <Checkbox label="Allow location access for deliveries" checked={agree.gps} onChange={(v) => setAgree((a) => ({ ...a, gps: v }))} />
      <Checkbox
        label="Send me offers and news (optional)"
        checked={agree.marketing}
        onChange={(v) => setAgree((a) => ({ ...a, marketing: v }))}
      />
      {register.error && <Notice tone="error">{register.error.message}</Notice>}
    </Screen>
  );
}
