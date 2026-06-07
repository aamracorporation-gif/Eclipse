import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthContext';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';

type LedgerMovimiento = {
  id: string;
  tipo: string;
  importe: number;
  referencia_id?: string | null;
  descripcion?: string | null;
  created_at: string;
};

type CreditContextType = {
  creditBalance: number;
  movimientos: LedgerMovimiento[];
  loading: boolean;
  refreshCredit: () => Promise<void>;
  createResaleListing: (ticketId: string, price: number) => Promise<void>;
  cancelResaleListing: (ticketId: string) => Promise<void>;
  buyResaleTicketWithCredit: (listingId: string) => Promise<void>;
  buyTicketWithCredit: (params: any) => Promise<void>;
  buyVipWithCredit: (params: { p_vip_reservado_id: string; p_buyer_name: string; p_buyer_email: string }) => Promise<any>;
};

const CreditContext = createContext<CreditContextType>({
  creditBalance: 0,
  movimientos: [],
  loading: true,
  refreshCredit: async () => {},
  createResaleListing: async () => {},
  cancelResaleListing: async () => {},
  buyResaleTicketWithCredit: async () => {},
  buyTicketWithCredit: async () => {},
  buyVipWithCredit: async () => {},
});

export const useCredit = () => useContext(CreditContext);

