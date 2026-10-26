import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, Loading, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { supportKeys, useNotifications, type InboxItem } from '@/lib/support';

export default function NotificationsScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data, isLoading } = useNotifications();
  const refresh = () => queryClient.invalidateQueries({ queryKey: supportKeys.notifications });
  const readAll = useMutation({ mutationFn: () => api.post('/me/notifications/read-all'), onSuccess: refresh });
  const open = useMutation({
    mutationFn: (n: InboxItem) => api.post(`/me/notifications/${n.id}/read`),
    onSuccess: (_, n) => {
      refresh();
      if (n.link) router.push(n.link as Href);
    },
  });

  if (isLoading) return <Loading />;
  const unread = data?.filter((n) => !n.readAt).length ?? 0;
  return (
    <Screen footer={unread > 0 && <Button title="Mark all as read" variant="secondary" onPress={() => readAll.mutate()} />}>
      {data?.length === 0 && <Notice>No notifications yet.</Notice>}
      {data?.map((n) => (
        <Pressable key={n.id} accessibilityRole="button" onPress={() => open.mutate(n)}>
          <Card>
            <ThemedText type="smallBold" style={{ color: n.readAt ? theme.textSecondary : theme.text }}>
              {n.readAt ? '' : '● '}
              {n.title}
            </ThemedText>
            <ThemedText type="small">{n.body}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {new Date(n.createdAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}
            </ThemedText>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
