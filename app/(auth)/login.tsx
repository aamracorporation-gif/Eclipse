import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert, TouchableOpacity, TextInput, Keyboard } from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/AuthContext';
import { getErrorMessage } from '@/lib/errorHelpers';
import { Mail, Lock, Sparkles, Eye, EyeOff } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '@/constants/Colors';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { GlassView } from '@/components/ui/GlassView';
import { scheduleLocalNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signIn, resetPassword } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  const passwordInputRef = useRef<TextInput>(null);

  // Remove connection check for cleaner UX now that config is fixed
  useEffect(() => {
    // Optional: Add any initialization logic here if needed
  }, []);

  const handleResetPassword = async () => {
    if (!email) {
      Alert.alert('Email requerido', 'Por favor introduce tu correo electrónico para restablecer la contraseña.');
      return;
    }
    
    try {
      setLoading(true);
      const { error } = await resetPassword(email);
      if (error) {
        Alert.alert('Error', getErrorMessage(error));
      } else {
        Alert.alert('Correo enviado', 'Revisa tu bandeja de entrada para restablecer tu contraseña.');
      }
    } catch {
      Alert.alert('Error', 'No se pudo enviar el correo.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    // 1. Dismiss Keyboard & Debug
    Keyboard.dismiss();
    console.log('BOTON PRESIONADO: handleLogin disparado');
    
    // 2. Configuration Check
    const sbUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const sbAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (!sbUrl || sbUrl.includes('placeholder')) {
       Alert.alert('Error de Configuración', 'Falta la URL de Supabase en las variables de entorno (.env).');
       return;
    }
    if (!sbAnonKey || sbAnonKey.includes('placeholder')) {
       Alert.alert('Error de Configuración', 'Falta la ANON KEY de Supabase en las variables de entorno (.env).');
       return;
    }

    // 1. Basic validation & Trim
    const cleanEmail = email.trim();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanPassword) {
      Alert.alert('Faltan datos', 'Por favor introduce tu email y contraseña.');
      return;
    }

    try {
      setLoading(true);

      try {
        const res = await fetchWithTimeout(
          `${sbUrl}/auth/v1/health`,
          {
            method: 'GET',
            headers: { apikey: sbAnonKey },
          },
          7000
        );
        if (!res.ok) {
          throw new Error(`Supabase health HTTP ${res.status}`);
        }
      } catch (e: any) {
        const msg = String(e?.message || e || '');
        const isAbort = msg.includes('aborted') || msg.includes('AbortError');
        Alert.alert(
          'Error de Conexión',
          isAbort
            ? 'No se pudo conectar con Supabase (timeout). Revisa tu conexión y que no haya VPN/proxy bloqueando.'
            : 'No se pudo conectar con Supabase. Revisa tu conexión y que la URL/clave sean correctas.'
        );
        setLoading(false);
        return;
      }
      
      // 2. Attempt Sign In
      const { data, error } = await signIn(cleanEmail, cleanPassword);
      
      console.log('Login result:', { data, error });

      if (error) {
        console.log('Login Error Details:', error);
        
        // Handle specific error cases
        if (error.message?.includes('Email not confirmed')) {
          Alert.alert(
            'Verificación Pendiente', 
            'Tu cuenta ha sido creada pero aún no has verificado tu correo electrónico. Por favor revisa tu bandeja de entrada.'
          );
        } else if (error.message?.includes('Invalid login credentials')) {
           Alert.alert('Credenciales Incorrectas', 'El correo o la contraseña no coinciden. Asegúrate de no tener espacios extra.');
        } else {
           // Fallback showing the RAW error to help debug
           Alert.alert('Error de acceso', `Detalle: ${error.message}`);
        }
        
        setLoading(false);
        return;
      }

      if (data.session) {
        console.log('Session created, redirecting...');
        // Redirigir siempre a la pestaña principal como pidió el usuario
        const metadata = data.user?.user_metadata || {};
        const metadataRole = metadata.role;

        // No es necesario hacer setSession manualmente si persistSession está activo
        // y autoRefreshToken también. Supabase ya lo gestiona.
        
        // Esperar un poco a que la sesión se propague si es necesario, 
        // pero idealmente confiamos en el AuthContext.

        // Schedule welcome notification
        await scheduleLocalNotification(
          "¡Bienvenido de nuevo! 👋",
          "Que tengas una noche increíble. Explora los mejores eventos cerca de ti.",
          { type: 'welcome' },
          2 // 2 seconds delay
        );

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
        Alert.alert(
          'Verificación requerida',
          'Por favor verifica tu correo electrónico para poder acceder.'
        );
      }
    } catch (err: any) {
      console.error('Unexpected login error:', err);
      const errorMsg = err.message || 'Ha ocurrido un error inesperado.';
      
      if (errorMsg.includes('Failed to fetch') || errorMsg.includes('Network request failed')) {
         Alert.alert('Error de Conexión', 'No se pudo conectar. Verifica internet y URL de Supabase.');
      } else {
         Alert.alert('Error', errorMsg);
      }
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[Colors.dark.background, '#1e1b4b']}
        style={StyleSheet.absoluteFill}
      />
      
      <KeyboardAvoidingView
        style={styles.content}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView 
          contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 20 }]} 
          showsVerticalScrollIndicator={false} 
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <Sparkles size={40} color={Colors.dark.primary} />
            </View>
            <Text style={styles.title}>Bienvenido de nuevo</Text>
            <Text style={styles.subtitle}>La noche te espera.</Text>
          </View>

          <GlassView intensity={30} style={styles.formCard}>
            <ThemedInput
              placeholder="Correo electrónico"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              returnKeyType="next"
              onSubmitEditing={() => passwordInputRef.current?.focus()}
              blurOnSubmit={false}
              icon={Mail}
            />

            <ThemedInput
              ref={passwordInputRef}
              placeholder="Contraseña"
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
              <Text style={styles.forgotPasswordText}>¿Olvidaste tu contraseña?</Text>
            </TouchableOpacity>

            <ThemedButton 
              title={loading ? 'Iniciando sesión...' : 'Iniciar Sesión'}
              onPress={handleLogin}
              disabled={loading}
              style={styles.button}
            />
          </GlassView>

          <View style={styles.footer}>
            <Text style={styles.footerText}>¿No tienes cuenta?</Text>
            <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
              <Text style={styles.linkText}>Regístrate</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.3)',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: Colors.dark.text,
    marginBottom: 8,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  subtitle: {
    fontSize: 16,
    color: Colors.dark.textSecondary,
  },
  formCard: {
    marginBottom: 32,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 24,
  },
  forgotPasswordText: {
    color: Colors.dark.textSecondary,
    fontSize: 14,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  footerText: {
    color: Colors.dark.textSecondary,
    fontSize: 16,
  },
  linkText: {
    color: Colors.dark.primary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  localButton: {
    width: '100%',
    height: 56,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  localButtonGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  localButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  button: {
    marginTop: 16,
  }
});
