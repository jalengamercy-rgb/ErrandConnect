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
import { useAuth } from '@/lib/auth-context';
import { useBusiness, useMyBusinesses, useShop } from '@/lib/business';
import { formatKes, orderKeys, useWallets } from '@/lib/orders';
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
  const params = useLocalSearchParams<{ category?: string; merchant?: string; business?: string }>();
  const initialCategory = params.category;
  const { data: shop } = useShop(params.merchant);
  const { data: myBusinesses } = useMyBusinesses();
  const companies = (myBusinesses ?? []).filter((b) => b.status === 'ACTIVE');
  const [billTo, setBillTo] = useState(params.business ?? '');
  const { data: company } = useBusiness(billTo || null);
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
  const { me } = useAuth();
  const { data: wallets } = useWallets();
  const walletBalance = wallets?.find((w) => w.type === 'CUSTOMER')?.balance ?? 0;
  const [chosenPayment, setPaymentMethod] = useState<'MPESA' | 'WALLET' | 'CASH' | 'BUSINESS_INVOICE' | null>(null);
  // Company errands default to the company invoice when the company has one.
  const canInvoice = !!billTo && !!company?.monthlyInvoicing;
  const paymentMethod =
    chosenPayment === 'BUSINESS_INVOICE' && !canInvoice ? 'MPESA' : (chosenPayment ?? (canInvoice ? 'BUSINESS_INVOICE' : 'MPESA'));
  const [mpesaPhone, setMpesaPhone] = useState(me?.phone ? `0${me.phone.slice(4)}` : '');

  // Use the default saved address until the customer picks another.
  const branches = billTo ? (company?.branches ?? []) : [];
  const places = [...branches, ...(addresses ?? [])];
  const dropoffId =
    (chosenDropoffId && places.some((a) => a.id === chosenDropoffId) ? chosenDropoffId : null) ??
    addresses?.find((a) => a.isDefault)?.id ??
    places[0]?.id ??
    null;

  const locatePickup = useMutation({ mutationFn: getCurrentLocation, onSuccess: setPickupPoint });

  const pickup =
    !shop && hasPickup && pickupPoint && pickupAddress.trim().length >= 2 ? { address: pickupAddress.trim(), ...pickupPoint } : undefined;
  const details = useDebounced({
    categorySlug: category,
    dropoffAddressId: dropoffId,
    pickup,
    deliveryType,
    urgency,
    itemsCost: itemsCost ? Number.parseInt(itemsCost, 10) : 0,
    merchantId: shop?.id,
    businessId: billTo || undefined,
  });
  const canQuote = !!details.categorySlug && !!details.dropoffAddressId && (!!shop || !hasPickup || !!details.pickup);
  const quote = useQuery({
    queryKey: ['quote', details],
    queryFn: () => api.post<{ quote: Quote; distanceKm: number }>('/orders/quote', details),
    enabled: canQuote,
  });

  const recipientOk = !forSomeoneElse || (recipientName.trim().length >= 2 && !!normalizeKenyanPhone(recipientPhone));
  const total = quote.data?.quote.customer.total;
  const needsApproval =
    paymentMethod === 'BUSINESS_INVOICE' &&
    company?.myRole === 'MEMBER' &&
    company.myApprovalLimit != null &&
    total !== undefined &&
    total > company.myApprovalLimit;
  const paymentOk =
    paymentMethod === 'CASH' ||
    paymentMethod === 'BUSINESS_INVOICE' ||
    (paymentMethod === 'MPESA' && !!normalizeKenyanPhone(mpesaPhone)) ||
    (paymentMethod === 'WALLET' && total !== undefined && walletBalance >= total);
  const create = useMutation({
    mutationFn: () =>
      api.post<Order>('/orders', {
        ...details,
        description: description.trim(),
        recipientName: forSomeoneElse ? recipientName.trim() : undefined,
        recipientPhone: forSomeoneElse ? recipientPhone : undefined,
        paymentMethod,
        mpesaPhone: paymentMethod === 'MPESA' ? mpesaPhone : undefined,
      }),
    onSuccess: (order) => {
      queryClient.invalidateQueries({ queryKey: orderKeys.lists });
      router.replace(`/orders/${order.id}`);
    },
  });

  const ready = canQuote && quote.isSuccess && description.trim().length >= 5 && recipientOk && paymentOk;
  const payLabel = needsApproval
    ? 'Send for approval'
    : { MPESA: 'Pay with M-Pesa', WALLET: 'Pay from wallet', CASH: 'Post errand', BUSINESS_INVOICE: 'Bill to company' }[paymentMethod];

  return (
    <Screen
      footer={
        <Button
          title={total !== undefined ? `${payLabel} · ${formatKes(total)}` : payLabel}
          disabled={!ready}
          loading={create.isPending}
          onPress={() => create.mutate()}
        />
      }
    >
      {shop && (
        <Card>
          <ThemedText type="smallBold">🛍️ Ordering from {shop.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {shop.addressLine} · the runner picks up your order here.
          </ThemedText>
        </Card>
      )}
      {companies.length > 0 && (
        <ChoiceChips
          label="Who is this errand for?"
          choices={[{ value: '', label: 'Personal' }, ...companies.map((c) => ({ value: c.id, label: `🏢 ${c.name}` }))]}
          value={billTo}
          onChange={setBillTo}
        />
      )}
      <ChoiceChips
        label="What kind of errand?"
        choices={(categories ?? []).map((c) => ({ value: c.slug, label: c.name }))}
        value={category}
        onChange={setCategory}
      />

      <TextField
        label="What should the runner do?"
        placeholder={shop ? 'List what you want from the shop' : 'e.g. Buy 2kg sugar, 1L milk and bread from Naivas'}
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

      {!shop && (
        <Checkbox label="The runner needs to go somewhere first (shop, pharmacy, office)" checked={hasPickup} onChange={setHasPickup} />
      )}
      {!shop && hasPickup && (
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
      {addresses && places.length === 0 ? (
        <Notice>Save an address first so the runner knows where to deliver.</Notice>
      ) : (
        <ChoiceChips
          choices={places.map((a) => ({ value: a.id, label: branches.includes(a) ? `🏢 ${a.label}` : a.label }))}
          value={dropoffId}
          onChange={setDropoffId}
        />
      )}
      <Button title="Add a new address" variant="ghost" onPress={() => router.push('/addresses/new')} />

      <Checkbox label="Someone else will receive it" checked={forSomeoneElse} onChange={setForSomeoneElse} />
      {forSomeoneElse && (
        <>
          <TextField label="Recipient's name" value={recipientName} onChangeText={setRecipientName} />
          <TextField label="Recipient's phone" keyboardType="phone-pad" value={recipientPhone} onChangeText={setRecipientPhone} />
        </>
      )}

      <ChoiceChips
        label="How should it be carried?"
        choices={DELIVERY_TYPES.map((t) => ({ value: t, label: humanize(t) }))}
        value={deliveryType}
        onChange={setDeliveryType}
      />
      <ChoiceChips label="How urgent?" choices={URGENCY_CHOICES} value={urgency} onChange={setUrgency} />

      {quote.data && <PriceBreakdown quote={quote.data.quote.customer} distanceKm={quote.data.distanceKm} />}
      {quote.error && <Notice tone="error">{quote.error.message}</Notice>}
      <ChoiceChips
        label="How will you pay?"
        choices={[
          ...(canInvoice ? [{ value: 'BUSINESS_INVOICE' as const, label: 'Company invoice' }] : []),
          { value: 'MPESA', label: 'M-Pesa' },
          { value: 'WALLET', label: `Wallet (${formatKes(walletBalance)})` },
          { value: 'CASH', label: 'Cash on delivery' },
        ]}
        value={paymentMethod}
        onChange={setPaymentMethod}
      />
      {paymentMethod === 'MPESA' && (
        <>
          <TextField
            label="M-Pesa number"
            keyboardType="phone-pad"
            value={mpesaPhone}
            onChangeText={setMpesaPhone}
            hint="You'll get a prompt on this phone to enter your M-Pesa PIN."
          />
          <Notice>
            Your money is held safely and only paid to the runner when you give them your delivery PIN. Cancel before pickup for a full
            refund to your wallet.
          </Notice>
        </>
      )}
      {paymentMethod === 'WALLET' && total !== undefined && walletBalance < total && (
        <Notice tone="warning">Your wallet balance is too low for this errand.</Notice>
      )}
      {paymentMethod === 'CASH' && <Notice>Pay the runner in cash when they deliver.</Notice>}
      {paymentMethod === 'BUSINESS_INVOICE' && (
        <Notice tone={needsApproval ? 'warning' : 'info'}>
          {needsApproval
            ? `This is above your ${formatKes(company!.myApprovalLimit!)} limit, so a company admin must approve it before a runner is found.`
            : `Billed to ${company?.name} on the monthly invoice.`}
        </Notice>
      )}
      {create.error && <Notice tone="error">{create.error.message}</Notice>}
    </Screen>
  );
}
