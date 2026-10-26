import { MOTORIZED_DELIVERY_TYPES, type DeliveryType } from '@errandconnect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { Card, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { pickAndUploadDocument } from '@/lib/device';
import { humanize } from '@/lib/format';
import { queryKeys, useOnboardingSaved } from '@/lib/queries';
import type { Onboarding, UploadedDocument } from '@/lib/types';
import { isIsoDate } from '@/lib/validation';

import { useSaveStep, type StepProps } from './use-save-step';

const STATUS_TEXT: Record<UploadedDocument['status'], string> = {
  PENDING: '🟡 Uploaded — awaiting review',
  APPROVED: '🟢 Approved',
  REJECTED: '🔴 Rejected — please upload again',
  EXPIRED: '🔴 Expired — please upload again',
};

/** One document to upload, with its current review status. */
function DocumentUpload({ type, label, hint, document }: { type: string; label: string; hint?: string; document?: UploadedDocument }) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const upload = useMutation({
    mutationFn: (source: 'camera' | 'library') => pickAndUploadDocument(type, source),
    onSuccess: (doc) => doc && queryClient.invalidateQueries({ queryKey: queryKeys.onboarding }),
  });

  return (
    <Card>
      <ThemedText type="smallBold">{label}</ThemedText>
      {hint && (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      )}
      {document && (
        <ThemedText type="small" style={{ color: document.status === 'REJECTED' ? theme.danger : theme.text }}>
          {STATUS_TEXT[document.status]}
          {document.rejectionReason ? ` (${document.rejectionReason})` : ''}
        </ThemedText>
      )}
      <View style={styles.row}>
        {Platform.OS !== 'web' && (
          <View style={styles.flex}>
            <Button title="Take photo" variant="secondary" loading={upload.isPending} onPress={() => upload.mutate('camera')} />
          </View>
        )}
        <View style={styles.flex}>
          <Button title={Platform.OS === 'web' ? 'Upload photo' : 'From gallery'} variant="secondary" loading={upload.isPending} onPress={() => upload.mutate('library')} />
        </View>
      </View>
      {upload.error && <Notice tone="error">{upload.error.message}</Notice>}
    </Card>
  );
}

