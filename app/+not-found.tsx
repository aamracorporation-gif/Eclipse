import { Link, Stack, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { AlertTriangle, Home } from '@/lib/icons';
import { Colors } from '@/constants/Colors';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { useTranslation } from 'react-i18next';

export default function NotFoundScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <LinearGradient
          colors={[Colors.dark.background, '#1e1b4b']}
          style={StyleSheet.absoluteFill}
        />
        
        <GlassView intensity={20} style={styles.card}>
          <View style={styles.iconContainer}>
            <AlertTriangle size={64} color={Colors.dark.primary} />
          </View>
          
          <Text style={styles.title}>{t('not_found.title')}</Text>
          <Text style={styles.subtitle}>{t('not_found.subtitle')}</Text>
          <Text style={styles.text}>{t('not_found.body')}</Text>

          <ThemedButton 
            title={t('not_found.cta')} 
            onPress={() => router.replace('/')}
            icon={<Home size={20} color="white" />}
            style={styles.button}
          />
        </GlassView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: Colors.dark.background,
  },
  card: {
    width: '100%',
    padding: 32,
    alignItems: 'center',
    borderRadius: 24,
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  title: {
    fontSize: 48,
    fontFamily: 'RussoOne_400Regular',
    color: 'white',
    marginBottom: 8,
    textShadowColor: 'rgba(124, 58, 237, 0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  subtitle: {
    fontSize: 20,
    color: Colors.dark.secondary,
    fontFamily: 'RussoOne_400Regular',
    marginBottom: 16,
    textAlign: 'center',
  },
  text: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 24,
  },
  button: {
    width: '100%',
  },
});
