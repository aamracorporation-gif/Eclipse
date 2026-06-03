import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

type SupabaseClientType = ReturnType<typeof createClient>;

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

function createNotConfiguredError() {
  return new Error('Falta configurar EXPO_PUBLIC_SUPABASE_URL y/o EXPO_PUBLIC_SUPABASE_ANON_KEY.');
}

function createStubThenable() {
  const error = createNotConfiguredError();
  const result = { data: null, error };

  const promise = Promise.resolve(result);

  const builder: any = {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
  };

  const chain = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'gt',
    'gte',
    'lt',
    'lte',
    'like',
    'ilike',
    'is',
    'order',
    'limit',
    'range',
    'or',
    'filter',
    'match',
    'contains',
    'containedBy',
    'overlaps',
    'textSearch',
    'throwOnError',
    'returns',
  ];
  for (const k of chain) builder[k] = () => builder;

  builder.single = async () => result;
  builder.maybeSingle = async () => result;

  return builder;
}

function createSupabaseStub() {
  const error = createNotConfiguredError();
  let didLog = false;
  const logOnce = () => {
    if (didLog) return;
    didLog = true;
    try {
      console.error('[Supabase]', error.message);
    } catch {}
  };

  const stub: any = {
    from: () => {
      logOnce();
      return createStubThenable();
    },
    rpc: () => {
      logOnce();
      return createStubThenable();
    },
    functions: {
      invoke: async () => {
        logOnce();
        return { data: null, error };
      },
    },
    storage: {
      from: () => ({
        upload: async () => {
          logOnce();
          return { data: null, error };
        },
        download: async () => {
          logOnce();
          return { data: null, error };
        },
        remove: async () => {
          logOnce();
          return { data: null, error };
        },
        getPublicUrl: () => {
          logOnce();
          return { data: { publicUrl: '' } };
        },
      }),
    },
    channel: () => {
      logOnce();
      return {
        on: () => stub.channel(),
        subscribe: () => ({ unsubscribe: () => {} }),
      };
    },
    removeChannel: () => {
      logOnce();
      return true;
    },
    auth: {
      getSession: async () => {
        logOnce();
        return { data: { session: null }, error };
      },
      onAuthStateChange: () => {
        logOnce();
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signInWithPassword: async () => {
        logOnce();
        return { data: null, error };
      },
      signUp: async () => {
        logOnce();
        return { data: null, error };
      },
      signOut: async () => {
        logOnce();
        return { error };
      },
      resetPasswordForEmail: async () => {
        logOnce();
        return { data: null, error };
      },
      refreshSession: async () => {
        logOnce();
        return { data: null, error };
      },
      setSession: async () => {
        logOnce();
        return { data: null, error };
      },
      getUser: async () => {
        logOnce();
        return { data: { user: null }, error };
      },
    },
  };

  return stub;
}

export const supabase =
  SUPABASE_URL.trim() && SUPABASE_ANON_KEY.trim()
    ? createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim(), {
        auth: {
          storage: AsyncStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      })
    : (createSupabaseStub() as unknown as SupabaseClientType);

