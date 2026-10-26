import { router } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { Loading, Notice } from '@/components/ui/feedback';
import { OrderRow } from '@/features/orders/components';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/lib/auth-context';
import { useCustomerOrders, useRunnerOrders } from '@/lib/orders';

/** Errand history: a customer's errands and/or the jobs a runner has done. */
export default function OrdersScreen() {
  const { me } = useAuth();
  const [scope, setScope] = useState<'active' | 'past'>('active');
  const [as, setAs] = useState<'customer' | 'runner'>(me?.customerProfile ? 'customer' : 'runner');
  const customerOrders = useCustomerOrders(scope, !!me?.customerProfile);
  const runnerOrders = useRunnerOrders(scope, !!me?.runnerProfile);
  const query = as === 'customer' ? customerOrders : runnerOrders;

  return (
    <Screen footer={me?.customerProfile && <Button title="New errand" onPress={() => router.push('/orders/new')} />}>
      {me?.customerProfile && me.runnerProfile && (
        <ChoiceChips
          choices={[
            { value: 'customer', label: 'My errands' },
            { value: 'runner', label: 'Jobs I ran' },
          ]}
          value={as}
          onChange={setAs}
        />
      )}
      <ChoiceChips
        choices={[
          { value: 'active', label: 'Active' },
          { value: 'past', label: 'Past' },
        ]}
        value={scope}
        onChange={setScope}
      />
      {query.isLoading && <Loading />}
      {query.error && <Notice tone="error">{query.error.message}</Notice>}
      {query.data?.length === 0 && <Notice>{scope === 'active' ? 'Nothing in progress.' : 'No past errands yet.'}</Notice>}
      {query.data?.map((order) => (
        <OrderRow key={order.id} order={order} />
      ))}
    </Screen>
  );
}
