import { AUTO_APPROVE_WITHDRAWAL_LIMIT, MIN_WITHDRAWAL } from '@errandconnect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { Card, Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { formatKes, orderKeys, useWallets, useWalletTransactions, useWithdrawals } from '@/lib/orders';
import type { Withdrawal } from '@/lib/types';

const WITHDRAWAL_STATUS: Record<Withdrawal['status'], string> = {
  REQUESTED: '🟡 Waiting for approval',
  APPROVED: '🟡 Sending to M-Pesa',
  PAID: '🟢 Paid',
  REJECTED: '🔴 Rejected',
  ON_HOLD: '🟡 Being checked',
  FAILED: '🔴 Failed — money returned',
};

export default function WalletScreen() {
  const { data: wallets, isLoading } = useWallets();
  const [chosen, setChosen] = useState<'customer' | 'runner' | null>(null);

  if (isLoading) return <Loading />;
  if (!wallets?.length) {
    return (
      <Screen>
        <Notice>You don&apos;t have a wallet yet.</Notice>
      </Screen>
    );
  }
  const type = chosen ?? (wallets.some((w) => w.type === 'RUNNER') ? 'runner' : 'customer');
  const wallet = wallets.find((w) => w.type === type.toUpperCase());

  return (
    <Screen>
      {wallets.length > 1 && (
        <ChoiceChips
          choices={[
            { value: 'runner', label: 'Earnings' },
            { value: 'customer', label: 'Customer wallet' },
          ]}
          value={type}
          onChange={setChosen}
        />
      )}
      {wallet && (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            {type === 'runner' ? 'Earnings balance' : 'Wallet balance'}
          </ThemedText>
          <ThemedText type="subtitle">{formatKes(wallet.balance)}</ThemedText>
          {wallet.pendingWithdrawals > 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              {formatKes(wallet.pendingWithdrawals)} on its way to M-Pesa
            </ThemedText>
          )}
          {wallet.balance < 0 && (
            <Notice tone="warning">
              You owe this amount in platform fees from cash errands. It&apos;s cleared from your next M-Pesa earnings.
            </Notice>
          )}
        </Card>
      )}
      {wallet && <WithdrawForm type={type} balance={wallet.balance} />}
      <Withdrawals />
      <Transactions type={type} />
    </Screen>
  );
}

function WithdrawForm({ type, balance }: { type: 'customer' | 'runner'; balance: number }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [pin, setPin] = useState('');
  const value = Number.parseInt(amount || '0', 10);
  const withdraw = useMutation({
    mutationFn: () =>
      api.post<Withdrawal>(`/wallets/${type}/withdrawals`, {
        amount: value,
        pin,
      }),
    onSuccess: () => {
      setAmount('');
      setPin('');
      queryClient.invalidateQueries({ queryKey: orderKeys.wallets });
    },
  });
  const amountError =
    amount && (value < MIN_WITHDRAWAL ? `Minimum is ${formatKes(MIN_WITHDRAWAL)}` : value > balance ? 'More than your balance' : undefined);
  const tooLow = balance < MIN_WITHDRAWAL;

  return (
    <Card>
      <ThemedText type="smallBold">Withdraw to M-Pesa</ThemedText>
      {tooLow && !withdraw.isSuccess && (
        <ThemedText type="small" themeColor="textSecondary">
          You can withdraw once your balance reaches {formatKes(MIN_WITHDRAWAL)}.
        </ThemedText>
      )}
      {!tooLow && (
        <>
          <TextField
            label="Amount (KES)"
            keyboardType="number-pad"
            value={amount}
            onChangeText={(t) => setAmount(t.replace(/\D/g, ''))}
            error={amountError || undefined}
          />
          <TextField
            label="Security PIN"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            value={pin}
            onChangeText={(t) => setPin(t.replace(/\D/g, ''))}
          />
        </>
      )}
      {value > AUTO_APPROVE_WITHDRAWAL_LIMIT && (
        <ThemedText type="small" themeColor="textSecondary">
          Withdrawals over {formatKes(AUTO_APPROVE_WITHDRAWAL_LIMIT)} are checked by our team first (usually within a day).
        </ThemedText>
      )}
      {withdraw.isSuccess && (
        <Notice tone="success">
          {withdraw.data.status === 'REQUESTED' ? 'Withdrawal requested — we will notify you once approved.' : 'Withdrawal sent to M-Pesa.'}
        </Notice>
      )}
      {withdraw.error && <Notice tone="error">{withdraw.error.message}</Notice>}
      {!tooLow && (
        <Button
          title="Withdraw"
          disabled={!!amountError || !value || pin.length !== 4}
          loading={withdraw.isPending}
          onPress={() => withdraw.mutate()}
        />
      )}
    </Card>
  );
}

function Withdrawals() {
  const { data } = useWithdrawals();
  if (!data?.length) return null;
  return (
    <Card>
      <ThemedText type="smallBold">Withdrawals</ThemedText>
      {data.slice(0, 5).map((w) => (
        <View key={w.id} style={styles.row}>
          <ThemedText type="small" style={styles.flex}>
            {WITHDRAWAL_STATUS[w.status]}
            {w.note && w.status !== 'PAID' ? ` (${w.note})` : ''}
          </ThemedText>
          <ThemedText type="small">{formatKes(w.amount)}</ThemedText>
        </View>
      ))}
    </Card>
  );
}

function Transactions({ type }: { type: 'customer' | 'runner' }) {
  const theme = useTheme();
  const { data } = useWalletTransactions(type);
  return (
    <Card>
      <ThemedText type="smallBold">History</ThemedText>
      {data?.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary">
          No transactions yet.
        </ThemedText>
      )}
      {data?.map((t) => (
        <View key={t.id} style={styles.row}>
          <View style={styles.flex}>
            <ThemedText type="small">{t.description}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {new Date(t.createdAt).toLocaleString('en-KE', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </ThemedText>
          </View>
          <ThemedText type="smallBold" style={{ color: t.amount >= 0 ? theme.success : theme.text }}>
            {t.amount >= 0 ? '+' : '−'}
            {formatKes(Math.abs(t.amount))}
          </ThemedText>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  flex: { flex: 1 },
});
