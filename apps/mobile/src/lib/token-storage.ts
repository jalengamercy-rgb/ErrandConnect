import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const REFRESH_TOKEN_KEY = 'errandconnect.refreshToken';

/**
 * Keeps the refresh token between app launches. On phones it lives in the
 * device's encrypted keychain/keystore; the web build falls back to
 * localStorage. The short-lived access token is only kept in memory.
 */
export const tokenStorage = {
  async getRefreshToken(): Promise<string | null> {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(REFRESH_TOKEN_KEY) ?? null;
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  },

  async setRefreshToken(token: string): Promise<void> {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(REFRESH_TOKEN_KEY, token);
    else await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
  },

  async clear(): Promise<void> {
    if (Platform.OS === 'web') globalThis.localStorage?.removeItem(REFRESH_TOKEN_KEY);
    else await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  },
};
