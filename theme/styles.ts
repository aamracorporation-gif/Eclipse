import { Platform } from 'react-native';
import { Colors } from '@/constants/Colors';

export const theme = {
  colors: {
    border: Colors.dark.border,
  },
  space: [0, 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 56, 64],
  radius: {
    md: 16,
    lg: 24,
  },
  layout: {
    minTapSize: 44,
  },
  typography: {
    fontFamily: {
      display: Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' }),
    },
    size: {
      xs: 12,
      sm: 14,
      md: 16,
      lg: 18,
      xl: 20,
      '2xl': 24,
      '3xl': 30,
    },
    weight: {
      semibold: '600',
      bold: '700',
      black: '900',
    },
  },
  components: {
    card: {
      padding: 18,
      borderWidth: 1,
    },
    button: {
      height: 52,
      borderRadius: 16,
    },
    input: {
      minHeight: 52,
      borderWidth: 1,
    },
  },
} as const;

export function shadow(size: 'sm' | 'md' | 'lg' = 'md') {
  const presets = {
    sm: { elevation: 6, opacity: 0.22, radius: 8, y: 4 },
    md: { elevation: 10, opacity: 0.28, radius: 14, y: 7 },
    lg: { elevation: 16, opacity: 0.35, radius: 18, y: 10 },
  } as const;

  const p = presets[size];
  return Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: p.y },
      shadowOpacity: p.opacity,
      shadowRadius: p.radius,
    },
    android: {
      elevation: p.elevation,
    },
    default: {},
  });
}
