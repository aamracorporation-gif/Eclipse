import { useEffect, useMemo, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';

type PurchaseConfirmationProps = {
  title?: string;
  message?: string;
  variant?: 'default' | 'vip';
  primaryActionTitle?: string;
  onPrimaryAction?: () => void;
  secondaryActionTitle?: string;
  onSecondaryAction?: () => void;
};

export function PurchaseConfirmation({
  title = 'Pago exitoso',
  message = 'Tu compra se ha completado. Tu entrada está lista.',
  variant = 'default',
  primaryActionTitle = 'Ver mis entradas',
  onPrimaryAction,
  secondaryActionTitle = 'Seguir explorando',
  onSecondaryAction,
}: PurchaseConfirmationProps) {
  const scale = useRef(new Animated.Value(0.94)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const animation = useMemo(
    () =>
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 7, tension: 80, useNativeDriver: true }),
      ]),
    [opacity, scale]
  );

  useEffect(() => {
    animation.start();
  }, [animation]);

  const backgroundColors: [string, string, string] =
    variant === 'vip' ? ['#050507', '#0B1020', '#050507'] : ['#060610', '#14061F', '#060610'];

  return (
    <View style={styles.container}>
      <LinearGradient colors={backgroundColors} style={StyleSheet.absoluteFill} />

      <View style={styles.center}>
        <Animated.View style={{ transform: [{ scale }], opacity, width: '100%' }}>
          <GlassView intensity={18} style={[styles.card, variant === 'vip' && styles.cardVip]}>
            {variant === 'vip' && (
              <View style={styles.vipTopRow}>
                <LinearGradient colors={['rgba(212,175,55,0.35)', 'rgba(255,255,255,0)']} style={styles.vipTopGlow} />
                <View style={styles.vipBadge}>
                  <Text style={styles.vipBadgeText}>VIP ACCESS</Text>
                </View>
              </View>
            )}

            <Text style={[styles.title, variant === 'vip' && styles.titleVip]}>{title}</Text>
            <Text style={styles.message}>{message}</Text>

            <View style={styles.actions}>
              <ThemedButton title={primaryActionTitle} onPress={() => onPrimaryAction?.()} />
              <View style={{ height: 10 }} />
              <ThemedButton title={secondaryActionTitle} onPress={() => onSecondaryAction?.()} variant="outline" />
            </View>
          </GlassView>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 16 },
  card: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  cardVip: {
    borderColor: 'rgba(212,175,55,0.28)',
  },
  title: { color: 'white', fontWeight: '900', fontSize: 18 },
  titleVip: { letterSpacing: 0.4 },
  message: { marginTop: 10, color: Colors.dark.textSecondary, fontWeight: '700', lineHeight: 20 },
  actions: { marginTop: 18 },
  vipTopRow: {
    position: 'relative',
    marginBottom: 10,
    overflow: 'hidden',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  vipTopGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  vipBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(212,175,55,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  vipBadgeText: {
    color: '#fef3c7',
    fontWeight: '900',
    letterSpacing: 2.2,
    fontSize: 11,
  },
});
