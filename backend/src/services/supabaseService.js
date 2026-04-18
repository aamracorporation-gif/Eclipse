const { createClient } = require('@supabase/supabase-js');
const { env } = require('../config/env');

const adminKey = env.supabaseServiceRoleKey || env.supabaseAnonKey;

const supabaseAdmin = createClient(env.supabaseUrl, adminKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const supabaseAnon = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

module.exports = { supabaseAdmin, supabaseAnon };
