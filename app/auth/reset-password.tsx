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

const SPECIALS = '!@#$%^&*(),.?":{}|<>';

function getReqs(pw: string) {
  return {
    len: pw.length >= 6,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    num: /[0-9]/.test(pw),
    special: SPECIALS.split('').some(c => pw.includes(c)),
  };
}

function isStrong(pw: string) {
  const r = getReqs(pw);
  return r.len && r.upper && r.lower && r.num && r.special;
}

const REQ_LABELS = [
  { key: 'len' as const, label: 'Mínimo 6 caracteres' },
  { key: 'upper' as const, label: 'Al menos una mayúscula (A-Z)' },
  { key: 'lower' as const, label: 'Al menos una minúscula (a-z)' },
  { key: 'num' as const, label: 'Al menos un número (0-9)' },
  { key: 'special' as const, label: 'Al menos un carácter especial (!@#$…)' },
];

export default function ResetPasswordScreen() {
  const { show: showDialog } = useAppDialog();
  const params = useLocalSearchParams<{ token_hash?: string; type?: string; access_token?: string }>();

  const [verifying, setVerifying] = useState(true);
  const [verified, setVerified] = useState(false);
  const [sessionToken, setSessionToken] = useState('');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pwTouched, setPwTouched] = useState(false);

  const reqs = getReqs(password);
  const strong = isStrong(password);
  const confirmErr = confirm && confirm !== password ? 'Las contraseñas no coinciden.' : null;
  const canSubmit = strong && confirm === password && !loading;

  // Verify the token on mount
  useEffect(() => {
    async function verify() {
      const tokenHash = params.token_hash;
      const accessToken = params.access_token;

      if (accessToken) {
        // Implicit flow: access_token already in params
        setSessionToken(accessToken);
        setVerified(true);
        setVerifying(false);
        return;
      }

      if (tokenHash) {
        try {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: 'recovery',
          });
          if (error || !data.session?.access_token) {
            showDialog({
              title: 'Enlace expirado',
              message: 'Este enlace ya fue usado o ha expirado. Solicita uno nuevo desde la pantalla de inicio de sesión.',
              onConfirm: () => router.replace('/(auth)/login'),
            });
          } else {
            setSessionToken(data.session.access_token);
            setVerified(true);
          }
        } catch {
          showDialog({
            title: 'Error',
            message: 'No se pudo verificar el enlace. Inténtalo de nuevo.',
            onConfirm: () => router.replace('/(auth)/login'),
          });
        }
      } else {
        // No token: check if already have an active session (user navigated here manually)
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) {
          setSessionToken(data.session.access_token);
          setVerified(true);
        } else {
          showDialog({
            title: 'Enlace inválido',
            message: 'No se encontró un token de recuperación. Solicita un nuevo enlace.',
            onConfirm: () => router.replace('/(auth)/login'),
          });
        }
      }
      setVerifying(false);
    }
    verify();
  }, []);

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
    <LinearGradient colors={['#0D0D1A', '#1a0533', '#0D0D1A']} style={styles.gradient}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.header}>
              <View style={styles.logoWrap}>
                <LinearGradient colors={['#7C3AED', '#06B6D4']} style={styles.logoGradient}>
                  <Sparkles size={28} color="#fff" />
                </LinearGradient>
              </View>
              <Text style={styles.title}>Nueva contraseña</Text>
              <Text style={styles.subtitle}>Elige una contraseña segura para tu cuenta Eclipse.</Text>
            </View>

            {verifying ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator size="large" color="#7C3AED" />
                <Text style={styles.loadingText}>Verificando enlace…</Text>
              </View>
            ) : !verified ? null : (
              <GlassView intensity={16} style={styles.card}>
                <View style={styles.field}>
                  <ThemedInput
                    label="Nueva contraseña"
                    value={password}
                    onChangeText={v => { setPassword(v); if (!pwTouched) setPwTouched(true); }}
                    secureTextEntry={!showPwd}
                    placeholder="Introduce tu contraseña"
                    leftIcon={<Lock size={18} color="rgba(255,255,255,0.45)" />}
                    rightIcon={
                      <TouchableOpacity onPress={() => setShowPwd(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        {showPwd ? <EyeOff size={18} color="rgba(255,255,255,0.45)" /> : <Eye size={18} color="rgba(255,255,255,0.45)" />}
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
                    leftIcon={<Lock size={18} color="rgba(255,255,255,0.45)" />}
                    rightIcon={
                      <TouchableOpacity onPress={() => setShowConfirm(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        {showConfirm ? <EyeOff size={18} color="rgba(255,255,255,0.45)" /> : <Eye size={18} color="rgba(255,255,255,0.45)" />}
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
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 32 },
  logoWrap: { width: 68, height: 68, borderRadius: 22, overflow: 'hidden', marginBottom: 20 },
  logoGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 26, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  subtitle: { color: 'rgba(255,255,255,0.55)', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  card: { borderRadius: 20, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', marginBottom: 20 },
  field: { marginBottom: 16 },
  loadingWrap: { alignItems: 'center', paddingVertical: 40, gap: 16 },
  loadingText: { color: 'rgba(255,255,255,0.55)', fontSize: 15 },
  reqs: { marginTop: 12, gap: 8 },
  reqRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reqDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  reqDotOk: { borderColor: '#4ade80', backgroundColor: '#4ade80' },
  reqCheck: { color: '#fff', fontSize: 10, fontWeight: '800' },
  reqText: { color: 'rgba(255,255,255,0.4)', fontSize: 13 },
  reqTextOk: { color: '#4ade80' },
  backLink: { alignItems: 'center', paddingVertical: 12 },
  backLinkText: { color: Colors.dark.primary, fontSize: 14, fontWeight: '600' },
});
