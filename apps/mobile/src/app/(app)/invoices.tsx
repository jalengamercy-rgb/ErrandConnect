import { normalizeKenyanPhone } from '@errandconnect/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { orgKeys, useInvoices, type Invoice } from '@/lib/business';
import { formatKes } from '@/lib/orders';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

export default function InvoicesScreen() {
  const { data, isLoading, error } = useInvoices();
  if (isLoading) return <Loading />;
  return (
    <Screen>
      {error && <Notice tone="error">{error.message}</Notice>}
      {data?.length === 0 && <Notice>No invoices yet. Company and shop invoices appear here at the end of each month.</Notice>}
      {data?.map((invoice) => (
        <InvoiceCard key={invoice.id} invoice={invoice} />
      ))}
    </Screen>
  );
}

function InvoiceCard({ invoice }: { invoice: Invoice }) {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState(false);
  const [phone, setPhone] = useState(me?.phone ? `0${me.phone.slice(4)}` : '');
  const pay = useMutation({
    mutationFn: () => api.post<{ message: string }>(`/invoices/${invoice.id}/pay`, { phone }),
    onSuccess: () => setTimeout(() => queryClient.invalidateQueries({ queryKey: orgKeys.invoices }), 8_000),
  });
  const overdue = invoice.status === 'ISSUED' && new Date(invoice.dueDate).getTime() < new Date().setHours(0, 0, 0, 0);

  return (
    <Card>
      <ThemedText type="small" themeColor="textSecondary">
        {invoice.number} · {invoice.business?.name ?? invoice.merchant?.name}
      </ThemedText>
      <ThemedText type="subtitle">{formatKes(invoice.amount)}</ThemedText>
      <ThemedText type="small">
        {day(invoice.periodStart)} – {day(new Date(new Date(invoice.periodEnd).getTime() - 1).toISOString())}
        {invoice.merchant ? ' · commission' : ''}
      </ThemedText>
      {invoice.status === 'PAID' && <Notice tone="success">Paid {invoice.paidAt ? day(invoice.paidAt) : ''}</Notice>}
      {invoice.status === 'VOID' && <Notice>Cancelled</Notice>}
      {invoice.status === 'ISSUED' && (
        <>
          <Notice tone={overdue ? 'error' : 'info'}>
            {overdue ? 'Overdue' : 'Due'} {day(invoice.dueDate)}
          </Notice>
          {pay.isSuccess ? (
            <Notice tone="success">{pay.data.message}</Notice>
          ) : paying ? (
            <>
              <TextField label="M-Pesa number" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
              {pay.error && <Notice tone="error">{pay.error.message}</Notice>}
              <Button
                title={`Pay ${formatKes(invoice.amount)}`}
                disabled={!normalizeKenyanPhone(phone)}
                loading={pay.isPending}
                onPress={() => pay.mutate()}
              />
            </>
          ) : (
            <Button title="Pay with M-Pesa" onPress={() => setPaying(true)} />
          )}
        </>
      )}
    </Card>
  );
}
