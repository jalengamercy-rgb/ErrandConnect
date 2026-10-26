import { normalizeKenyanPhone } from '@errandconnect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { queryKeys, useEmergencyContact } from '@/lib/queries';
import type { EmergencyContact } from '@/lib/types';

/** Also step 6 of runner registration. */
export default function EmergencyContactScreen() {
  const { data, isLoading } = useEmergencyContact();
  if (isLoading) return <Loading />;
  return <EmergencyContactForm initial={data ?? null} />;
}

function EmergencyContactForm({ initial }: { initial: EmergencyContact | null }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    fullName: initial?.fullName ?? '',
    relationship: initial?.relationship ?? '',
    phone: initial?.phone ?? '',
    altPhone: initial?.altPhone ?? '',
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const phoneOk = !!normalizeKenyanPhone(form.phone);
  const altOk = !form.altPhone || !!normalizeKenyanPhone(form.altPhone);
  const save = useMutation({
    mutationFn: () => api.put('/me/emergency-contact', { ...form, altPhone: form.altPhone || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.emergencyContact });
      queryClient.invalidateQueries({ queryKey: queryKeys.onboarding });
      router.back();
    },
  });

  return (
    <Screen
      title="Emergency contact"
      subtitle="Someone we can call if something happens to you during an errand."
      footer={
        <Button
          title="Save"
          disabled={form.fullName.trim().length < 2 || form.relationship.trim().length < 2 || !phoneOk || !altOk}
          loading={save.isPending}
          onPress={() => save.mutate()}
        />
      }>
      <TextField label="Full name" value={form.fullName} onChangeText={set('fullName')} />
      <TextField label="Relationship" placeholder="e.g. Sister, Spouse, Friend" value={form.relationship} onChangeText={set('relationship')} />
      <TextField
        label="Phone number"
        keyboardType="phone-pad"
        value={form.phone}
        onChangeText={set('phone')}
        error={form.phone && !phoneOk ? 'Enter a valid Kenyan mobile number' : undefined}
      />
      <TextField
        label="Alternative phone"
        optional
        keyboardType="phone-pad"
        value={form.altPhone}
        onChangeText={set('altPhone')}
        error={!altOk ? 'Enter a valid Kenyan mobile number' : undefined}
      />
      {save.error && <Notice tone="error">{save.error.message}</Notice>}
    </Screen>
  );
}
