import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Session, User } from '@supabase/supabase-js';
import { registerForPushNotifications } from './notifications';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
    if (user) {
      fetchWorkerProfile(user.id);
      registerForPushNotifications(user.id).catch(() => {});
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
    } catch (e) {
      console.log('Error fetching worker profile:', e);
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
      const { data, error } = await withTimeout(
        supabase.auth.signUp({
          email,
          password,
          options: {
            data: metadata,
            emailRedirectTo: 'eclipse://auth/callback',
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
    await withTimeout(supabase.auth.signOut(), 20000, 'Sign out');
  };

  const resetPassword = async (email: string) => {
    try {
      const { error } = await withTimeout(
        supabase.auth.resetPasswordForEmail(email, {
          redirectTo: 'https://example.com/update-password', // Update with actual deep link if needed
        }),
        20000,
        'Reset password'
      );
      return { error };
    } catch (err: any) {
      return { error: err };
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, workerProfile, signIn, signUp, signOut, resetPassword }}>
      {children}
    </AuthContext.Provider>
  );
}
