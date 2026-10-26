import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { humanize } from '@/lib/format';
import { ORG_STATUS_LABELS, useMyBusinesses } from '@/lib/business';

export default function BusinessesScreen() {
  const { data, isLoading, error } = useMyBusinesses();
  if (isLoading) return <Loading />;
  return (
    <Screen footer={<Button title="Register a company" onPress={() => router.push('/business/register')} />}>
      {error && <Notice tone="error">{error.message}</Notice>}
      {data?.length === 0 && (
        <Notice>
          Order errands for your company: let your team request deliveries, approve big errands, and pay once a month by invoice.
        </Notice>
      )}
      {data?.map((b) => (
        <Card key={b.id}>
          <ThemedText type="smallBold">{b.name}</ThemedText>
          <ThemedText type="small">{ORG_STATUS_LABELS[b.status]}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            You are {humanize(b.role).toLowerCase()}
            {b.monthlyInvoicing ? ' · monthly invoicing' : ''}
          </ThemedText>
          <Button title="Open" variant="secondary" onPress={() => router.push(`/business/${b.id}`)} />
        </Card>
      ))}
    </Screen>
  );
}
