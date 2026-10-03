import { View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { useState, useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { Lock, Eye, EyeOff, Sparkles } from '@/lib/icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { GlassView } from '@/components/ui/GlassView';
import { useAppDialog } from '@/components/ui/AppDialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getPasswordRequirements, isPasswordStrong } from '@/lib/validators';
import { theme } from '@/theme/styles';

const REQ_LABELS = [
  { key: 'minLength' as const, label: 'Mínimo 6 caracteres' },
  { key: 'hasUpper' as const, label: 'Al menos una mayúscula (A-Z)' },
  { key: 'hasLower' as const, label: 'Al menos una minúscula (a-z)' },
  { key: 'hasNumber' as const, label: 'Al menos un número (0-9)' },
  { key: 'hasSpecial' as const, label: 'Al menos un carácter especial (!@#$…)' },
  { key: 'onlyAllowedChars' as const, label: 'Sin espacios, emojis ni símbolos no permitidos' },
];

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export default function ResetPasswordScreen() {
  const { show: showDialog } = useAppDialog();
  const params = useLocalSearchParams<{
    token_hash?: string;
    type?: string;
    access_token?: string;
    refresh_token?: string;
    code?: string;
    error?: string;
    error_description?: string;
  }>();

  const [verifying, setVerifying] = useState(true);
  const [verified, setVerified] = useState(false);
  const [verificationError, setVerificationError] = useState('');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pwTouched, setPwTouched] = useState(false);

  const reqs = getPasswordRequirements(password);
  const strong = isPasswordStrong(password);
  const confirmErr = confirm && confirm !== password ? 'Las contraseñas no coinciden.' : null;
  const canSubmit = strong && confirm === password && !loading;

  // Verify the token on mount
  useEffect(() => {
    let active = true;

    async function verify() {
      const tokenHash = firstParam(params.token_hash);
      const accessToken = firstParam(params.access_token);
      const refreshToken = firstParam(params.refresh_token);
      const code = firstParam(params.code);
      const authError = firstParam(params.error_description || params.error);

      const fail = (message: string) => {
        if (!active) return;
        setVerificationError(message);
        setVerified(false);
      };

      if (authError) {
        fail('El enlace no es válido o ha expirado. Solicita uno nuevo desde el inicio de sesión.');
        if (active) setVerifying(false);
        return;
      }

      if (accessToken) {
        if (!refreshToken) {
          fail('El enlace de recuperación está incompleto. Solicita uno nuevo desde el inicio de sesión.');
        } else {
          const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          if (error) fail('El enlace ya fue usado o ha expirado. Solicita uno nuevo.');
          else if (active) setVerified(true);
        }
        if (active) setVerifying(false);
        return;
      }

      if (tokenHash) {
        try {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'recovery',
          });
          if (error || !data.session?.access_token) fail('Este enlace ya fue usado o ha expirado. Solicita uno nuevo.');
          else if (active) setVerified(true);
        } catch {
          fail('No se pudo verificar el enlace. Comprueba tu conexión e inténtalo de nuevo.');
        }
      } else if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) fail('El enlace ya fue usado o ha expirado. Solicita uno nuevo.');
        else if (active) setVerified(true);
      } else {
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token && active) setVerified(true);
        else fail('No se encontró una sesión de recuperación válida. Solicita un nuevo enlace.');
      }
      if (active) setVerifying(false);
    }
    void verify();
    return () => { active = false; };
  }, [params.access_token, params.code, params.error, params.error_description, params.refresh_token, params.token_hash]);

  const handleUpdate = async () => {
    if (!canSubmit) return;
    try {
      setLoading(true);
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        showDialog({ title: 'Error', message: String(error.message || 'No se pudo actualizar la contraseña.') });
        return;
      }
      showDialog({
        title: '¡Contraseña actualizada!',
        message: 'Tu contraseña ha sido cambiada correctamente. Ya puedes iniciar sesión.',
        onConfirm: () => {
          supabase.auth.signOut().finally(() => router.replace('/(auth)/login'));
        },
      });
    } catch (e: any) {
      showDialog({ title: 'Error', message: String(e?.message || 'Error inesperado.') });
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={[Colors.dark.background, Colors.dark.backgroundElevated]} style={styles.gradient}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <View style={styles.logoWrap}>
                <LinearGradient colors={Colors.dark.primaryGradient} style={styles.logoGradient}>
                  <Sparkles size={30} color={Colors.dark.text} />
                </LinearGradient>
              </View>
              <Text style={styles.title}>Nueva contraseña</Text>
              <Text style={styles.subtitle}>Elige una contraseña segura para tu cuenta Eclipse.</Text>
            </View>

            {verifying ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="large" color={Colors.dark.primary} />
                <Text style={styles.loadingText}>Verificando enlace…</Text>
              </View>
            ) : !verified ? (
              <GlassView intensity={16} style={styles.errorCard}>
                <Text style={styles.errorTitle}>No podemos abrir este enlace</Text>
                <Text style={styles.errorBody}>{verificationError}</Text>
                <ThemedButton
                  title="Solicitar un enlace nuevo"
                  onPress={() => router.replace('/(auth)/login')}
                />
              </GlassView>
            ) : (
              <GlassView intensity={16} style={styles.card}>
                <View style={styles.field}>
                  <ThemedInput
                    label="Nueva contraseña"
                    value={password}
                    onChangeText={v => { setPassword(v); if (!pwTouched) setPwTouched(true); }}
                    secureTextEntry={!showPwd}
                    placeholder="Introduce tu contraseña"
                    leftIcon={<Lock size={18} color={Colors.dark.textSecondary} />}
                    rightIcon={
                      <TouchableOpacity onPress={() => setShowPwd(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        {showPwd ? <EyeOff size={18} color={Colors.dark.textSecondary} /> : <Eye size={18} color={Colors.dark.textSecondary} />}
                      </TouchableOpacity>
                    }
                  />
                  {pwTouched && (
                    <View style={styles.reqs}>
                      {REQ_LABELS.map(({ key, label }) => (
                        <View key={key} style={styles.reqRow}>
                          <View style={[styles.reqDot, reqs[key] && styles.reqDotOk]}>
                            {reqs[key] && <Text style={styles.reqCheck}>✓</Text>}
                          </View>
                          <Text style={[styles.reqText, reqs[key] && styles.reqTextOk]}>{label}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                <View style={styles.field}>
                  <ThemedInput
                    label="Repetir contraseña"
                    value={confirm}
                    onChangeText={setConfirm}
                    secureTextEntry={!showConfirm}
                    placeholder="Repite la contraseña"
                    leftIcon={<Lock size={18} color={Colors.dark.textSecondary} />}
                    rightIcon={
                      <TouchableOpacity onPress={() => setShowConfirm(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        {showConfirm ? <EyeOff size={18} color={Colors.dark.textSecondary} /> : <Eye size={18} color={Colors.dark.textSecondary} />}
                      </TouchableOpacity>
                    }
                    error={confirmErr ?? undefined}
                  />
                </View>

                <ThemedButton
                  title={loading ? 'Guardando…' : 'Actualizar contraseña'}
                  onPress={handleUpdate}
                  disabled={!canSubmit}
                  style={{ marginTop: 8 }}
                />
              </GlassView>
            )}

            <TouchableOpacity onPress={() => router.replace('/(auth)/login')} style={styles.backLink}>
              <Text style={styles.backLinkText}>Volver al inicio de sesión</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: theme.space[6] },
  header: { alignItems: 'center', marginBottom: theme.space[8] },
  logoWrap: { width: 80, height: 80, borderRadius: 40, overflow: 'hidden', marginBottom: theme.space[5] },
  logoGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: Colors.dark.text, fontSize: theme.typography.size['3xl'], fontWeight: theme.typography.weight.black, textAlign: 'center', marginBottom: theme.space[2] },
  subtitle: { color: Colors.dark.textSecondary, fontSize: theme.typography.size.md, textAlign: 'center', lineHeight: 22 },
  card: { marginBottom: theme.space[5] },
  errorCard: { marginBottom: theme.space[5] },
  errorTitle: { color: Colors.dark.text, fontSize: theme.typography.size.xl, fontWeight: theme.typography.weight.bold, textAlign: 'center', marginBottom: theme.space[3] },
  errorBody: { color: Colors.dark.textSecondary, fontSize: theme.typography.size.sm, textAlign: 'center', lineHeight: 21, marginBottom: theme.space[5] },
  field: { marginBottom: theme.space[2] },
  loadingWrap: { alignItems: 'center', paddingVertical: 40, gap: 16 },
  loadingText: { color: Colors.dark.textSecondary, fontSize: theme.typography.size.md },
  reqs: { marginTop: 12, gap: 8 },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reqDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: Colors.dark.borderStrong, alignItems: 'center', justifyContent: 'center' },
  reqDotOk: { borderColor: Colors.dark.success, backgroundColor: Colors.dark.success },
  reqCheck: { color: Colors.dark.text, fontSize: 10, fontWeight: theme.typography.weight.black },
  reqText: { color: Colors.dark.textMuted, fontSize: 13, flex: 1 },
  reqTextOk: { color: Colors.dark.success },
  backLink: { alignItems: 'center', paddingVertical: 12 },
  backLinkText: { color: Colors.dark.primary, fontSize: 14, fontWeight: '600' },
});