export function CreditProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [creditBalance, setCreditBalance] = useState(0);
  const [movimientos, setMovimientos] = useState<LedgerMovimiento[]>([]);
  const [loading, setLoading] = useState(true);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (user) {
      refreshCredit();
    } else {
      setCreditBalance(0);
      setMovimientos([]);
      setLoading(false);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    }
  }, [user]);

  const refreshCredit = useCallback(async () => {
    if (!user) return;
    try {
      let { data: credito, error: creditoError } = await supabase
        .from('creditos_usuario')
        .select('id, usuario_id, saldo_credito')
        .eq('usuario_id', user.id)
        .maybeSingle();

      if (!credito && !creditoError) {
        const insertRes = await supabase.from('creditos_usuario').insert({ usuario_id: user.id, saldo_credito: 0 }).select('id, usuario_id, saldo_credito').maybeSingle();
        credito = insertRes.data as any;
      }

      const rawSaldo = (credito as any)?.saldo_credito;
      const parsedSaldo = typeof rawSaldo === 'string' ? Number(rawSaldo) : rawSaldo;
      setCreditBalance(typeof parsedSaldo === 'number' && Number.isFinite(parsedSaldo) ? parsedSaldo : 0);

      const { data: rows } = await supabase
        .from('ledger_movimientos')
        .select('id, tipo, importe, referencia_id, descripcion, created_at')
        .eq('usuario_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100);

      setMovimientos(
        (rows || []).map((m: any) => {
          const rawImporte = m?.importe;
          const parsedImporte = typeof rawImporte === 'string' ? Number(rawImporte) : rawImporte;
          return {
            ...m,
            importe: typeof parsedImporte === 'number' && Number.isFinite(parsedImporte) ? parsedImporte : 0,
          };
        })
      );
    } catch (error) {
      console.error('Error fetching credit:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const scheduleRefresh = useCallback(() => {
    if (!user) return;
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => {
      refreshCredit();
    }, 250);
  }, [refreshCredit, user]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`credito_${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'creditos_usuario', filter: `usuario_id=eq.${user.id}` },
        () => scheduleRefresh()
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ledger_movimientos', filter: `usuario_id=eq.${user.id}` }, () => scheduleRefresh())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [scheduleRefresh, user]);

  const createResaleListing = async (ticketId: string, price: number) => {
    if (!user) throw new Error('Usuario no autenticado');

    try {
      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .select(
          `
          status,
          scanned_at,
          validation_status,
          total_price,
          events ( allow_resale )
          `
        )
        .eq('id', ticketId)
        .eq('user_id', user.id)
        .single();

      if (ticketError || !ticket) {
        throw new Error('No se encontró la entrada o no te pertenece.');
      }

      if (ticket.status === 'used' || ticket.scanned_at || ticket.validation_status === 'used') {
        throw new Error('No se puede revender una entrada que ya ha sido utilizada.');
      }

      const allowResaleForEvent = (ticket as any)?.events?.allow_resale ?? true;
      if (!allowResaleForEvent) {
        throw new Error('La reventa está desactivada para este evento.');
      }

      const original = typeof ticket.total_price === 'string' ? Number(ticket.total_price) : ticket.total_price;
      if (typeof original === 'number' && Number.isFinite(original) && original > 0) {
        const minPrice = original;
        const maxPrice = original * 1.2;

        if (price < minPrice) {
          throw new Error('El precio de reventa debe ser como mínimo el 100% del precio original.');
        }

        if (price > maxPrice) {
          throw new Error('El precio de reventa no puede superar el 120% del precio original.');
        }
      }

      const { error } = await supabase.rpc('create_resale_listing_secure', {
        p_ticket_id: ticketId,
        p_price: price,
      });

      if (error) throw error;

      refreshCredit().catch(console.error);
    } catch (error: any) {
      console.error('Error creating resale listing:', error);
      throw error;
    }
  };

  const cancelResaleListing = async (ticketId: string) => {
    if (!user) throw new Error('Usuario no autenticado');

    try {
      const { error } = await supabase.rpc('cancel_resale_listing_secure', { p_ticket_id: ticketId });
      if (error) {
        const { error: directError } = await supabase
          .from('resale_listings')
          .delete()
          .eq('ticket_id', ticketId)
          .eq('seller_id', user.id)
          .eq('status', 'active');

        if (directError) throw error;

        const { error: ticketUpdateError } = await supabase
          .from('tickets')
          .update({ status: 'valid', ticket_status: 'active' })
          .eq('id', ticketId)
          .eq('user_id', user.id);

        if (ticketUpdateError) throw ticketUpdateError;
      }

      await refreshCredit();
    } catch (error) {
      console.error('Error canceling resale listing:', error);
      throw error;
    }
  };

  const buyResaleTicketWithCredit = async (listingId: string) => {
    if (!user) throw new Error('Usuario no autenticado');

    try {
      const { error } = await supabase.rpc('buy_resale_ticket_with_credito', {
        p_listing_id: listingId,
        p_buyer_id: user.id,
      });

      if (error) throw error;

      await refreshCredit();
      scheduleRefresh();
      try {
        await invokeEdgeFunction('send-push', { limit: 25 });
      } catch {}
    } catch (error) {
      console.error('Error buying resale ticket with credit:', error);
      throw error;
    }
  };

  const buyTicketWithCredit = async (params: any) => {
    if (!user) throw new Error('User not logged in');

    try {
      const { data, error } = await supabase.rpc('buy_ticket_with_credito', {
        ...params,
        p_user_id: user.id
      });

      if (error) throw error;
      
      await refreshCredit();
      scheduleRefresh();

      try {
        await invokeEdgeFunction('send-push', { limit: 25 });
      } catch {}
      return data;
    } catch (error) {
      console.error('Error buying ticket with credit:', error);
      throw error;
    }
  };

  const buyVipWithCredit = async (params: { p_vip_reservado_id: string; p_buyer_name: string; p_buyer_email: string }) => {
    if (!user) throw new Error('User not logged in');

    try {
      const { data, error } = await supabase.rpc('buy_vip_with_credito', {
        p_vip_reservado_id: params.p_vip_reservado_id,
        p_user_id: user.id,
        p_buyer_name: params.p_buyer_name,
        p_buyer_email: params.p_buyer_email,
      });

      if (error) throw error;

      await refreshCredit();
      scheduleRefresh();
      try {
        await invokeEdgeFunction('send-push', { limit: 25 });
      } catch {}
      return data;
    } catch (error) {
      console.error('Error buying VIP with credit:', error);
      throw error;
    }
  };

  return (
    <CreditContext.Provider value={{ creditBalance, movimientos, loading, refreshCredit, createResaleListing, cancelResaleListing, buyResaleTicketWithCredit, buyTicketWithCredit, buyVipWithCredit }}>
      {children}
    </CreditContext.Provider>
  );
}
