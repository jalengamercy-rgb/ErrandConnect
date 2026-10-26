import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/feedback';
import { Screen } from '@/components/ui/screen';
import { Spacing } from '@/constants/theme';

export default function WelcomeScreen() {
  const signUp = (accountType: 'CUSTOMER' | 'RUNNER') =>
    router.push({ pathname: '/phone', params: { purpose: 'REGISTER', accountType } });

  return (
    <Screen>
      <View style={styles.hero}>
        <ThemedText type="title" style={styles.brand}>
          Errand<ThemedText type="title" themeColor="primary">CONNECT</ThemedText>
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.center}>
          Groceries, parcels, medicine, queues and more — done by trusted local runners.
        </ThemedText>
      </View>

      <Card>
        <ThemedText type="smallBold">Need something done?</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Post an errand and a verified runner takes care of it. You pay only when it&apos;s delivered.
        </ThemedText>
        <Button title="Sign up as a customer" onPress={() => signUp('CUSTOMER')} />
      </Card>

      <Card>
        <ThemedText type="smallBold">Want to earn?</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Run errands on your own schedule — on foot, bicycle, boda or car.
        </ThemedText>
        <Button title="Become a runner" variant="secondary" onPress={() => signUp('RUNNER')} />
      </Card>

      <Button title="I already have an account — Log in" variant="ghost" onPress={() => router.push('/login')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: Spacing.three, paddingVertical: Spacing.five, alignItems: 'center' },
  brand: { fontSize: 40, lineHeight: 48, textAlign: 'center' },
  center: { textAlign: 'center' },
});
