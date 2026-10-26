import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { humanize } from '@/lib/format';
import { supportKeys, useTickets, type Ticket } from '@/lib/support';

/** Help & support: past conversations and a form to start a new one (?orderId= links it to an errand). */
export default function SupportScreen() {
  const { orderId } = useLocalSearchParams<{ orderId?: string }>();
  const queryClient = useQueryClient();
  const { data, isLoading } = useTickets();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.post<Ticket>('/support/tickets', { subject: subject.trim(), message: message.trim(), orderId: orderId || undefined }),
    onSuccess: (ticket) => {
      queryClient.invalidateQueries({ queryKey: supportKeys.tickets });
      router.replace(`/support/${ticket.id}`);
    },
  });

  if (isLoading) return <Loading />;
  return (
    <Screen title="Help & support">
      <Card>
        <ThemedText type="smallBold">Contact us</ThemedText>
        {orderId && (
          <ThemedText type="small" themeColor="textSecondary">
            About your errand
          </ThemedText>
        )}
        <TextField label="Subject" value={subject} onChangeText={setSubject} />
        <TextField label="How can we help?" multiline value={message} onChangeText={setMessage} />
        {create.error && <Notice tone="error">{create.error.message}</Notice>}
        <Button
          title="Send"
          disabled={subject.trim().length < 3 || message.trim().length < 5}
          loading={create.isPending}
          onPress={() => create.mutate()}
        />
      </Card>
      {data && data.length > 0 && <ThemedText type="smallBold">Your conversations</ThemedText>}
      {data?.map((t) => (
        <Pressable key={t.id} accessibilityRole="button" onPress={() => router.push(`/support/${t.id}`)}>
          <Card>
            <ThemedText type="smallBold">{t.subject}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t.number} · {t.status === 'PENDING' ? 'Support replied' : humanize(t.status)} ·{' '}
              {new Date(t.updatedAt).toLocaleDateString('en-KE')}
            </ThemedText>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
