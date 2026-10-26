import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { formatAddress } from '@/lib/format';
import { queryKeys, useAddresses } from '@/lib/queries';

export default function AddressesScreen() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useAddresses();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.addresses });
  const makeDefault = useMutation({
    mutationFn: (id: string) => api.patch(`/me/addresses/${id}`, { isDefault: true }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/me/addresses/${id}`), onSuccess: refresh });

  if (isLoading) return <Loading />;
  return (
    <Screen footer={<Button title="Add address" onPress={() => router.push('/addresses/new')} />}>
      {data?.length === 0 && <Notice>Save places like Home and Office to book errands faster.</Notice>}
      {data?.map((address) => (
        <Card key={address.id}>
          <ThemedText type="smallBold">
            {address.label}{' '}
            {address.isDefault && (
              <ThemedText type="small" themeColor="primary">
                · Default
              </ThemedText>
            )}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatAddress(address) || `${address.lat.toFixed(5)}, ${address.lng.toFixed(5)}`}
          </ThemedText>
          <View style={styles.actions}>
            {!address.isDefault && (
              <View style={styles.action}>
                <Button title="Make default" variant="secondary" onPress={() => makeDefault.mutate(address.id)} />
              </View>
            )}
            <View style={styles.action}>
              <Button title="Delete" variant="ghost" onPress={() => remove.mutate(address.id)} />
            </View>
          </View>
        </Card>
      ))}
      {(makeDefault.error || remove.error) && <Notice tone="error">{(makeDefault.error ?? remove.error)!.message}</Notice>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: Spacing.two },
  action: { flex: 1 },
});
