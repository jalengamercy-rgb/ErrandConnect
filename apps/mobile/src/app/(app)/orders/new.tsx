import { DELIVERY_TYPES, normalizeKenyanPhone, type DeliveryType } from '@errandconnect/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { Card, Notice } from '@/components/ui/feedback';
import { PriceBreakdown } from '@/features/orders/components';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { getCurrentLocation } from '@/lib/device';
import { humanize } from '@/lib/format';
import { formatKes, orderKeys } from '@/lib/orders';
import { useAddresses, useCategories } from '@/lib/queries';
import type { Order, Quote, Urgency } from '@/lib/types';

const URGENCY_CHOICES: { value: Urgency; label: string }[] = [
  { value: 'STANDARD', label: 'Standard' },
  { value: 'WITHIN_1_HOUR', label: 'Within 1 hour' },
  { value: 'WITHIN_30_MIN', label: 'Within 30 min' },
  { value: 'WITHIN_15_MIN', label: 'Within 15 min' },
];

/** Waits until the user stops typing before fetching a new price. */
function useDebounced<T>(value: T, ms = 500) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export default function NewErrandScreen() {
  const { category: initialCategory } = useLocalSearchParams<{ category?: string }>();
  const queryClient = useQueryClient();
  const { data: categories } = useCategories();
  const { data: addresses } = useAddresses();

  const [category, setCategory] = useState<string | null>(initialCategory ?? null);
  const [description, setDescription] = useState('');
  const [itemsCost, setItemsCost] = useState('');
  const [hasPickup, setHasPickup] = useState(false);
  const [pickupAddress, setPickupAddress] = useState('');
  const [pickupPoint, setPickupPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [chosenDropoffId, setDropoffId] = useState<string | null>(null);
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('MOTORCYCLE');
  const [urgency, setUrgency] = useState<Urgency>('STANDARD');
  const [forSomeoneElse, setForSomeoneElse] = useState(false);
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');

  // Use the default saved address until the customer picks another.
  const dropoffId = chosenDropoffId ?? addresses?.find((a) => a.isDefault)?.id ?? addresses?.[0]?.id ?? null;

  const locatePickup = useMutation({ mutationFn: getCurrentLocation, onSuccess: setPickupPoint });

  const pickup = hasPickup && pickupPoint && pickupAddress.trim().length >= 2 ? { address: pickupAddress.trim(), ...pickupPoint } : undefined;
  const details = useDebounced({
    categorySlug: category,
    dropoffAddressId: dropoffId,
    pickup,
    deliveryType,
    urgency,
    itemsCost: itemsCost ? Number.parseInt(itemsCost, 10) : 0,
  });
  const canQuote = !!details.categorySlug && !!details.dropoffAddressId && (!hasPickup || !!details.pickup);
  const quote = useQuery({
    queryKey: ['quote', details],
    queryFn: () => api.post<{ quote: Quote; distanceKm: number }>('/orders/quote', details),
    enabled: canQuote,
  });

  const recipientOk = !forSomeoneElse || (recipientName.trim().length >= 2 && !!normalizeKenyanPhone(recipientPhone));
  const create = useMutation({
    mutationFn: () =>
      api.post<Order>('/orders', {
        ...details,
        description: description.trim(),
        recipientName: forSomeoneElse ? recipientName.trim() : undefined,
        recipientPhone: forSomeoneElse ? recipientPhone : undefined,
        paymentMethod: 'CASH',
      }),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.lists });
      router.replace(`/orders/${order.id}`);
    },
  });

  const ready = canQuote && quote.isSuccess && description.trim().length >= 5 && recipientOk;

  return (
    <Screen
      footer={
        <Button
          title={quote.data ? `Post errand · ${formatKes(quote.data.quote.customer.total)}` : 'Post errand'}
          disabled={!ready}
          loading={create.isPending}
          onPress={() => create.mutate()}
        />
      }>
      <ChoiceChips label="What kind of errand?" choices={(categories ?? []).map((c) => ({ value: c.slug, label: c.name }))} value={category} onChange={setCategory} />

      <TextField
        label="What should the runner do?"
        placeholder="e.g. Buy 2kg sugar, 1L milk and bread from Naivas"
        multiline
        value={description}
        onChangeText={setDescription}
      />
      <TextField
        label="Estimated cost of items"
        optional
        hint="Money the runner spends for you. Leave empty if nothing needs buying."
        keyboardType="number-pad"
        value={itemsCost}
        onChangeText={(t) => setItemsCost(t.replace(/\D/g, ''))}
      />

      <Checkbox label="The runner needs to go somewhere first (shop, pharmacy, office)" checked={hasPickup} onChange={setHasPickup} />
      {hasPickup && (
        <Card>
          <TextField label="Pickup place" placeholder="e.g. Naivas Moi Avenue" value={pickupAddress} onChangeText={setPickupAddress} />
          <ThemedText type="small" themeColor="textSecondary">
            Stand at the place, or near it, and capture its location.
          </ThemedText>
          <Button
            title={pickupPoint ? '📍 Pickup location captured — update' : 'Use my current location'}
            variant="secondary"
            loading={locatePickup.isPending}
            onPress={() => locatePickup.mutate()}
          />
          {locatePickup.error && <Notice tone="error">{locatePickup.error.message}</Notice>}
        </Card>
      )}

      <ThemedText type="smallBold">Deliver to</ThemedText>
      {addresses && addresses.length === 0 ? (
        <Notice>Save an address first so the runner knows where to deliver.</Notice>
      ) : (
        <ChoiceChips choices={(addresses ?? []).map((a) => ({ value: a.id, label: a.label }))} value={dropoffId} onChange={setDropoffId} />
      )}
      <Button title="Add a new address" variant="ghost" onPress={() => router.push('/addresses/new')} />

      <Checkbox label="Someone else will receive it" checked={forSomeoneElse} onChange={setForSomeoneElse} />
      {forSomeoneElse && (
        <>
          <TextField label="Recipient's name" value={recipientName} onChangeText={setRecipientName} />
          <TextField label="Recipient's phone" keyboardType="phone-pad" value={recipientPhone} onChangeText={setRecipientPhone} />
        </>
      )}

      <ChoiceChips label="How should it be carried?" choices={DELIVERY_TYPES.map((t) => ({ value: t, label: humanize(t) }))} value={deliveryType} onChange={setDeliveryType} />
      <ChoiceChips label="How urgent?" choices={URGENCY_CHOICES} value={urgency} onChange={setUrgency} />

      {quote.data && <PriceBreakdown quote={quote.data.quote.customer} distanceKm={quote.data.distanceKm} />}
      {quote.error && <Notice tone="error">{quote.error.message}</Notice>}
      <Notice>Pay the runner in cash when they deliver. M-Pesa payments are coming soon.</Notice>
      {create.error && <Notice tone="error">{create.error.message}</Notice>}
    </Screen>
  );
}
