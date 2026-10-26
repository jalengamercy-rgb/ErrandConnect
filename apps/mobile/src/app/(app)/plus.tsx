import { normalizeKenyanPhone } from '@errandconnect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { Card, Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { growthKeys, usePlus, type Plus } from '@/lib/growth';
import { formatKes, orderKeys, useWallets } from '@/lib/orders';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' });

export default function PlusScreen() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [waiting, setWaiting] = useState(false);
  // Time when the screen opened (render must not read the clock).
  const [openedAt] = useState(() => Date.now());
  const { data: plus, isLoading, error } = usePlus(waiting);
  const { data: wallets } = useWallets();
  const balance = wallets?.find((w) => w.type === 'CUSTOMER')?.balance ?? 0;
  const [method, setMethod] = useState<'MPESA' | 'WALLET'>('MPESA');
  const [phone, setPhone] = useState(me?.phone ? `0${me.phone.slice(4)}` : '');

  const done = (result: Plus) => {
    queryClient.setQueryData(growthKeys.plus, result);
    queryClient.invalidateQueries({ queryKey: orderKeys.wallets });
  };
  const join = useMutation({
    mutationFn: () => api.post<Plus & { message?: string }>('/me/plus', { method, phone: method === 'MPESA' ? phone : undefined }),
    onSuccess: (result) => {
      done(result);
      if (method === 'MPESA') setWaiting(true);
    },
  });
  const renew = useMutation({ mutationFn: (autoRenew: boolean) => api.patch<Plus>('/me/plus', { autoRenew }), onSuccess: done });

  if (isLoading) return <Loading />;
  if (!plus) return <Notice tone="error">{error?.message ?? 'Could not load Plus'}</Notice>;
  const renewSoon = plus.active && plus.currentPeriodEnd && new Date(plus.currentPeriodEnd).getTime() - openedAt < 3 * 86_400_000;
  const canPay = method === 'WALLET' ? balance >= plus.price : !!normalizeKenyanPhone(phone);

  return (
    <Screen>
      <Card>
        <ThemedText type="title">⭐ ErrandCONNECT Plus</ThemedText>
        <ThemedText type="subtitle">
          {formatKes(plus.price)} / {plus.periodDays} days
        </ThemedText>
        {plus.benefits.map((b) => (
          <ThemedText key={b}>✓ {b}</ThemedText>
        ))}
      </Card>

      {plus.active ? (
        <Card>
          <Notice tone="success">You&apos;re a Plus member until {day(plus.currentPeriodEnd!)}.</Notice>
          <ThemedText type="small">
            {plus.autoRenew
              ? `It renews automatically from your wallet (${formatKes(plus.price)}). Keep enough in your wallet before then.`
              : 'Renewal is off. Your membership ends on that date.'}
          </ThemedText>
          {renew.error && <Notice tone="error">{renew.error.message}</Notice>}
          <Button
            title={plus.autoRenew ? 'Turn off renewal' : 'Turn renewal back on'}
            variant={plus.autoRenew ? 'ghost' : 'secondary'}
            loading={renew.isPending}
            onPress={() => renew.mutate(!plus.autoRenew)}
          />
        </Card>
      ) : !plus.available ? (
        <Notice>Plus isn&apos;t open for new members right now.</Notice>
      ) : null}

      {plus.available && (!plus.active || renewSoon) && (
        <Card>
          <ThemedText type="smallBold">{plus.active ? 'Renew now' : 'Join Plus'}</ThemedText>
          <ChoiceChips
            choices={[
              { value: 'MPESA', label: 'M-Pesa' },
              { value: 'WALLET', label: `Wallet (${formatKes(balance)})` },
            ]}
            value={method}
            onChange={setMethod}
          />
          {method === 'MPESA' && <TextField label="M-Pesa number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />}
          {method === 'WALLET' && balance < plus.price && <Notice tone="warning">Your wallet balance is too low.</Notice>}
          {waiting && !plus.active && (
            <Notice>
              {plus.pendingPayment?.status === 'FAILED' || plus.pendingPayment?.status === 'CANCELLED'
                ? `Payment didn't go through${plus.pendingPayment.failureReason ? `: ${plus.pendingPayment.failureReason}` : ''}.`
                : '📱 Check your phone and enter your M-Pesa PIN. This page updates once you pay.'}
            </Notice>
          )}
          {join.error && <Notice tone="error">{join.error.message}</Notice>}
          <Button title={`Pay ${formatKes(plus.price)}`} disabled={!canPay} loading={join.isPending} onPress={() => join.mutate()} />
        </Card>
      )}
    </Screen>
  );
}
