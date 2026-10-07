import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Session, User } from '@supabase/supabase-js';
import { setNotificationUser, unregisterForPushNotifications } from './notifications';
import * as Linking from 'expo-linking';
import { resolveAuthRedirect } from './authRedirect';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { invokeEdgeFunctionStrict } from '@/lib/edgeFunctions';

export type WorkerProfile = {
  id: string;
  organizer_id: string;
  name: string;
  status: 'pending' | 'active' | 'inactive';
  permissions: any;
};

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  workerProfile: WorkerProfile | null;
  signIn: (email: string, password: string) => Promise<{ data: any; error: any }>;
  signUp: (email: string, password: string, metadata?: any) => Promise<{ data: any; error: any }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: any }>;
  resendVerificationEmail: (email: string) => Promise<{ error: any }>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  workerProfile: null,
  signIn: async () => ({ data: null, error: null }),
  signUp: async () => ({ data: null, error: null }),
  signOut: async () => {},
  resetPassword: async () => ({ error: null }),
  resendVerificationEmail: async () => ({ error: null }),
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function isInvalidRefreshTokenError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '');
  return msg.includes('Invalid Refresh Token') || msg.includes('Refresh Token Not Found');
}

async function clearSupabasePersistedSession(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const toRemove = keys.filter(
      k => k.includes('auth-token') || k.includes('supabase.auth.token') || k.startsWith('sb-')
    );
    if (toRemove.length) await AsyncStorage.multiRemove(toRemove);
  } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [workerProfile, setWorkerProfile] = useState<WorkerProfile | null>(null);

  useEffect(() => {
    setNotificationUser(user?.id ?? null);
    if (user) {
      fetchWorkerProfile(user.id);
      (async () => {
        try {
          const raw = await AsyncStorage.getItem('pending_event_share');
          if (!raw) return;
          const parsed = JSON.parse(raw);
          const eventId = String(parsed?.eventId || '');
          const token = String(parsed?.token || '');
          if (!eventId || !token) return;
          await invokeEdgeFunctionStrict('event-share', { action: 'convert', token, kind: 'login' });
          await AsyncStorage.removeItem('pending_event_share');
        } catch {}
      })();
    } else {
      setWorkerProfile(null);
    }
  }, [user]);

  const fetchWorkerProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('workers')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .single();
      
      if (data && !error) {
        setWorkerProfile(data);
      } else {
        setWorkerProfile(null);
      }
    } catch {
      console.error('No se pudo cargar el perfil de trabajador.');
      setWorkerProfile(null);
    }
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const result: any = await withTimeout(supabase.auth.getSession(), 20000, 'Session check');
        const error = result?.error;
        if (error) throw error;
        if (mounted && result?.data) {
          setSession(result.data.session);
          setUser(result.data.session?.user ?? null);
        }
      } catch (err) {
        if (isInvalidRefreshTokenError(err)) {
          await clearSupabasePersistedSession();
          try {
            await supabase.auth.signOut({ scope: 'local' } as any);
          } catch {
            try {
              await supabase.auth.signOut();
            } catch {}
          }
        } else {
          console.warn('Error getting session:', err);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setSession(session);
        setUser(session?.user ?? null);
        // Ensure loading is false when auth state changes
        setLoading(false); 
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email,
          password,
        }),
        20000,
        'Sign in'
      );
      return { data, error };
    } catch (err: any) {
      return { data: null, error: err };
    }
  };

  const signUp = async (email: string, password: string, metadata: any = {}) => {
    try {
      const emailRedirectTo = resolveAuthRedirect({
        explicitUrl: process.env.EXPO_PUBLIC_EMAIL_REDIRECT_URL,
        apiUrl: process.env.EXPO_PUBLIC_API_URL,
        fallback: Linking.createURL('auth/callback'),
      });

      const { data, error } = await withTimeout(
        supabase.auth.signUp({
          email,
          password,
          options: {
            data: metadata,
            emailRedirectTo,
          },
        }),
        20000,
        'Sign up'
      );

      return { data, error };
    } catch (err: any) {
      return { data: null, error: err };
    }
  };

  const signOut = async () => {
    await withTimeout(unregisterForPushNotifications(user?.id ?? null), 4000, 'Push unregister').catch(() => {});
    const result = await withTimeout(supabase.auth.signOut(), 20000, 'Sign out');
    if (result.error) { setNotificationUser(user?.id ?? null); throw result.error; }
  };

  const resetPassword = async (email: string) => {
    try {
      const redirectTo = resolveAuthRedirect({
        explicitUrl: process.env.EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL || process.env.EXPO_PUBLIC_EMAIL_REDIRECT_URL,
        apiUrl: process.env.EXPO_PUBLIC_API_URL,
        fallback: Linking.createURL('auth/reset-password'),
      });
      const { error } = await withTimeout(
        supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo }),
        20000,
        'Reset password'
      );
      return { error };
    } catch (err: any) {
      return { error: err };
    }
  };

  const resendVerificationEmail = async (email: string) => {
    try {
      const emailRedirectTo = resolveAuthRedirect({
        explicitUrl: process.env.EXPO_PUBLIC_EMAIL_VERIFY_URL || process.env.EXPO_PUBLIC_EMAIL_REDIRECT_URL,
        apiUrl: process.env.EXPO_PUBLIC_API_URL,
        fallback: Linking.createURL('auth/callback'),
      });
      const { data, error } = await withTimeout(
        supabase.auth.resend({
          type: 'signup',
          email: String(email || '').trim(),
          options: { emailRedirectTo },
        } as any),
        20000,
        'Resend verification email'
      );
      return { data, error };
    } catch (err: any) {
      return { data: null, error: err };
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, workerProfile, signIn, signUp, signOut, resetPassword, resendVerificationEmail }}>
      {children}
    </AuthContext.Provider>
  );
}
