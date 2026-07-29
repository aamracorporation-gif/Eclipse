import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Platform, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';

type DiscoLoaderProps = {
  label?: string;
  subLabel?: string;
  size?: number;
  fullScreen?: boolean;
  style?: StyleProp<ViewStyle>;
};

const discoLogo = require('../../assets/images/Icon.png');

export function DiscoLoader({ label, subLabel, size = 140, fullScreen = false, style }: DiscoLoaderProps) {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spinLoop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: true }));
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      ])
    );
    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 1450, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 1450, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      ])
    );

    spinLoop.start();
    pulseLoop.start();
    shimmerLoop.start();

    return () => {
      spinLoop.stop();
      pulseLoop.stop();
      shimmerLoop.stop();
    };
  }, [pulse, shimmer, spin]);

  const rotateDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const ringRotateDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ['14deg', '374deg'] });
  const ballScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] });
  const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0.62] });
  const shimmerX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-size * 0.95, size * 0.95] });

  const stroke = Math.max(1, Math.round(size * 0.018));
  const logoSize = Math.max(12, Math.round(size * 0.5));
  const facetCount = Math.max(4, Math.min(10, Math.round(size / 22)));
  const facetThickness = Math.max(1, Math.round(size * 0.01));
  const sparkleSize = Math.max(2, Math.round(size * 0.055));
  const sparkleOffset = Math.round(size * 0.42);

  const content = (
    <View style={[styles.center, style]}>
      <View style={[styles.stage, { width: size, height: size }]}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              width: size * 1.25,
              height: size * 1.25,
              borderRadius: (size * 1.25) / 2,
              opacity: haloOpacity,
              transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
            },
          ]}
        >
          <LinearGradient
            colors={['rgba(124,58,237,0.14)', 'rgba(6,182,212,0.10)', 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0)']}
            locations={[0, 0.4, 0.7, 1]}
            start={{ x: 0.1, y: 0.1 }}
            end={{ x: 0.9, y: 0.9 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        <Animated.View
          pointerEvents="none"
          style={[
            styles.eclipsering,
            {
              width: size * 1.12,
              height: size * 1.12,
              borderRadius: (size * 1.12) / 2,
              borderWidth: stroke,
              transform: [{ rotateZ: ringRotateDeg }],
            },
          ]}
        >
          <View style={[StyleSheet.absoluteFill, { borderRadius: (size * 1.12) / 2, overflow: 'hidden' }]}>
            <LinearGradient
              colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.26)', 'rgba(255,255,255,0)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </View>
          <View
            pointerEvents="none"
            style={[
              styles.eclipseShadow,
              {
                width: size * 1.12,
                height: size * 1.12,
                borderRadius: (size * 1.12) / 2,
                transform: [{ translateX: -size * 0.14 }, { translateY: size * 0.08 }],
              },
            ]}
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.ball,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: Math.max(1, Math.round(stroke * 0.75)),
              transform: [{ scale: ballScale }],
            },
          ]}
        >
          {/* Clip wrapper for gradients/shimmer/facets — required on Android */}
          <View style={[StyleSheet.absoluteFill, { borderRadius: size / 2, overflow: 'hidden' }]} pointerEvents="none">
            <LinearGradient
              colors={['rgba(255,255,255,0.14)', 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0.10)']}
              locations={[0, 0.5, 1]}
              start={{ x: 0.1, y: 0.1 }}
              end={{ x: 0.9, y: 0.9 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.facets}>
              {Array.from({ length: facetCount }).map((_, i) => {
                const pct = i / (facetCount - 1 || 1);
                return (
                  <View
                    key={`v-${i}`}
                    style={[
                      styles.facetLine,
                      {
                        width: facetThickness,
                        left: Math.round(pct * size) - Math.round(facetThickness / 2),
                        top: 0,
                        bottom: 0,
                        opacity: 0.06 + (i % 3) * 0.012,
                      },
                    ]}
                  />
                );
              })}
              {Array.from({ length: facetCount }).map((_, i) => {
                const pct = i / (facetCount - 1 || 1);
                return (
                  <View
                    key={`h-${i}`}
                    style={[
                      styles.facetLine,
                      {
                        height: facetThickness,
                        top: Math.round(pct * size) - Math.round(facetThickness / 2),
                        left: 0,
                        right: 0,
                        opacity: 0.06 + (i % 3) * 0.012,
                      },
                    ]}
                  />
                );
              })}
            </View>
            <Animated.View
              style={[
                styles.shimmer,
                {
                  width: Math.max(16, Math.round(size * 0.56)),
                  top: -Math.round(size * 0.12),
                  bottom: -Math.round(size * 0.12),
                  transform: [{ translateX: shimmerX }, { rotateZ: '-24deg' }],
                },
              ]}
            >
              <LinearGradient
                colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.26)', 'rgba(255,255,255,0)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
            <View
              style={[
                styles.specular,
                {
                  top: Math.max(2, Math.round(size * 0.08)),
                  left: Math.max(2, Math.round(size * 0.08)),
                  right: Math.max(2, Math.round(size * 0.08)),
                  height: Math.max(6, Math.round(size * 0.18)),
                  borderRadius: Math.max(4, Math.round(size * 0.14)),
                },
              ]}
            />
          </View>
          {/* Logo and wordmark rendered above clip wrapper */}
          <View style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 2, overflow: 'hidden' }}>
            <Image source={discoLogo} style={{ width: logoSize, height: logoSize, opacity: 0.92 }} resizeMode="cover" fadeDuration={0} />
          </View>
          {size >= 86 ? (
            <Text
              style={[
                styles.wordmark,
                {
                  fontSize: Math.max(10, Math.round(size * 0.092)),
                  bottom: Math.max(10, Math.round(size * 0.12)),
                },
              ]}
            >
              ECLIPSE
            </Text>
          ) : null}
        </Animated.View>

        <Animated.View pointerEvents="none" style={[styles.sparkOrbit, { width: size, height: size, transform: [{ rotateZ: rotateDeg }] }]}>
          <View
            style={[
              styles.spark,
              {
                width: sparkleSize,
                height: sparkleSize,
                borderRadius: sparkleSize / 2,
                top: size / 2 - sparkleSize / 2,
                left: size / 2 - sparkleSize / 2,
                transform: [{ translateY: -sparkleOffset }],
              },
            ]}
          />
          <View
            style={[
              styles.spark,
              {
                width: Math.max(2, Math.round(sparkleSize * 0.72)),
                height: Math.max(2, Math.round(sparkleSize * 0.72)),
                borderRadius: Math.max(2, Math.round(sparkleSize * 0.72)) / 2,
                top: size / 2 - sparkleSize / 2,
                left: size / 2 - sparkleSize / 2,
                transform: [{ rotateZ: '64deg' }, { translateY: -sparkleOffset }],
                opacity: 0.66,
              },
            ]}
          />
        </Animated.View>
      </View>

      {label ? <Text style={styles.label}>{label}</Text> : null}
      {subLabel ? <Text style={styles.subLabel}>{subLabel}</Text> : null}
    </View>
  );

  if (!fullScreen) return content;

  return (
    <View style={styles.fullScreen}>
      <LinearGradient colors={['#050510', '#0b1020', '#0a0a14']} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={styles.ambientTop} />
      <View pointerEvents="none" style={styles.ambientBottom} />
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.background,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    overflow: 'hidden',
  },
  eclipsering: {
    position: 'absolute',
    borderColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
  },
  eclipseShadow: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  ball: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: Platform.OS === 'android' ? 'visible' : 'hidden',
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderColor: 'rgba(255,255,255,0.14)',
    ...(Platform.OS === 'ios'
      ? {
          shadowColor: '#000',
          shadowOpacity: 0.28,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 12 },
        }
      : { elevation: 10 }),
  },
  facets: {
    ...StyleSheet.absoluteFillObject,
  },
  facetLine: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,1)',
  },
  shimmer: {
    position: 'absolute',
    opacity: Platform.OS === 'android' ? 0.38 : 0.46,
  },
  specular: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.08)',
    transform: [{ rotateZ: '-18deg' }],
  },
  sparkOrbit: {
    position: 'absolute',
  },
  spark: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.92)',
    ...(Platform.OS === 'ios'
      ? {
          shadowColor: '#fff',
          shadowOpacity: 0.35,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 0 },
        }
      : { elevation: 6 }),
  },
  label: {
    marginTop: 18,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  subLabel: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  wordmark: {
    position: 'absolute',
    left: 0,
    right: 0,
    textAlign: 'center',
    color: 'rgba(255,255,255,0.62)',
    fontWeight: '700',
    letterSpacing: 2.6,
  },
  ambientTop: {
    position: 'absolute',
    top: -120,
    width: 520,
    height: 520,
    borderRadius: 260,
    backgroundColor: 'rgba(255,255,255,0.06)',
    transform: [{ rotateZ: '12deg' }],
  },
  ambientBottom: {
    position: 'absolute',
    bottom: -140,
    width: 560,
    height: 560,
    borderRadius: 280,
    backgroundColor: 'rgba(255,255,255,0.03)',
    transform: [{ rotateZ: '-14deg' }],
  },
});