export function IdentityStep({ data }: StepProps) {
  const docs = data.answers.documents;
  const save = useSaveStep('identity');
  const [kraPin, setKraPin] = useState(data.answers.profile.kraPin ?? '');
  const kraOk = !kraPin || /^[A-Za-z]\d{9}[A-Za-z]$/.test(kraPin);
  const required = ['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'SELFIE', 'SELFIE_WITH_ID'];
  const uploaded = required.every((t) => docs[t] && docs[t]!.status !== 'REJECTED');

  return (
    <Screen
      title="Identity verification"
      subtitle="Clear photos in good light. Our team checks every document."
      footer={<Button title="Save and continue" disabled={!uploaded || !kraOk} loading={save.isPending} onPress={() => save.mutate({ kraPin: kraPin || undefined })} />}>
      <DocumentUpload type="NATIONAL_ID_FRONT" label="National ID — front" document={docs.NATIONAL_ID_FRONT} />
      <DocumentUpload type="NATIONAL_ID_BACK" label="National ID — back" document={docs.NATIONAL_ID_BACK} />
      <DocumentUpload type="SELFIE" label="Profile photo (selfie)" hint="Face the camera, no hat or sunglasses. This becomes your profile photo." document={docs.SELFIE} />
      <DocumentUpload type="SELFIE_WITH_ID" label="Selfie holding your ID" hint="Hold your ID next to your face." document={docs.SELFIE_WITH_ID} />
      <DocumentUpload type="PASSPORT" label="Passport (optional)" document={docs.PASSPORT} />
      <DocumentUpload type="POLICE_CLEARANCE" label="Police clearance certificate (optional, recommended)" document={docs.POLICE_CLEARANCE} />
      <TextField label="KRA PIN" optional placeholder="A123456789B" autoCapitalize="characters" value={kraPin} onChangeText={setKraPin} error={!kraOk ? 'KRA PIN looks like A123456789B' : undefined} />
      {!uploaded && <Notice>Upload the four required photos to continue.</Notice>}
      {save.error && <Notice tone="error">{save.error.message}</Notice>}
    </Screen>
  );
}

export function VehiclesStep({ data }: StepProps) {
  const motorized = data.answers.profile.deliveryTypes.filter((t) => MOTORIZED_DELIVERY_TYPES.includes(t));
  const saved = useOnboardingSaved();
  const remove = useMutation({ mutationFn: (id: string) => api.delete<Onboarding>(`/runners/me/vehicles/${id}`), onSuccess: saved });
  const [adding, setAdding] = useState(false);

  if (motorized.length === 0) {
    return (
      <Screen title="Vehicle details" footer={<Button title="Back" onPress={() => router.back()} />}>
        <Notice>No vehicle needed for walking or bicycle deliveries. This step is complete.</Notice>
      </Screen>
    );
  }

  const missing = motorized.filter((t) => !data.vehicles.some((v) => v.type === t));
  return (
    <Screen title="Vehicle details" footer={<Button title="Done" onPress={() => router.back()} />}>
      {data.vehicles.map((v) => (
        <Card key={v.id}>
          <ThemedText type="smallBold">
            {humanize(v.type)} · {v.registrationNumber}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {v.make} {v.model}, {v.color}, {v.year}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Licence expires {v.licenceExpiry?.slice(0, 10)} · Insurance expires {v.insuranceExpiry?.slice(0, 10)}
          </ThemedText>
          <Button title="Remove" variant="ghost" loading={remove.isPending} onPress={() => remove.mutate(v.id)} />
        </Card>
      ))}
      {missing.length > 0 && <Notice>Add details for: {missing.map(humanize).join(', ')}</Notice>}
      {adding ? <VehicleForm types={motorized} onDone={() => setAdding(false)} /> : <Button title="Add a vehicle" variant="secondary" onPress={() => setAdding(true)} />}
      <DocumentUpload type="VEHICLE_PHOTO" label="Vehicle photo" hint="Show the number plate clearly." document={data.answers.documents.VEHICLE_PHOTO} />
      {remove.error && <Notice tone="error">{remove.error.message}</Notice>}
    </Screen>
  );
}

function VehicleForm({ types, onDone }: { types: DeliveryType[]; onDone: () => void }) {
  const saved = useOnboardingSaved();
  const [type, setType] = useState<DeliveryType>(types[0]);
  const [form, setForm] = useState({
    make: '', model: '', color: '', registrationNumber: '', year: '', licenceNumber: '', licenceExpiry: '', insuranceNumber: '', insuranceExpiry: '',
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const add = useMutation({
    mutationFn: () => api.post<Onboarding>('/runners/me/vehicles', { ...form, type, year: Number.parseInt(form.year, 10) }),
    onSuccess: (onboarding) => {
      saved(onboarding);
      onDone();
    },
  });

  const dateError = (v: string) => (v.length >= 10 && !isIsoDate(v) ? 'Use YYYY-MM-DD' : undefined);
  const ready =
    form.make && form.model && form.color && form.registrationNumber.replace(/\s/g, '').length >= 5 && /^\d{4}$/.test(form.year) &&
    form.licenceNumber.length >= 4 && isIsoDate(form.licenceExpiry) && form.insuranceNumber.length >= 4 && isIsoDate(form.insuranceExpiry);

  return (
    <Card>
      <ChoiceChips label="Vehicle type" choices={types.map((t) => ({ value: t, label: humanize(t) }))} value={type} onChange={setType} />
      <TextField label="Make" placeholder="e.g. Bajaj, Toyota" value={form.make} onChangeText={set('make')} />
      <TextField label="Model" placeholder="e.g. Boxer, Probox" value={form.model} onChangeText={set('model')} />
      <TextField label="Colour" value={form.color} onChangeText={set('color')} />
      <TextField label="Registration number" placeholder="KMEA 123B" autoCapitalize="characters" value={form.registrationNumber} onChangeText={set('registrationNumber')} />
      <TextField label="Year" keyboardType="number-pad" maxLength={4} value={form.year} onChangeText={set('year')} />
      <TextField label="Driving licence number" autoCapitalize="characters" value={form.licenceNumber} onChangeText={set('licenceNumber')} />
      <TextField label="Licence expiry date" placeholder="YYYY-MM-DD" value={form.licenceExpiry} onChangeText={set('licenceExpiry')} error={dateError(form.licenceExpiry)} />
      <TextField label="Insurance number" autoCapitalize="characters" value={form.insuranceNumber} onChangeText={set('insuranceNumber')} />
      <TextField label="Insurance expiry date" placeholder="YYYY-MM-DD" value={form.insuranceExpiry} onChangeText={set('insuranceExpiry')} error={dateError(form.insuranceExpiry)} />
      {add.error && <Notice tone="error">{add.error.message}</Notice>}
      <Button title="Save vehicle" disabled={!ready} loading={add.isPending} onPress={() => add.mutate()} />
      <Button title="Cancel" variant="ghost" onPress={onDone} />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two },
  flex: { flex: 1 },
});
