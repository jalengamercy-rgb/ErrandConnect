import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { orderKeys, useMessages } from '@/lib/orders';
import type { ChatMessage } from '@/lib/types';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useAuth();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data: messages, error } = useMessages(id);
  const [text, setText] = useState('');

  const send = useMutation({
    mutationFn: () => api.post<ChatMessage>(`/orders/${id}/messages`, { body: text.trim() }),
    onSuccess: (message) => {
      setText('');
      queryClient.setQueryData<ChatMessage[]>(orderKeys.messages(id), (old) =>
        old?.some((m) => m.id === message.id) ? old : [...(old ?? []), message],
      );
    },
  });

  return (
    <Screen
      footer={
        <View style={styles.composer}>
          <View style={styles.flex}>
            <TextField label="Message" value={text} onChangeText={setText} onSubmitEditing={() => text.trim() && send.mutate()} />
          </View>
          <Button title="Send" disabled={!text.trim()} loading={send.isPending} onPress={() => send.mutate()} />
        </View>
      }
    >
      {error && <Notice tone="error">{error.message}</Notice>}
      {messages?.length === 0 && <Notice>Say hello 👋 Messages are only visible to you and the other person on this errand.</Notice>}
      {messages?.map((m) => {
        const mine = m.senderId === me?.id;
        return (
          <View
            key={m.id}
            style={[styles.bubble, mine ? styles.mine : styles.theirs, { backgroundColor: mine ? theme.primary : theme.backgroundElement }]}
          >
            <ThemedText style={{ color: mine ? theme.onPrimary : theme.text }}>{m.body}</ThemedText>
            <ThemedText type="small" style={{ color: mine ? theme.onPrimary : theme.textSecondary }}>
              {new Date(m.createdAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
            </ThemedText>
          </View>
        );
      })}
      {send.error && <Notice tone="error">{send.error.message}</Notice>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
  flex: { flex: 1 },
  bubble: { maxWidth: '80%', padding: Spacing.two, paddingHorizontal: Spacing.three, borderRadius: Radius.medium },
  mine: { alignSelf: 'flex-end' },
  theirs: { alignSelf: 'flex-start' },
});
