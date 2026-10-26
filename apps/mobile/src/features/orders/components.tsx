import { ORDER_STATUS_LABELS } from '@errandconnect/shared';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/feedback';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatKes } from '@/lib/orders';
import type { Order, OrderSummary, Quote } from '@/lib/types';

/** What the customer pays, line by line. */
export function PriceBreakdown({ quote, distanceKm }: { quote: Quote['customer']; distanceKm?: number }) {
  const rows: [string, number][] = [
    ['Items (estimate)', quote.itemsCost],
    ['Errand fee', quote.errandFee],
    [distanceKm ? `Delivery (${distanceKm} km)` : 'Delivery', quote.deliveryFee],
    ['Urgent delivery', quote.urgencyFee],
    ['Service fee', quote.serviceFee],
  ];
  return (
    <Card>
      {rows
        .filter(([, amount]) => amount > 0)
        .map(([label, amount]) => (
          <View key={label} style={styles.row}>
            <ThemedText type="small">{label}</ThemedText>
            <ThemedText type="small">{formatKes(amount)}</ThemedText>
          </View>
        ))}
      <View style={styles.row}>
        <ThemedText type="smallBold">Total</ThemedText>
        <ThemedText type="smallBold">{formatKes(quote.total)}</ThemedText>
      </View>
    </Card>
  );
}

export function OrderRow({ order }: { order: OrderSummary }) {
  const amount = order.total ?? order.runnerFee;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/orders/${order.id}`)}>
      <Card>
        <ThemedText type="smallBold">
          {order.category.name} · {ORDER_STATUS_LABELS[order.status]}
        </ThemedText>
        <ThemedText type="small" numberOfLines={2}>
          {order.description}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {order.orderNumber} · {new Date(order.createdAt).toLocaleDateString('en-KE')}
          {amount !== undefined ? ` · ${formatKes(amount)}` : ''}
        </ThemedText>
      </Card>
    </Pressable>
  );
}

/** Status history of an order, oldest first. */
export function Timeline({ events }: { events: Order['events'] }) {
  return (
    <Card>
      <ThemedText type="smallBold">Timeline</ThemedText>
      {events.map((event, i) => (
        <View key={i} style={styles.row}>
          <ThemedText type="small" style={styles.flex}>
            {ORDER_STATUS_LABELS[event.status]}
            {event.note ? ` — ${event.note}` : ''}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {new Date(event.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
          </ThemedText>
        </View>
      ))}
    </Card>
  );
}

export function StarRating({ value, onChange }: { value: number; onChange?: (stars: number) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.stars} accessibilityRole="adjustable" accessibilityValue={{ min: 0, max: 5, now: value }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable key={star} disabled={!onChange} accessibilityRole="button" accessibilityLabel={`${star} star${star > 1 ? 's' : ''}`} onPress={() => onChange?.(star)}>
          <ThemedText style={[styles.star, { color: star <= value ? theme.warning : theme.border }]}>★</ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.two },
  flex: { flex: 1 },
  stars: { flexDirection: 'row', gap: Spacing.two },
  star: { fontSize: 32, lineHeight: 40 },
});
