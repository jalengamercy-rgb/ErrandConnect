import { normalizeKenyanPhone } from '@errandconnect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { orgKeys } from '@/lib/business';
import { getCurrentLocation } from '@/lib/device';
import { useCategories } from '@/lib/queries';

export default function RegisterShopScreen() {
  const queryClient = useQueryClient();
  const { data: categories } = useCategories();
  const [form, setForm] = useState({ name: '', addressLine: '', phone: '', description: '', registrationNumber: '' });
  const [category, setCategory] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const locate = useMutation({ mutationFn: getCurrentLocation, onSuccess: setLocation });
  const register = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/merchants', {
        ...Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim())),
        categorySlug: category,
        ...location,
      }),
    onSuccess: (shop) => {
      queryClient.invalidateQueries({ queryKey: orgKeys.myShops });
      router.replace(`/shop/${shop.id}`);
    },
  });
  const phoneOk = !form.phone.trim() || !!normalizeKenyanPhone(form.phone);
  const ready = form.name.trim().length >= 2 && form.addressLine.trim().length >= 3 && !!category && !!location && phoneOk;

  return (
    <Screen
      footer={<Button title="Submit for approval" disabled={!ready} loading={register.isPending} onPress={() => register.mutate()} />}
    >
      <TextField label="Shop name" value={form.name} onChangeText={set('name')} />
      <ChoiceChips
        label="What do you sell?"
        choices={(categories ?? []).map((c) => ({ value: c.slug, label: c.name }))}
        value={category}
        onChange={setCategory}
      />
      <TextField
        label="Where is the shop?"
        placeholder="e.g. Shop 12, Moi Avenue"
        value={form.addressLine}
        onChangeText={set('addressLine')}
      />
      <ThemedText type="small" themeColor="textSecondary">
        Stand in the shop and capture its location so runners find it.
      </ThemedText>
      <Button
        title={location ? '📍 Location captured — update' : 'Use my current location'}
        variant="secondary"
        loading={locate.isPending}
        onPress={() => locate.mutate()}
      />
      {locate.error && <Notice tone="error">{locate.error.message}</Notice>}
      <TextField
        label="Shop phone"
        optional
        keyboardType="phone-pad"
        value={form.phone}
        onChangeText={set('phone')}
        error={phoneOk ? undefined : 'Enter a valid Kenyan number'}
      />
      <TextField label="About the shop" optional multiline value={form.description} onChangeText={set('description')} />
      <TextField label="Business registration number" optional value={form.registrationNumber} onChangeText={set('registrationNumber')} />
      {register.error && <Notice tone="error">{register.error.message}</Notice>}
    </Screen>
  );
}
