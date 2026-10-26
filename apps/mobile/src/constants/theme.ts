/**
 * App colours for light and dark mode, plus spacing and font tokens.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0B1B17',
    background: '#ffffff',
    backgroundElement: '#F1F4F3',
    backgroundSelected: '#DDE6E3',
    textSecondary: '#5B6763',
    border: '#D5DDDA',
    primary: '#0E7C66',
    onPrimary: '#ffffff',
    primarySoft: '#E1F2EE',
    danger: '#C62828',
    warning: '#B26A00',
    success: '#1B7F3B',
  },
  dark: {
    text: '#EEF4F2',
    background: '#0A0F0E',
    backgroundElement: '#18201E',
    backgroundSelected: '#24302D',
    textSecondary: '#A7B3AF',
    border: '#2E3A37',
    primary: '#3CC4A4',
    onPrimary: '#05201A',
    primarySoft: '#123129',
    danger: '#FF6B6B',
    warning: '#F2B347',
    success: '#5FD38A',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  small: 8,
  medium: 12,
  large: 20,
} as const;

export const MaxContentWidth = 640;
