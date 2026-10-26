import {
  DELIVERY_TYPES,
  MAX_DISTANCE_CHOICES_KM,
  MOTORIZED_DELIVERY_TYPES,
  RUNNER_EQUIPMENT,
  RUNNER_LANGUAGES,
  RUNNER_SKILLS,
  normalizeKenyanPhone,
  type DeliveryType,
  type RunnerOnboardingStepKey,
} from '@errandconnect/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ChoiceChips, MultiChoiceChips } from '@/components/ui/choice-chips';
import { Card, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { getCurrentLocation } from '@/lib/device';
import { humanize } from '@/lib/format';
import { useCategories } from '@/lib/queries';
import type { Gender } from '@/lib/types';
import { isIsoDate } from '@/lib/validation';

import { useSaveStep, type StepProps } from './use-save-step';
import { IdentityStep, VehiclesStep } from './document-steps';

const options = <T extends string | number>(values: readonly T[], label: (v: T) => string = (v) => humanize(String(v))) =>
  values.map((value) => ({ value, label: label(value) }));

const NAIROBI_AREAS = [
  'CBD', 'Westlands', 'Kilimani', 'Kileleshwa', 'Lavington', 'Parklands', 'Karen', 'Langata', 'Rongai', 'South B',
  'South C', 'Embakasi', 'Kasarani', 'Roysambu', 'Ruaka', 'Kitengela', 'Syokimau', 'Thika Road',
];

const LANGUAGE_LABELS: Record<string, string> = { ENGLISH: 'English', SWAHILI: 'Swahili', LOCAL_LANGUAGES: 'Local languages' };
const EQUIPMENT_LABELS: Record<string, string> = {
  SMARTPHONE_ANDROID: 'Android phone',
  SMARTPHONE_IPHONE: 'iPhone',
  POWER_BANK: 'Power bank',
  DELIVERY_BAG: 'Delivery bag',
  COOLER_BOX: 'Cooler box',
  HELMET: 'Helmet',
  REFLECTOR_JACKET: 'Reflector jacket',
  GPS_HOLDER: 'Phone/GPS holder',
};
const DELIVERY_TYPE_LABELS: Record<DeliveryType, string> = {
  WALKING: 'Walking',
  BICYCLE: 'Bicycle',
  MOTORCYCLE: 'Motorcycle (Boda)',
  CAR: 'Car',
  VAN: 'Van',
  PICKUP: 'Pickup truck',
  TRUCK: 'Truck',
};

/** Shared layout: title, fields, error and a Save button. */
function StepForm({ title, subtitle, canSave, saving, error, onSave, children }: {
  title: string;
  subtitle?: string;
  canSave: boolean;
  saving: boolean;
  error?: Error | null;
  onSave: () => void;
  children: React.ReactNode;
}) {
  return (
    <Screen title={title} subtitle={subtitle} footer={<Button title="Save and continue" disabled={!canSave} loading={saving} onPress={onSave} />}>
      {children}
      {error && <Notice tone="error">{error.message}</Notice>}
    </Screen>
  );
}

function PersonalStep({ data }: StepProps) {
  const { user, profile } = data.answers;
  const save = useSaveStep('personal');
  const [form, setForm] = useState({
    dateOfBirth: user.dateOfBirth?.slice(0, 10) ?? '',
    nationality: user.nationality ?? 'Kenyan',
    nationalIdNumber: profile.nationalIdNumber ?? '',
    email: user.email ?? '',
    whatsapp: user.whatsapp ?? '',
  });
  const [gender, setGender] = useState<Gender | null>(user.gender);
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const dobOk = isIsoDate(form.dateOfBirth);
  const whatsappOk = !form.whatsapp || !!normalizeKenyanPhone(form.whatsapp);
  const ready = dobOk && gender && form.nationality.trim() && /^[A-Za-z0-9]{6,12}$/.test(form.nationalIdNumber) && /\S+@\S+\.\S+/.test(form.email) && whatsappOk;

  return (
    <StepForm
      title="Basic information"
      subtitle={`${user.firstName} ${user.lastName} — name and phone come from your account.`}
      canSave={!!ready}
      saving={save.isPending}
      error={save.error}
      onSave={() => save.mutate({ ...form, gender, whatsapp: form.whatsapp || undefined })}>
      <TextField
        label="Date of birth"
        placeholder="YYYY-MM-DD"
        hint="You must be 18 or older"
        value={form.dateOfBirth}
        onChangeText={set('dateOfBirth')}
        error={form.dateOfBirth.length >= 10 && !dobOk ? 'Use the format YYYY-MM-DD' : undefined}
      />
      <ChoiceChips
        label="Gender"
        choices={options<Gender>(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'])}
        value={gender}
        onChange={setGender}
      />
      <TextField label="Nationality" value={form.nationality} onChangeText={set('nationality')} />
      <TextField label="National ID / Passport number" autoCapitalize="characters" value={form.nationalIdNumber} onChangeText={set('nationalIdNumber')} />
      <TextField label="Email" keyboardType="email-address" autoCapitalize="none" value={form.email} onChangeText={set('email')} />
      <TextField
        label="WhatsApp number"
        optional
        keyboardType="phone-pad"
        value={form.whatsapp}
        onChangeText={set('whatsapp')}
        error={!whatsappOk ? 'Enter a valid Kenyan mobile number' : undefined}
      />
    </StepForm>
  );
}

function ServiceAreaStep({ data }: StepProps) {
  const { profile } = data.answers;
  const save = useSaveStep('service-area');
  const [form, setForm] = useState({ county: profile.county ?? 'Nairobi', city: profile.city ?? 'Nairobi', area: profile.area ?? '' });
  const [areas, setAreas] = useState<string[]>(profile.preferredAreas);
  const [otherAreas, setOtherAreas] = useState(profile.preferredAreas.filter((a) => !NAIROBI_AREAS.includes(a)).join(', '));
  const [location, setLocation] = useState(profile.lastLat !== null && profile.lastLng !== null ? { lat: profile.lastLat, lng: profile.lastLng } : null);
  const locate = useMutation({ mutationFn: getCurrentLocation, onSuccess: setLocation });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const extra = otherAreas.split(',').map((a) => a.trim()).filter(Boolean);
  const preferredAreas = [...new Set([...areas.filter((a) => NAIROBI_AREAS.includes(a)), ...extra])];
  const ready = form.county.trim().length >= 2 && form.city.trim().length >= 2 && form.area.trim().length >= 2 && preferredAreas.length > 0;

  return (
    <StepForm
      title="Address & service area"
      canSave={ready}
      saving={save.isPending}
      error={save.error ?? locate.error}
      onSave={() => save.mutate({ ...form, preferredAreas, ...location })}>
      <TextField label="County" value={form.county} onChangeText={set('county')} />
      <TextField label="City / town" value={form.city} onChangeText={set('city')} />
      <TextField label="Estate / neighbourhood where you live" value={form.area} onChangeText={set('area')} />
      <Button
        title={location ? '📍 Location captured — update' : 'Capture my current location'}
        variant="secondary"
        loading={locate.isPending}
        onPress={() => locate.mutate()}
      />
      <MultiChoiceChips label="Preferred working areas" choices={NAIROBI_AREAS.map((a) => ({ value: a, label: a }))} value={areas} onChange={setAreas} />
      <TextField label="Other areas" optional hint="Separate with commas, e.g. Nakuru CBD, Milimani" value={otherAreas} onChangeText={setOtherAreas} />
    </StepForm>
  );
}

function DeliveryTypesStep({ data }: StepProps) {
  const save = useSaveStep('delivery-types');
  const [types, setTypes] = useState<DeliveryType[]>(data.answers.profile.deliveryTypes);
  const motorized = types.some((t) => MOTORIZED_DELIVERY_TYPES.includes(t));
  return (
    <StepForm title="How do you deliver?" subtitle="Select all that apply." canSave={types.length > 0} saving={save.isPending} error={save.error} onSave={() => save.mutate({ deliveryTypes: types })}>
      <MultiChoiceChips choices={options(DELIVERY_TYPES, (t) => DELIVERY_TYPE_LABELS[t])} value={types} onChange={setTypes} />
      {motorized && <Notice>You&apos;ll add vehicle, licence and insurance details in the next step.</Notice>}
    </StepForm>
  );
}

function PayoutStep({ data }: StepProps) {
  const existing = data.answers.payoutMethod;
  const save = useSaveStep('payout');
  const [type, setType] = useState<'MPESA' | 'BANK'>(existing?.type === 'BANK' ? 'BANK' : 'MPESA');
  const [form, setForm] = useState({
    accountName: existing?.accountName ?? `${data.answers.user.firstName} ${data.answers.user.lastName}`,
    phone: existing?.phone ?? '',
    bankName: existing?.bankName ?? '',
    accountNumber: existing?.accountNumber ?? '',
    branch: existing?.branch ?? '',
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const ready =
    form.accountName.trim().length >= 2 &&
    (type === 'MPESA'
      ? !!normalizeKenyanPhone(form.phone)
      : form.bankName.trim().length >= 2 && /^\d{6,20}$/.test(form.accountNumber) && form.branch.trim().length >= 2);
  const body =
    type === 'MPESA'
      ? { type, accountName: form.accountName, phone: form.phone }
      : { type, accountName: form.accountName, bankName: form.bankName, accountNumber: form.accountNumber, branch: form.branch };

  return (
    <StepForm title="How should we pay you?" subtitle="Your earnings are sent here." canSave={ready} saving={save.isPending} error={save.error} onSave={() => save.mutate(body)}>
      <ChoiceChips choices={[{ value: 'MPESA', label: 'M-Pesa' }, { value: 'BANK', label: 'Bank' }]} value={type} onChange={setType} />
      <TextField label={type === 'MPESA' ? 'Registered M-Pesa name' : 'Account name'} value={form.accountName} onChangeText={set('accountName')} />
      {type === 'MPESA' ? (
        <TextField label="M-Pesa phone number" keyboardType="phone-pad" value={form.phone} onChangeText={set('phone')} />
      ) : (
        <>
          <TextField label="Bank name" value={form.bankName} onChangeText={set('bankName')} />
          <TextField label="Account number" keyboardType="number-pad" value={form.accountNumber} onChangeText={set('accountNumber')} />
          <TextField label="Branch" value={form.branch} onChangeText={set('branch')} />
        </>
      )}
    </StepForm>
  );
}

const AVAILABILITY = ['FULL_TIME', 'PART_TIME', 'WEEKENDS', 'NIGHTS', 'ANYTIME'] as const;
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function WorkPreferencesStep({ data }: StepProps) {
  const { profile } = data.answers;
  const save = useSaveStep('work-preferences');
  const [availability, setAvailability] = useState<string | null>(profile.availability);
  const [days, setDays] = useState<string[]>(profile.workingDays);
  const [start, setStart] = useState(profile.workStartTime ?? '08:00');
  const [end, setEnd] = useState(profile.workEndTime ?? '18:00');
  // 0 stands for "No limit" in the chips.
  const [distance, setDistance] = useState<number>(profile.maxDistanceKm ?? 0);
  const ready = !!availability && days.length > 0 && TIME.test(start) && TIME.test(end);

  return (
    <StepForm
      title="Work preferences"
      canSave={ready}
      saving={save.isPending}
      error={save.error}
      onSave={() => save.mutate({ availability, workingDays: days, workStartTime: start, workEndTime: end, maxDistanceKm: distance || null })}>
      <ChoiceChips label="Availability" choices={options(AVAILABILITY)} value={availability} onChange={setAvailability} />
      <MultiChoiceChips label="Working days" choices={options(WEEKDAYS)} value={days} onChange={setDays} />
      <View style={styles.row}>
        <View style={styles.half}>
          <TextField label="Start time" placeholder="08:00" value={start} onChangeText={setStart} error={!TIME.test(start) ? 'HH:MM' : undefined} />
        </View>
        <View style={styles.half}>
          <TextField label="End time" placeholder="18:00" value={end} onChangeText={setEnd} error={!TIME.test(end) ? 'HH:MM' : undefined} />
        </View>
      </View>
      <ChoiceChips
        label="Maximum delivery distance"
        choices={[...options(MAX_DISTANCE_CHOICES_KM, (km) => `${km} km`), { value: 0, label: 'No limit' }]}
        value={distance}
        onChange={setDistance}
      />
    </StepForm>
  );
}

function ServicesStep({ data }: StepProps) {
  const save = useSaveStep('services');
  const { data: categories } = useCategories();
  const [services, setServices] = useState<string[]>(data.answers.profile.servicesOffered);
  return (
    <StepForm title="Services you offer" subtitle="Select all that apply." canSave={services.length > 0} saving={save.isPending} error={save.error} onSave={() => save.mutate({ servicesOffered: services })}>
      <MultiChoiceChips choices={(categories ?? []).map((c) => ({ value: c.slug, label: c.name }))} value={services} onChange={setServices} />
    </StepForm>
  );
}

function ExperienceStep({ data }: StepProps) {
  const { profile } = data.answers;
  const save = useSaveStep('experience');
  const [experienced, setExperienced] = useState<'yes' | 'no' | null>(
    profile.hasDeliveryExperience === null ? null : profile.hasDeliveryExperience ? 'yes' : 'no',
  );
  const [company, setCompany] = useState(profile.previousCompany ?? '');
  const [years, setYears] = useState(profile.yearsExperience?.toString() ?? '');
  const [perDay, setPerDay] = useState(profile.avgDeliveriesPerDay?.toString() ?? '');
  const toInt = (v: string) => (v.trim() ? Number.parseInt(v, 10) : undefined);

  return (
    <StepForm
      title="Experience"
      canSave={experienced !== null}
      saving={save.isPending}
      error={save.error}
      onSave={() =>
        save.mutate({
          hasDeliveryExperience: experienced === 'yes',
          ...(experienced === 'yes' ? { previousCompany: company || undefined, yearsExperience: toInt(years), avgDeliveriesPerDay: toInt(perDay) } : {}),
        })
      }>
      <ChoiceChips label="Have you worked as a delivery rider before?" choices={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} value={experienced} onChange={setExperienced} />
      {experienced === 'yes' && (
        <>
          <TextField label="Previous company" optional value={company} onChangeText={setCompany} />
          <TextField label="Years of experience" optional keyboardType="number-pad" value={years} onChangeText={(t) => setYears(t.replace(/\D/g, ''))} />
          <TextField label="Average deliveries per day" optional keyboardType="number-pad" value={perDay} onChangeText={(t) => setPerDay(t.replace(/\D/g, ''))} />
        </>
      )}
    </StepForm>
  );
}

function EquipmentStep({ data }: StepProps) {
  const save = useSaveStep('equipment');
  const [equipment, setEquipment] = useState<string[]>(data.answers.profile.equipment);
  return (
    <StepForm title="Equipment" subtitle="Tick everything you have." canSave saving={save.isPending} error={save.error} onSave={() => save.mutate({ equipment })}>
      <MultiChoiceChips choices={options(RUNNER_EQUIPMENT, (e) => EQUIPMENT_LABELS[e] ?? humanize(e))} value={equipment} onChange={setEquipment} />
    </StepForm>
  );
}

function SkillsStep({ data }: StepProps) {
  const save = useSaveStep('skills');
  const [languages, setLanguages] = useState<string[]>(data.answers.profile.languages);
  const [skills, setSkills] = useState<string[]>(data.answers.profile.skills);
  return (
    <StepForm title="Skills" canSave={languages.length > 0} saving={save.isPending} error={save.error} onSave={() => save.mutate({ languages, skills })}>
      <MultiChoiceChips label="Languages you speak" choices={options(RUNNER_LANGUAGES, (l) => LANGUAGE_LABELS[l] ?? humanize(l))} value={languages} onChange={setLanguages} />
      <MultiChoiceChips label="Other skills" choices={options(RUNNER_SKILLS)} value={skills} onChange={setSkills} />
    </StepForm>
  );
}

type YesNo = 'yes' | 'no' | null;
const toYesNo = (v: boolean | null): YesNo => (v === null ? null : v ? 'yes' : 'no');
const YES_NO = [{ value: 'yes' as const, label: 'Yes' }, { value: 'no' as const, label: 'No' }];

function BackgroundStep({ data }: StepProps) {
  const { profile } = data.answers;
  const save = useSaveStep('background');
  const [criminal, setCriminal] = useState<YesNo>(toYesNo(profile.hasCriminalRecord));
  const [heavy, setHeavy] = useState<YesNo>(toYesNo(profile.canLiftHeavy));
  const [cash, setCash] = useState<YesNo>(toYesNo(profile.willingToHandleCash));
  const [idCheck, setIdCheck] = useState(false);
  const [backgroundCheck, setBackgroundCheck] = useState(false);
  const ready = criminal && heavy && cash && idCheck && backgroundCheck;

  return (
    <StepForm
      title="Background questions"
      canSave={!!ready}
      saving={save.isPending}
      error={save.error}
      onSave={() =>
        save.mutate({
          hasCriminalRecord: criminal === 'yes',
          canLiftHeavy: heavy === 'yes',
          willingToHandleCash: cash === 'yes',
          agreeToIdVerification: idCheck,
          agreeToBackgroundCheck: backgroundCheck,
        })
      }>
      <ChoiceChips label="Have you ever been convicted of a crime?" choices={YES_NO} value={criminal} onChange={setCriminal} />
      <ChoiceChips label="Can you lift heavy packages?" choices={YES_NO} value={heavy} onChange={setHeavy} />
      <ChoiceChips label="Are you willing to handle cash?" choices={YES_NO} value={cash} onChange={setCash} />
      <Checkbox label="I agree to ID verification" checked={idCheck} onChange={setIdCheck} />
      <Checkbox label="I agree to background checks" checked={backgroundCheck} onChange={setBackgroundCheck} />
    </StepForm>
  );
}

function AgreementsStep(_: StepProps) {
  const save = useSaveStep('agreements');
  const [agree, setAgree] = useState({ terms: false, privacyPolicy: false, gpsTracking: false, commissionRates: false, infoIsTrue: false });
  const toggle = (key: keyof typeof agree) => (value: boolean) => setAgree((a) => ({ ...a, [key]: value }));
  return (
    <StepForm title="Agreements" subtitle="All are required to work on ErrandCONNECT." canSave={Object.values(agree).every(Boolean)} saving={save.isPending} error={save.error} onSave={() => save.mutate(agree)}>
      <Checkbox label="I agree to the Terms & Conditions" checked={agree.terms} onChange={toggle('terms')} />
      <Checkbox label="I agree to the Privacy Policy" checked={agree.privacyPolicy} onChange={toggle('privacyPolicy')} />
      <Checkbox label="I consent to GPS tracking while I'm online" checked={agree.gpsTracking} onChange={toggle('gpsTracking')} />
      <Checkbox label="I understand the platform commission rates" checked={agree.commissionRates} onChange={toggle('commissionRates')} />
      <Checkbox label="I certify that all information I provided is true" checked={agree.infoIsTrue} onChange={toggle('infoIsTrue')} />
    </StepForm>
  );
}

function SecurityStep(_: StepProps) {
  return (
    <Screen title="Account security">
      <Card>
        <ThemedText>✓ Your password and 4-digit PIN were set when you created your account.</ThemedText>
      </Card>
    </Screen>
  );
}

/** The form for each step key. Emergency contact uses its own screen. */
export const STEP_FORMS: Partial<Record<RunnerOnboardingStepKey, ComponentType<StepProps>>> = {
  personal: PersonalStep,
  'service-area': ServiceAreaStep,
  'delivery-types': DeliveryTypesStep,
  vehicles: VehiclesStep,
  identity: IdentityStep,
  payout: PayoutStep,
  'work-preferences': WorkPreferencesStep,
  services: ServicesStep,
  experience: ExperienceStep,
  equipment: EquipmentStep,
  skills: SkillsStep,
  background: BackgroundStep,
  security: SecurityStep,
  agreements: AgreementsStep,
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.three },
  half: { flex: 1 },
});
