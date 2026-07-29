import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '@/lib/responsive';
import type { AppIconComponent } from '@/lib/icons';
import { ChevronRight } from '@/lib/icons';

type AuthRequiredScreenProps = {
  title: string;
  subtitle: string;
  ctaLabel: string;
  secondaryCtaLabel?: string;
  Icon?: AppIconComponent;
  variant?: 'simple' | 'resaleCard';
  eyebrow?: string;
};

export function AuthRequiredScreen({ title, subtitle, ctaLabel, secondaryCtaLabel, Icon, variant = 'simple', eyebrow }: AuthRequiredScreenProps) {
  const insets = useSafeAreaInsets();
  const { horizontalPadding, maxContentWidth, scaleFont } = useResponsive();

  return (
    <View style={styles.container}>
      <LinearGradient colors={[Colors.dark.background, '#0f172a']} style={StyleSheet.absoluteFill} />
      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + 20,
            paddingBottom: insets.bottom + 20,
            paddingHorizontal: horizontalPadding,
            maxWidth: maxContentWidth,
          },
        ]}
      >
        <LinearGradient
          colors={[Colors.dark.primary, Colors.dark.secondary, 'rgba(255,255,255,0.10)']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={styles.cardBorder}
        >
          <View style={styles.card}>
            <LinearGradient colors={['#1E1040', '#0F0A22', '#0A0618']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
            <View pointerEvents="none" style={[styles.orb, styles.orbA]} />
            <View pointerEvents="none" style={[styles.orb, styles.orbB]} />

            <Text style={[styles.eyebrow, { fontSize: scaleFont(11) }]}>
              {eyebrow || '✦ ECLIPSE ✦'}
            </Text>

            {Icon ? (
              <LinearGradient
                colors={[Colors.dark.primary, Colors.dark.secondary]}
                style={styles.iconRing}
              >
                <View style={styles.iconInner}>
                  <Icon size={28} color="white" />
                </View>
              </LinearGradient>
            ) : null}

            <Text style={[styles.title, { fontSize: scaleFont(22) }]}>{title}</Text>
            <Text style={[styles.subtitle, { fontSize: scaleFont(14) }]}>{subtitle}</Text>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push('/(auth)/login')}
              style={styles.ctaOuter}
            >
              <LinearGradient
                colors={[Colors.dark.primary, Colors.dark.secondary]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={styles.ctaInner}
              >
                <Text style={styles.ctaText}>{ctaLabel}</Text>
                <ChevronRight size={16} color="white" />
              </LinearGradient>
            </TouchableOpacity>

            {secondaryCtaLabel ? (
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => router.push('/(auth)/register')}
                style={styles.ctaSecondary}
              >
                <Text style={styles.ctaSecondaryText}>{secondaryCtaLabel}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </LinearGradient>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  content: { width: '100%', alignSelf: 'center', flex: 1, justifyContent: 'center' },
  cardBorder: { borderRadius: 28, padding: 1.5 },
  card: { borderRadius: 26, overflow: 'hidden', alignItems: 'center', paddingTop: 28, paddingBottom: 32, paddingHorizontal: 24 },
  orb: { position: 'absolute', borderRadius: 999 },
  orbA: { width: 200, height: 200, top: -80, left: -70, backgroundColor: 'rgba(124,58,237,0.28)' },
  orbB: { width: 240, height: 240, bottom: -120, right: -100, backgroundColor: 'rgba(10,132,255,0.18)' },
  eyebrow: { fontWeight: '700', color: 'rgba(255,255,255,0.40)', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 20 },
  iconRing: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  iconInner: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.40)', alignItems: 'center', justifyContent: 'center' },
  title: { fontWeight: '900', color: '#FFFFFF', marginTop: 20, textAlign: 'center', letterSpacing: -0.5 },
  subtitle: { color: 'rgba(255,255,255,0.60)', marginTop: 10, textAlign: 'center', lineHeight: 21, maxWidth: 300 },
  ctaOuter: { marginTop: 28, borderRadius: 16, overflow: 'hidden', alignSelf: 'center', minWidth: 200 },
  ctaInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, paddingHorizontal: 24, gap: 6 },
  ctaText: { color: 'white', fontSize: 15, fontWeight: '800', letterSpacing: -0.2 },
  ctaSecondary: { marginTop: 14, alignSelf: 'center', padding: 8 },
  ctaSecondaryText: { color: 'rgba(255,255,255,0.50)', fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
});
