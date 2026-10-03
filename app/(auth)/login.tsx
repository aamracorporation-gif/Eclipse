import { View, Text, StyleSheet, TouchableOpacity, TextInput, Keyboard, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@/lib/AuthContext';
import { getErrorMessage } from '@/lib/errorHelpers';
import { Mail, Lock, Sparkles, Eye, EyeOff } from '@/lib/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { GlassView } from '@/components/ui/GlassView';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';
import { theme } from '@/theme/styles';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppDialog } from '@/components/ui/AppDialog';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const { signIn, resetPassword, resendVerificationEmail } = useAuth();
  const { t } = useTranslation();
  const { show: showDialog } = useAppDialog();
  const router = useRouter();
  
  const passwordInputRef = useRef<TextInput>(null);

  // Remove connection check for cleaner UX now that config is fixed
  useEffect(() => {
    // Optional: Add any initialization logic here if needed
  }, []);

  const handleResendVerification = async () => {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      showDialog({ title: t('auth.reset_password.email_required_title'), message: 'Introduce tu correo para poder reenviar la verificación.' });
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      showDialog({ title: t('common.error'), message: 'Introduce un email válido.' });
      return;
    }
    try {
      setResendingEmail(true);
      const { error } = await resendVerificationEmail(cleanEmail);
      if (error) {
        const msg = String(error?.message || error || '');
        const lower = msg.toLowerCase();
        if (lower.includes('rate limit')) {
          showDialog({
            title: 'Límite alcanzado',
            message: 'Has alcanzado el límite de reenvíos. Espera unos minutos y vuelve a intentarlo.',
          });
        } else if (lower.includes('already') || lower.includes('confirmed')) {
          showDialog({
            title: 'Cuenta ya confirmada',
            message: 'Esta cuenta ya está verificada. Inicia sesión con tu email y contraseña.',
          });
        } else {
          showDialog({ title: t('common.error'), message: getErrorMessage(error) });
        }
      } else {
        showDialog({
          title: 'Correo reenviado',
          message: 'Te hemos vuelto a enviar el enlace de confirmación. Revisa tu correo (y la carpeta de Spam si no aparece).',
        });
      }
    } catch {
      showDialog({ title: t('common.error'), message: 'No se pudo reenviar el email. Inténtalo más tarde.' });
    } finally {
      setResendingEmail(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email) {
      showDialog({ title: t('auth.reset_password.email_required_title'), message: t('auth.reset_password.email_required_body') });
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      showDialog({ title: t('common.error'), message: 'Introduce un email válido.' });
      return;
    }
    
    try {
      setLoading(true);
      const { error } = await resetPassword(email);
      if (error) {
        showDialog({ title: t('common.error'), message: getErrorMessage(error) });
      } else {
        showDialog({ title: t('auth.reset_password.sent_title'), message: t('auth.reset_password.sent_body') });
      }
    } catch {
      showDialog({ title: t('common.error'), message: t('auth.reset_password.failed') });
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    // 1. Dismiss Keyboard & Debug
    Keyboard.dismiss();
    
    // 2. Configuration Check
    const sbUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const sbAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (!sbUrl || sbUrl.includes('placeholder')) {
      showDialog({ title: t('auth.login_screen.config_error_title'), message: t('auth.login_screen.config_error_missing_url') });
       return;
    }
    if (!sbAnonKey || sbAnonKey.includes('placeholder')) {
       showDialog({ title: t('auth.login_screen.config_error_title'), message: t('auth.login_screen.config_error_missing_anon') });
       return;
    }

    // 1. Basic validation & Trim
    const cleanEmail = email.trim();
    const cleanPassword = password;

    if (!cleanEmail) {
      setEmailError('El email es obligatorio.');
      showDialog({ title: t('auth.login_screen.missing_fields_title'), message: t('auth.login_screen.missing_fields_body') });
      return;
    }

    if (!EMAIL_REGEX.test(cleanEmail)) {
      setEmailError('Introduce un email válido.');
      return;
    }

    setEmailError('');

    if (!cleanPassword) {
      showDialog({ title: t('auth.login_screen.missing_fields_title'), message: t('auth.login_screen.missing_fields_body') });
      return;
    }

    try {
      setLoading(true);

      // The sign-in request is the authoritative connectivity check. A
      // separate /health preflight added latency and could reject valid logins
      // because of transient network or CORS differences.
      const { data, error } = await signIn(cleanEmail, cleanPassword);

      if (error) {
        // Handle specific error cases
        if (error.message?.includes('Email not confirmed')) {
          showDialog({
            title: t('auth.login_screen.email_not_confirmed_title'),
            message: t('auth.login_screen.email_not_confirmed_body') + '\n\nPuedes reenviar el correo de confirmación ahora mismo. Revisa también la carpeta de Spam si no lo encuentras.',
            actions: [
              { label: 'Aceptar', onPress: () => {}, variant: 'outline' as any },
              {
                label: resendingEmail ? 'Enviando…' : 'Reenviar correo',
                onPress: () => {
                  if (resendingEmail) return;
                  void handleResendVerification();
                },
                variant: 'primary' as any,
              },
            ],
          });
        } else if (error.message?.includes('Invalid login credentials')) {
           showDialog({ title: t('auth.login_screen.invalid_credentials_title'), message: t('auth.login_screen.invalid_credentials_body') });
        } else {
           // Fallback showing the RAW error to help debug
           showDialog({ title: t('auth.login_screen.access_error_title'), message: t('auth.login_screen.access_error_body', { detail: error.message }) });
        }
        
        setLoading(false);
        return;
      }

      if (data.session) {
        // Redirigir siempre a la pestaña principal como pidió el usuario
        const metadata = data.user?.user_metadata || {};
        const metadataRole = metadata.role;

        // No es necesario hacer setSession manualmente si persistSession está activo
        // y autoRefreshToken también. Supabase ya lo gestiona.
        
        // Esperar un poco a que la sesión se propague si es necesario, 
        // pero idealmente confiamos en el AuthContext.

        let profileRole: string | null = metadataRole ?? null;
        try {
          if (data.user?.id) {
            const { data: profileData } = await supabase.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
            profileRole = (profileData?.role as any) ?? profileRole;
          }
        } catch {}

        if (profileRole === 'admin') router.replace('/(creator)');
        else if (profileRole === 'organizer') router.replace('/(creator)');
        else router.replace('/(tabs)');
      } else {
        setLoading(false);
        showDialog({
          title: t('auth.login_screen.verification_required_title'),
          message: t('auth.login_screen.verification_required_body'),
        });
      }
    } catch (err: any) {
      console.error('Unexpected login error:', err);
      const errorMsg = err.message || 'Ha ocurrido un error inesperado.';
      
      if (errorMsg.includes('Failed to fetch') || errorMsg.includes('Network request failed')) {
         showDialog({ title: t('errors.network'), message: t('auth.login_screen.network_failed') });
      } else {
         showDialog({ title: t('common.error'), message: errorMsg });
      }
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={Colors.dark.backgroundGradient}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.header}>
              <View style={styles.iconContainer}>
                <Sparkles size={40} color={Colors.dark.primary} />
              </View>
              <Text style={styles.title}>{t('auth.login_screen.welcome_title')}</Text>
              <Text style={styles.subtitle}>{t('auth.login_screen.welcome_subtitle')}</Text>
            </View>

            <GlassView intensity={30} style={styles.formCard}>
              <ThemedInput
                placeholder={t('auth.email')}
                value={email}
                onChangeText={(v) => { setEmail(v); if (emailError) setEmailError(''); }}
                onBlur={() => {
                  const v = email.trim();
                  if (v && !EMAIL_REGEX.test(v)) setEmailError('Introduce un email válido.');
                  else setEmailError('');
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => passwordInputRef.current?.focus()}
                blurOnSubmit={false}
                icon={Mail}
                error={emailError || undefined}
              />

              <ThemedInput
                ref={passwordInputRef}
                placeholder={t('auth.password')}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                autoComplete="password"
                returnKeyType="done"
                onSubmitEditing={handleLogin}
                icon={Lock}
                rightIcon={
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                    {showPassword ? (
                      <EyeOff size={20} color={Colors.dark.textSecondary} />
                    ) : (
                      <Eye size={20} color={Colors.dark.textSecondary} />
                    )}
                  </TouchableOpacity>
                }
              />

              <TouchableOpacity
                style={styles.forgotPassword}
                onPress={handleResetPassword}
                disabled={loading}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.forgotPasswordText}>{t('auth.forgot_password')}</Text>
              </TouchableOpacity>

              <ThemedButton
                title={loading ? t('auth.login_screen.signing_in') : t('auth.login')}
                onPress={handleLogin}
                disabled={loading}
                style={styles.button}
              />
            </GlassView>

            <View style={styles.footer}>
              <Text style={styles.footerText}>{t('auth.login_screen.no_account')}</Text>
              <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
                <Text style={styles.linkText}>{t('auth.register')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  safeArea: {
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: theme.space[6],
    paddingVertical: theme.space[6],
  },
  header: {
    alignItems: 'center',
    marginBottom: theme.space[8],
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.dark.primarySoft,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.space[5],
    borderWidth: 1,
    borderColor: Colors.dark.primary,
  },
  title: {
    fontSize: theme.typography.size['3xl'],
    fontWeight: theme.typography.weight.black,
    color: Colors.dark.text,
    marginBottom: theme.space[2],
    fontFamily: theme.typography.fontFamily.display,
  },
  subtitle: {
    fontSize: theme.typography.size.md,
    color: Colors.dark.textSecondary,
  },
  formCard: {
    marginBottom: theme.space[8],
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: theme.space[6],
  },
  forgotPasswordText: {
    color: Colors.dark.textSecondary,
    fontSize: theme.typography.size.sm,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  footerText: {
    color: Colors.dark.textSecondary,
    fontSize: theme.typography.size.md,
  },
  linkText: {
    color: Colors.dark.primary,
    fontSize: theme.typography.size.md,
    fontWeight: theme.typography.weight.bold,
  },
  button: {
    marginTop: theme.space[4],
  }
});
