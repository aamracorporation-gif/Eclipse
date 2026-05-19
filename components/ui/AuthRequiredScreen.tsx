import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '@/lib/responsive';
import type { AppIconComponent } from '@/lib/icons';

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

  if (variant === 'simple') {
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
          <GlassView intensity={26} style={styles.card}>
            {Icon ? (
              <View style={styles.iconWrap}>
                <Icon size={32} color={Colors.dark.primary} />
              </View>
            ) : null}
            <Text style={[styles.title, { fontSize: scaleFont(22) }]}>{title}</Text>
            <Text style={[styles.subtitle, { fontSize: scaleFont(14) }]}>{subtitle}</Text>
            <ThemedButton title={ctaLabel} onPress={() => router.push('/(auth)/login')} style={styles.cta} />
          </GlassView>
        </View>
      </View>
    );
  }

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
        <GlassView intensity={28} style={styles.heroCard}>
          <LinearGradient
            colors={['rgba(6,182,212,0.18)', 'rgba(124,58,237,0.12)', 'rgba(255,255,255,0.02)', 'transparent']}
            locations={[0, 0.35, 0.7, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={styles.heroHairlineTop} />
          <View pointerEvents="none" style={[styles.heroOrb, styles.heroOrbA]} />
          <View pointerEvents="none" style={[styles.heroOrb, styles.heroOrbB]} />

          {eyebrow ? <Text style={styles.heroEyebrow}>{eyebrow}</Text> : null}

          {Icon ? (
            <LinearGradient colors={[Colors.dark.secondary, Colors.dark.primary, 'rgba(255,255,255,0.10)']} style={styles.heroIconRing}>
              <View style={styles.heroIconInner}>
                <Icon size={26} color="white" />
              </View>
            </LinearGradient>
          ) : null}

          <Text style={styles.heroTitle}>{title}</Text>
          <Text style={styles.heroSubtitle}>{subtitle}</Text>

          <View style={styles.heroActions}>
            <TouchableOpacity activeOpacity={0.88} onPress={() => router.push('/(auth)/login')} style={styles.heroCtaOuter}>
              <LinearGradient
                colors={['rgba(124,58,237,0.75)', 'rgba(6,182,212,0.55)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.heroCtaBorder}
              >
                <View style={styles.heroCtaInner}>
                  <LinearGradient
                    colors={['rgba(124,58,237,0.22)', 'rgba(6,182,212,0.10)', 'transparent']}
                    locations={[0, 0.6, 1]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <Text style={styles.heroCtaText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                    {ctaLabel}
                  </Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
            {secondaryCtaLabel ? (
              <TouchableOpacity activeOpacity={0.88} onPress={() => router.push('/(auth)/register')} style={styles.heroCtaOuter}>
                <View style={styles.heroSecondaryOuter}>
                  <Text style={styles.heroSecondaryText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                    {secondaryCtaLabel}
                  </Text>
                </View>
              </TouchableOpacity>
            ) : null}
          </View>
        </GlassView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  content: {
    width: '100%',
    alignSelf: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    width: '100%',
    borderRadius: 24,
    paddingVertical: 22,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
  },
  iconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124,58,237,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.24)',
    marginBottom: 14,
  },
  title: {
    color: Colors.dark.text,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  subtitle: {
    color: Colors.dark.textSecondary,
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 420,
  },
  cta: {
    width: '100%',
    marginTop: 18,
  },
  heroCard: {
    width: '100%',
    borderRadius: 26,
    paddingHorizontal: 20,
    paddingVertical: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    overflow: 'hidden',
    alignItems: 'center',
  },
  heroHairlineTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  heroOrb: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: 'rgba(124,58,237,0.18)',
  },
  heroOrbA: {
    top: -110,
    left: -80,
    backgroundColor: 'rgba(6,182,212,0.18)',
  },
  heroOrbB: {
    bottom: -120,
    right: -90,
    backgroundColor: 'rgba(124,58,237,0.14)',
  },
  heroEyebrow: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 14,
    textAlign: 'center',
  },
  heroIconRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    padding: 2,
    marginBottom: 14,
  },
  heroIconInner: {
    flex: 1,
    borderRadius: 32,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  heroTitle: {
    color: 'white',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.72)',
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 420,
    fontSize: 14,
    fontWeight: '600',
  },
  heroActions: {
    width: '100%',
    marginTop: 18,
    gap: 12,
  },
  heroCtaOuter: {
    width: '100%',
    minWidth: 200,
    alignSelf: 'center',
  },
  heroCtaBorder: {
    borderRadius: 18,
    padding: 1,
  },
  heroCtaInner: {
    minHeight: 58,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    overflow: 'hidden',
    paddingHorizontal: 24,
    minWidth: 200,
  },
  heroCtaText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  heroSecondaryOuter: {
    minHeight: 58,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    minWidth: 200,
  },
  heroSecondaryText: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
});
