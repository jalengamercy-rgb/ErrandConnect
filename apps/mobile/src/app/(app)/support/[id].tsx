import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { supportKeys, useTicket, type Ticket } from '@/lib/support';

export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data: ticket, isLoading } = useTicket(id);
  const [message, setMessage] = useState('');
  const reply = useMutation({
    mutationFn: () => api.post<Ticket>(`/support/tickets/${id}/messages`, { message: message.trim() }),
    onSuccess: (updated) => {
      setMessage('');
      queryClient.setQueryData(supportKeys.ticket(id), updated);
      queryClient.invalidateQueries({ queryKey: supportKeys.tickets });
    },
  });

  if (isLoading || !ticket) return <Loading />;
  const closed = ticket.status === 'CLOSED';
  return (
    <Screen
      title={ticket.subject}
      subtitle={ticket.number}
      footer={
        !closed && (
          <View style={styles.composer}>
            <View style={styles.flex}>
              <TextField label="Reply" value={message} onChangeText={setMessage} />
            </View>
            <Button title="Send" disabled={!message.trim()} loading={reply.isPending} onPress={() => reply.mutate()} />
          </View>
        )
      }
    >
      {ticket.messages.map((m) => (
        <View
          key={m.id}
          style={[
            styles.bubble,
            m.fromStaff ? styles.theirs : styles.mine,
            { backgroundColor: m.fromStaff ? theme.backgroundElement : theme.primary },
          ]}
        >
          <ThemedText type="small" style={{ color: m.fromStaff ? theme.textSecondary : theme.onPrimary }}>
            {m.fromStaff ? `${m.author.firstName} · ErrandCONNECT support` : 'You'}
          </ThemedText>
          <ThemedText style={{ color: m.fromStaff ? theme.text : theme.onPrimary }}>{m.body}</ThemedText>
        </View>
      ))}
      {ticket.status === 'OPEN' && <Notice>We usually reply within a few hours.</Notice>}
      {closed && <Notice>This conversation is closed. Start a new one from Help & support if you need more help.</Notice>}
      {reply.error && <Notice tone="error">{reply.error.message}</Notice>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  flex: { flex: 1 },
  bubble: { maxWidth: '85%', padding: Spacing.three, borderRadius: Radius.medium, gap: Spacing.one },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
});
