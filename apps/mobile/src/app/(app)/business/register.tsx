import { BUSINESS_FEATURES, BUSINESS_SERVICES, COMPANY_SIZES, COMPANY_SIZE_LABELS, MONTHLY_ORDER_ESTIMATES } from '@errandconnect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ChoiceChips, MultiChoiceChips } from '@/components/ui/choice-chips';
import { Card, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { orgKeys } from '@/lib/business';
import { pickAndUploadDocument } from '@/lib/device';
import { humanize } from '@/lib/format';

const ORDERS_LABELS: Record<string, string> = { UNDER_50: 'Under 50', '50_100': '50–100', '100_500': '100–500', OVER_500: 'Over 500' };

export default function RegisterBusinessScreen() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', industry: '', registrationNumber: '', kraPin: '', billingEmail: '', position: '' });
  const [size, setSize] = useState<string | null>(null);
  const [orders, setOrders] = useState<string | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [features, setFeatures] = useState<string[]>([]);
  const [certificate, setCertificate] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const upload = useMutation({
    mutationFn: (source: 'camera' | 'library') => pickAndUploadDocument('BUSINESS_REGISTRATION', source),
    onSuccess: (doc) => doc && setCertificate(true),
  });
  const register = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/businesses', {
        ...Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim())),
        companySize: size ?? undefined,
        estMonthlyOrders: orders ?? undefined,
        servicesNeeded: services,
        requestedFeatures: features,
      }),
    onSuccess: (business) => {
      queryClient.invalidateQueries({ queryKey: orgKeys.businesses });
      router.replace(`/business/${business.id}`);
    },
  });

  return (
    <Screen
      footer={
        <Button
          title="Submit for approval"
          disabled={form.name.trim().length < 2}
          loading={register.isPending}
          onPress={() => register.mutate()}
        />
      }
    >
      <TextField label="Company name" value={form.name} onChangeText={set('name')} />
      <TextField
        label="Industry"
        optional
        placeholder="e.g. Retail, Law firm, Pharmacy"
        value={form.industry}
        onChangeText={set('industry')}
      />
      <TextField label="Registration number" optional value={form.registrationNumber} onChangeText={set('registrationNumber')} />
      <TextField label="KRA PIN" optional autoCapitalize="characters" value={form.kraPin} onChangeText={set('kraPin')} />
      <TextField
        label="Billing email"
        optional
        keyboardType="email-address"
        autoCapitalize="none"
        value={form.billingEmail}
        onChangeText={set('billingEmail')}
      />
      <TextField
        label="Your position"
        optional
        placeholder="e.g. Operations manager"
        value={form.position}
        onChangeText={set('position')}
      />
      <ChoiceChips
        label="Company size"
        choices={COMPANY_SIZES.map((s) => ({ value: s, label: COMPANY_SIZE_LABELS[s] }))}
        value={size}
        onChange={setSize}
      />
      <ChoiceChips
        label="Errands per month (estimate)"
        choices={MONTHLY_ORDER_ESTIMATES.map((o) => ({ value: o, label: ORDERS_LABELS[o] ?? o }))}
        value={orders}
        onChange={setOrders}
      />
      <MultiChoiceChips
        label="What do you need?"
        choices={BUSINESS_SERVICES.map((s) => ({ value: s, label: humanize(s) }))}
        value={services}
        onChange={setServices}
      />
      <MultiChoiceChips
        label="Extras"
        choices={BUSINESS_FEATURES.map((f) => ({ value: f, label: humanize(f) }))}
        value={features}
        onChange={setFeatures}
      />

      <Card>
        <ThemedText type="smallBold">Certificate of registration</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Speeds up approval and is needed for paying by monthly invoice.
        </ThemedText>
        {certificate ? (
          <Notice tone="success">Certificate uploaded</Notice>
        ) : (
          <>
            <Button title="Take photo" variant="secondary" loading={upload.isPending} onPress={() => upload.mutate('camera')} />
            <Button title="Choose from gallery" variant="ghost" onPress={() => upload.mutate('library')} />
          </>
        )}
        {upload.error && <Notice tone="error">{upload.error.message}</Notice>}
      </Card>
      {register.error && <Notice tone="error">{register.error.message}</Notice>}
    </Screen>
  );
}
