import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { getCurrentLocation } from '@/lib/device';
import { queryKeys } from '@/lib/queries';

const LABELS = ['Home', 'Work', 'Parents', 'School', 'Other'] as const;

export default function NewAddressScreen() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState<string>('Home');
  const [customLabel, setCustomLabel] = useState('');
  const [form, setForm] = useState({ county: '', city: '', area: '', street: '', building: '', unit: '', notes: '' });
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const locate = useMutation({ mutationFn: getCurrentLocation, onSuccess: setLocation });
  const save = useMutation({
    mutationFn: () =>
      api.post('/me/addresses', {
        label: label === 'Other' ? customLabel : label,
        ...Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim())),
        ...location,
        isDefault: isDefault || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.addresses });
      router.back();
    },
  });

  const labelOk = label !== 'Other' || customLabel.trim().length > 0;
  return (
    <Screen
      footer={<Button title="Save address" disabled={!location || !labelOk} loading={save.isPending} onPress={() => save.mutate()} />}
    >
      <ChoiceChips label="Name" choices={LABELS.map((l) => ({ value: l, label: l }))} value={label} onChange={setLabel} />
      {label === 'Other' && <TextField label="Custom name" value={customLabel} onChangeText={setCustomLabel} />}

      <ThemedText type="smallBold">Pin location</ThemedText>
      {location ? (
        <Notice tone="success">
          📍 Location saved ({location.lat.toFixed(5)}, {location.lng.toFixed(5)})
        </Notice>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Stand at the address and tap below so runners can find it exactly.
        </ThemedText>
      )}
      <Button
        title={location ? 'Update location' : 'Use my current location'}
        variant="secondary"
        loading={locate.isPending}
        onPress={() => locate.mutate()}
      />
      {locate.error && <Notice tone="error">{locate.error.message}</Notice>}

      <TextField label="Estate / area" placeholder="e.g. Kilimani" value={form.area} onChangeText={set('area')} />
      <TextField label="Street" optional value={form.street} onChangeText={set('street')} />
      <TextField label="Building name" optional value={form.building} onChangeText={set('building')} />
      <TextField label="House / apartment number" optional value={form.unit} onChangeText={set('unit')} />
      <TextField label="City / town" optional value={form.city} onChangeText={set('city')} />
      <TextField label="County" optional value={form.county} onChangeText={set('county')} />
      <TextField label="Directions for the runner" optional multiline value={form.notes} onChangeText={set('notes')} />
      <Checkbox label="Make this my default address" checked={isDefault} onChange={setIsDefault} />
      {save.error && <Notice tone="error">{save.error.message}</Notice>}
    </Screen>
  );
}
