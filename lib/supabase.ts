import 'react-native-url-polyfill/auto';
import { supabase } from './supabaseClient';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[Supabase] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
}

export { supabase };

/**
 * Helper to get the current session safely.
 * Use this instead of direct supabase.auth.getSession() where possible
 * to ensure consistency across the app.
 */
export const getSession = async () => {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  } catch (err) {
    console.error('[Supabase] Error getting session:', err);
    return null;
  }
};

export type Venue = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  description: string;
  image_url: string;
  created_at: string;
};

export type VipReservado = {
  id: string;
  event_id: string;
  name: string;
  description: string;
  base_price: number;
  capacity_people: number;
  included_bottles: number;
  extra_bottle_price: number | null;
  quantity_available: number;
  created_at: string;
};

export type Event = {
  end_datetime?: string | null;
  id: string;
  venue_id: string;
  creator_id?: string;
  title: string;
  description: string;
  poster_url: string;
  event_date: string;
  ticket_price: number;
  available_tickets: number;
  sold_tickets: number;
  dress_code: string;
  age_restriction: number;
  theme: string;
  event_type: string;
  venue_plan_url?: string;
  created_at: string;
  venues?: Venue;
  profiles?:
    | {
        id?: string;
        full_name?: string | null;
        club_name?: string | null;
        verification_status?: 'pending_verification' | 'verified' | 'rejected' | null;
      }
    | {
        id?: string;
        full_name?: string | null;
        club_name?: string | null;
        verification_status?: 'pending_verification' | 'verified' | 'rejected' | null;
      }[];
  event_ticket_types?: {
    id: string;
    name: string;
    price: number;
    quantity: number;
    sold: number;
    category?: string | null;
    metadata?: Record<string, any> | null;
  }[];
  reservados_vip?: VipReservado[];
};

export type Ticket = {
  product_snapshot?: { kind: string; category: string; name: string; metadata: Record<string, any> };
  ticket_type?: string | null;
  entry_deadline?: string | null;
  id: string;
  event_id: string;
  user_id: string | null;
  buyer_name: string;
  buyer_email: string;
  quantity: number;
  total_price: number;
  purchase_date: string;
  qr_code: string;
  qr_token?: string; // New Secure Token
  wallet_added?: boolean;
  wallet_pass_id?: string | null;
  ticket_type_id?: string | null;
  ticket_status?: string | null;
  validation_status?: 'valid' | 'used' | 'expired' | 'revoked';
  scanned_at?: string;
  status?: string; // 'valid', 'resale', 'used', 'cancelled'
  events?: Event;
};
