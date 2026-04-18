import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthContext';
import { invokeEdgeFunction } from '@/lib/edgeFunctions';

type Transaction = {
  id: string;
  amount: number;
  type: 'credit' | 'debit';
  description: string;
  created_at: string;
};

type WalletContextType = {
  balance: number;
  transactions: Transaction[];
  loading: boolean;
  refreshWallet: () => Promise<void>;
  createResaleListing: (ticketId: string, price: number) => Promise<void>;
  cancelResaleListing: (ticketId: string) => Promise<void>;
  buyResaleTicket: (listingId: string, price: number) => Promise<void>;
  buyTicketWithWallet: (params: any) => Promise<void>;
  buyVipWithWallet: (params: { p_vip_reservado_id: string; p_buyer_name: string; p_buyer_email: string }) => Promise<any>;
  addFunds: (amount: number) => Promise<void>;
};

const WalletContext = createContext<WalletContextType>({
  balance: 0,
  transactions: [],
  loading: true,
  refreshWallet: async () => {},
  createResaleListing: async () => {},
  cancelResaleListing: async () => {},
  buyResaleTicket: async () => {},
  buyTicketWithWallet: async () => {},
  buyVipWithWallet: async () => {},
  addFunds: async () => {},
});

export const useWallet = () => useContext(WalletContext);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [walletId, setWalletId] = useState<string | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (user) {
      refreshWallet();
    } else {
      setWalletId(null);
      setBalance(0);
      setTransactions([]);
      setLoading(false);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    }
  }, [user]);

  const refreshWallet = useCallback(async () => {
    if (!user) return;
    try {
      // 1. Get Wallet
      let { data: wallet, error } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!wallet && !error) {
        // Create wallet if not exists
        const { data: newWallet, error: createError } = await supabase.rpc('ensure_wallet_exists', { p_user_id: user.id });
        if (createError) throw createError;
        // Fetch again or use default
        wallet = { balance: 0, id: newWallet.wallet_id };
      }

      if (wallet) {
        setWalletId((wallet as any).id ?? null);
        const rawBalance = (wallet as any).balance;
        const parsedBalance = typeof rawBalance === 'string' ? Number(rawBalance) : rawBalance;
        setBalance(typeof parsedBalance === 'number' && Number.isFinite(parsedBalance) ? parsedBalance : 0);
        
        // 2. Get Transactions
        const { data: txs } = await supabase
          .from('wallet_transactions')
          .select('*')
          .eq('wallet_id', wallet.id)
          .order('created_at', { ascending: false });
          
        setTransactions(
          (txs || []).map((t: any) => {
            const rawAmount = t?.amount;
            const parsedAmount = typeof rawAmount === 'string' ? Number(rawAmount) : rawAmount;
            return {
              ...t,
              amount: typeof parsedAmount === 'number' && Number.isFinite(parsedAmount) ? parsedAmount : 0,
            };
          })
        );
      }
    } catch (error) {
      console.error('Error fetching wallet:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  const scheduleRefresh = useCallback(() => {
    if (!user) return;
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => {
      refreshWallet();
    }, 250);
  }, [refreshWallet, user]);

  useEffect(() => {
    if (!user || !walletId) return;

    const channel = supabase
      .channel(`wallet_${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallets', filter: `user_id=eq.${user.id}` },
        () => scheduleRefresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallet_transactions', filter: `wallet_id=eq.${walletId}` },
        () => scheduleRefresh()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [scheduleRefresh, user, walletId]);

  const createResaleListing = async (ticketId: string, price: number) => {
    if (!user) throw new Error('Usuario no autenticado');

    try {
      const { data: ticket, error: ticketError } = await supabase
        .from('tickets')
        .select('status, scanned_at, validation_status, total_price')
        .eq('id', ticketId)
        .eq('user_id', user.id)
        .single();

      if (ticketError || !ticket) {
        throw new Error('No se encontró la entrada o no te pertenece.');
      }

      if (ticket.status === 'used' || ticket.scanned_at || ticket.validation_status === 'used') {
        throw new Error('No se puede revender una entrada que ya ha sido utilizada.');
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

      // Update local wallet state optimistically or silently in background
      refreshWallet().catch(console.error);
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

      await refreshWallet();
    } catch (error) {
      console.error('Error canceling resale listing:', error);
      throw error;
    }
  };

  const buyResaleTicket = async (listingId: string, price: number) => {
    if (!user) throw new Error('User not logged in');
    
    // Check local balance check (optimization)
    if (balance < price) {
      throw new Error('Insufficient funds');
    }

    try {
      const { data, error } = await supabase.rpc('buy_resale_ticket', {
        p_buyer_id: user.id,
        p_listing_id: listingId
      });

      if (error) throw error;
      
      await refreshWallet();
      try {
        await invokeEdgeFunction('send-push', { limit: 25 });
      } catch {}
    } catch (error) {
      console.error('Error buying resale ticket:', error);
      throw error;
    }
  };

  const buyTicketWithWallet = async (params: any) => {
    if (!user) throw new Error('User not logged in');
    
    if (balance < params.p_total_price) {
      throw new Error('Saldo insuficiente en la cartera');
    }

    try {
      const { data, error } = await supabase.rpc('buy_ticket_with_wallet', {
        ...params,
        p_user_id: user.id
      });

      if (error) throw error;
      
      await refreshWallet();
      scheduleRefresh();

      try {
        await invokeEdgeFunction('send-push', { limit: 25 });
      } catch {}
      return data;
    } catch (error) {
      console.error('Error buying ticket with wallet:', error);
      throw error;
    }
  };

  const buyVipWithWallet = async (params: { p_vip_reservado_id: string; p_buyer_name: string; p_buyer_email: string }) => {
    if (!user) throw new Error('User not logged in');

    try {
      const { data, error } = await supabase.rpc('buy_vip_with_wallet', {
        ...params,
        p_user_id: user.id,
      });

      if (error) throw error;

      await refreshWallet();
      scheduleRefresh();
      try {
        await invokeEdgeFunction('send-push', { limit: 25 });
      } catch {}
      return data;
    } catch (error) {
      console.error('Error buying VIP with wallet:', error);
      throw error;
    }
  };

  const addFunds = async (amount: number) => {
    throw new Error('La recarga de cartera no está disponible.');
  };

  return (
    <WalletContext.Provider value={{ balance, transactions, loading, refreshWallet, createResaleListing, cancelResaleListing, buyResaleTicket, buyTicketWithWallet, buyVipWithWallet, addFunds }}>
      {children}
    </WalletContext.Provider>
  );
}
