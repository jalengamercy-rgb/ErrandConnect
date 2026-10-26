import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Platform, Share } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, Notice } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/** Your data rights: download a copy, or delete the account. */
export default function AccountScreen() {
  const { signOut } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');

  const download = useMutation({
    mutationFn: async () => {
      const data = await api.get<unknown>('/me/export');
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'errandconnect-my-data.json';
        link.click();
        URL.revokeObjectURL(url);
      } else {
        await Share.share({ title: 'My ErrandCONNECT data', message: json });
      }
    },
  });
  const remove = useMutation({
    mutationFn: () => api.post('/me/delete', { password }),
    onSuccess: () => signOut(),
  });

  return (
    <Screen>
      <Card>
        <ThemedText type="smallBold">Download my data</ThemedText>
        <ThemedText type="small">
          Get a copy of everything ErrandCONNECT holds about you: profile, addresses, errands, payments, messages and more.
        </ThemedText>
        {download.error && <Notice tone="error">{download.error.message}</Notice>}
        {download.isSuccess && <Notice tone="success">Your data is ready.</Notice>}
        <Button title="Download my data" variant="secondary" loading={download.isPending} onPress={() => download.mutate()} />
      </Card>

      <Card>
        <ThemedText type="smallBold">Delete my account</ThemedText>
        <ThemedText type="small">
          Your name, phone number, email, addresses, documents and payout details are erased and you are signed out on every device. Records
          of past errands and payments are kept without your details, because the law requires financial records.
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          First finish any errands in progress and withdraw any money in your wallet.
        </ThemedText>
        {confirming ? (
          <>
            <TextField label="Your password" secureTextEntry value={password} onChangeText={setPassword} autoFocus />
            {remove.error && <Notice tone="error">{remove.error.message}</Notice>}
            <Button
              title="Delete my account forever"
              variant="danger"
              disabled={!password}
              loading={remove.isPending}
              onPress={() => remove.mutate()}
            />
            <Button title="Keep my account" variant="ghost" onPress={() => setConfirming(false)} />
          </>
        ) : (
          <Button title="Delete my account" variant="ghost" onPress={() => setConfirming(true)} />
        )}
      </Card>
    </Screen>
  );
}
