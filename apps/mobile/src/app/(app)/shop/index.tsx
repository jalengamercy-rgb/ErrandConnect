import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { ORG_STATUS_LABELS, useMyShops } from '@/lib/business';

export default function MyShopsScreen() {
  const { data, isLoading, error } = useMyShops();
  if (isLoading) return <Loading />;
  return (
    <Screen footer={<Button title="List my shop" onPress={() => router.push('/shop/register')} />}>
      {error && <Notice tone="error">{error.message}</Notice>}
      {data?.length === 0 && (
        <Notice>
          List your shop on ErrandCONNECT: customers order from you, our runners collect and deliver. You pay a small commission only on
          completed orders.
        </Notice>
      )}
      {data?.map((s) => (
        <Card key={s.id}>
          <ThemedText type="smallBold">{s.name}</ThemedText>
          <ThemedText type="small">{ORG_STATUS_LABELS[s.status]}</ThemedText>
          {s.addressLine && (
            <ThemedText type="small" themeColor="textSecondary">
              {s.addressLine}
            </ThemedText>
          )}
          <Button title="Open shop dashboard" variant="secondary" onPress={() => router.push(`/shop/${s.id}`)} />
        </Card>
      ))}
    </Screen>
  );
}
