const { createClient } = require('@supabase/supabase-js');
const { env } = require('../config/env');

class SupabaseConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SupabaseConfigError';
    this.status = 500;
    this.code = 'SUPABASE_NOT_CONFIGURED';
  }
}

let adminClient = null;
let anonClient = null;

function getSupabaseUrl() {
  const url = String(env.supabaseUrl || '').trim();
  if (!url) throw new SupabaseConfigError('Supabase not configured: missing SUPABASE_URL');
  return url;
}

function getSupabaseAnonKey() {
  const key = String(env.supabaseAnonKey || '').trim();
  if (!key) throw new SupabaseConfigError('Supabase not configured: missing SUPABASE_ANON_KEY');
  return key;
}

function getSupabaseAdminKey() {
  const key = String(env.supabaseServiceRoleKey || '').trim() || getSupabaseAnonKey();
  return key;
}

function getSupabaseAdmin() {
  if (adminClient) return adminClient;
  adminClient = createClient(getSupabaseUrl(), getSupabaseAdminKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

function getSupabaseAnon() {
  if (anonClient) return anonClient;
  anonClient = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return anonClient;
}

const adminOverrides = {};
const anonOverrides = {};

const supabaseAdmin = new Proxy(adminOverrides, {
  get(target, prop) {
    if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
    return getSupabaseAdmin()[prop];
  },
  set(target, prop, value) {
    target[prop] = value;
    return true;
  },
});

const supabaseAnon = new Proxy(anonOverrides, {
  get(target, prop) {
    if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
    return getSupabaseAnon()[prop];
  },
  set(target, prop, value) {
    target[prop] = value;
    return true;
  },
});

module.exports = { SupabaseConfigError, getSupabaseAdmin, getSupabaseAnon, supabaseAdmin, supabaseAnon };
