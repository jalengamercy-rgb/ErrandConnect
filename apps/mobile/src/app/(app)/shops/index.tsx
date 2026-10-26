import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { ChoiceChips } from '@/components/ui/choice-chips';
import { Card, Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { useShopDirectory } from '@/lib/business';
import { getCurrentLocation } from '@/lib/device';
import { useCategories } from '@/lib/queries';

export default function ShopDirectoryScreen() {
  const { data: categories } = useCategories();
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const locate = useMutation({ mutationFn: getCurrentLocation, onSuccess: setHere });
  const {
    data: shops,
    isLoading,
    error,
  } = useShopDirectory({ category: category ?? undefined, search: search.trim() || undefined, ...here });

  return (
    <Screen>
      <TextField label="Search shops" placeholder="e.g. Naivas, pharmacy" value={search} onChangeText={setSearch} />
      <ChoiceChips
        choices={[{ value: '', label: 'All' }, ...(categories ?? []).map((c) => ({ value: c.slug, label: c.name }))]}
        value={category ?? ''}
        onChange={(v) => setCategory(v || null)}
      />
      {!here && <Button title="Show shops near me first" variant="ghost" loading={locate.isPending} onPress={() => locate.mutate()} />}
      {locate.error && <Notice tone="error">{locate.error.message}</Notice>}
      {isLoading && <Loading />}
      {error && <Notice tone="error">{error.message}</Notice>}
      {shops?.length === 0 && <Notice>No shops found. You can still post any errand from the home screen.</Notice>}
      {shops?.map((s) => (
        <Card key={s.id}>
          <ThemedText type="smallBold">
            {s.isFeatured ? '⭐ ' : ''}
            {s.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {s.addressLine}
            {s.distanceKm != null ? ` · ${s.distanceKm} km away` : ''}
            {s.ratingCount ? ` · ★ ${s.ratingAvg.toFixed(1)}` : ''}
          </ThemedText>
          {s.description && <ThemedText type="small">{s.description}</ThemedText>}
          <Button
            title="Order from this shop"
            variant="secondary"
            onPress={() => router.push({ pathname: '/orders/new', params: { merchant: s.id, category: s.categorySlug } })}
          />
        </Card>
      ))}
    </Screen>
  );
}
