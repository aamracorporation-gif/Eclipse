import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { ArrowLeft, Search, Ticket, RefreshCw, XCircle, Trash2, CheckCircle, User as UserIcon } from '@/lib/icons';
import { GlassView } from '@/components/ui/GlassView';
import { supabase } from '@/lib/supabase';
import { useCallback, useEffect, useState } from 'react';

// ticket_status values: 'active' | 'used' | 'reselling' | 'sold' | 'invalidated'
type TicketRow = {
  id: string;
  buyer_name: string;
  buyer_email: string;
  quantity: number;
  total_price: number;
  purchase_date: string;
  ticket_status: string | null;
  status: string | null;
  scanned_at: string | null;
  event_id: string;
  event_title?: string | null;
  ticket_type_name?: string | null;
};

export default function AdminTicketsScreen() {
  const router = useRouter();

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchTickets = useCallback(async (search = '') => {
    setLoading(true);
    try {
      let q = supabase
        .from('tickets')
        .select('id, buyer_name, buyer_email, quantity, total_price, purchase_date, ticket_status, status, scanned_at, event_id, ticket_type_id')
        .order('purchase_date', { ascending: false })
        .limit(300);

      if (search.trim()) {
        q = q.or(`buyer_name.ilike.%${search.trim()}%,buyer_email.ilike.%${search.trim()}%`);
      }

      const { data, error } = await q;
      if (error) throw error;

      const rows = (data || []) as any[];

      // Fetch event titles and ticket type names in parallel
      const eventIds = [...new Set(rows.map((r) => r.event_id).filter(Boolean))];
      const ticketTypeIds = [...new Set(rows.map((r) => r.ticket_type_id).filter(Boolean))];

      const [eventsRes, typesRes] = await Promise.all([
        eventIds.length > 0
          ? supabase.from('events').select('id, title').in('id', eventIds)
          : Promise.resolve({ data: [], error: null }),
        ticketTypeIds.length > 0
          ? supabase.from('event_ticket_types').select('id, name').in('id', ticketTypeIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const eventMap: Record<string, string> = {};
      for (const ev of eventsRes.data || []) {
        eventMap[(ev as any).id] = (ev as any).title;
      }
      const typeMap: Record<string, string> = {};
      for (const tt of typesRes.data || []) {
        typeMap[(tt as any).id] = (tt as any).name;
      }

      setTickets(rows.map((r) => ({
        id: r.id,
        buyer_name: r.buyer_name,
        buyer_email: r.buyer_email,
        quantity: r.quantity,
        total_price: r.total_price,
        purchase_date: r.purchase_date,
        ticket_status: r.ticket_status ?? r.status ?? 'active',
        status: r.status,
        scanned_at: r.scanned_at,
        event_id: r.event_id,
        event_title: eventMap[r.event_id] ?? null,
        ticket_type_name: r.ticket_type_id ? (typeMap[r.ticket_type_id] ?? null) : null,
      })));
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar las entradas');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);

  const isActive = (t: TicketRow) =>
    (t.ticket_status === 'active' || t.ticket_status === null) && t.status !== 'cancelled';

  const handleInvalidate = (ticket: TicketRow) => {
    const active = isActive(ticket);
    Alert.alert(
      active ? 'Invalidar entrada' : 'Reactivar entrada',
      `¿${active ? 'Invalidar' : 'Reactivar'} la entrada de ${ticket.buyer_name || ticket.buyer_email}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: active ? 'Invalidar' : 'Reactivar',
          style: active ? 'destructive' : 'default',
          onPress: async () => {
            setActionLoading(ticket.id);
            try {
              const newStatus = active ? 'invalidated' : 'active';
              const { error } = await supabase
                .from('tickets')
                .update({ ticket_status: newStatus, status: active ? 'cancelled' : 'active' })
                .eq('id', ticket.id);
              if (error) throw error;
              setTickets((prev) =>
                prev.map((t) =>
                  t.id === ticket.id
                    ? { ...t, ticket_status: newStatus, status: active ? 'cancelled' : 'active' }
                    : t
                )
              );
            } catch (e: any) {
              Alert.alert('Error', e?.message);
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const handleDelete = (ticket: TicketRow) => {
    Alert.alert(
      'Eliminar entrada',
      `¿Eliminar permanentemente la entrada de ${ticket.buyer_name || ticket.buyer_email}? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(ticket.id);
            try {
              const { error } = await supabase.from('tickets').delete().eq('id', ticket.id);
              if (error) throw error;
              setTickets((prev) => prev.filter((t) => t.id !== ticket.id));
            } catch (e: any) {
              Alert.alert('Error', e?.message);
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const getStatusLabel = (t: TicketRow) => {
    const s = t.ticket_status ?? t.status ?? 'active';
    switch (s) {
      case 'used': return { label: 'Usada', color: '#f59e0b' };
      case 'invalidated': return { label: 'Inválida', color: '#ef4444' };
      case 'reselling': return { label: 'En reventa', color: '#60a5fa' };
      case 'sold': return { label: 'Vendida', color: '#a78bfa' };
      case 'cancelled': return { label: 'Cancelada', color: '#ef4444' };
      default: return { label: 'Activa', color: '#22c55e' };
    }
  };

  const renderTicket = ({ item }: { item: TicketRow }) => {
    const isActioning = actionLoading === item.id;
    const active = isActive(item);
    const { label: statusLabel, color: statusColor } = getStatusLabel(item);

    return (
      <GlassView intensity={18} style={styles.card}>
        {/* Top row: status + actions */}
        <View style={styles.cardTop}>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
            {item.scanned_at && (
              <Text style={[styles.statusText, { color: statusColor, opacity: 0.7 }]}> · Escaneada</Text>
            )}
          </View>
          <View style={styles.cardActions}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: active ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)' }]}
              onPress={() => handleInvalidate(item)}
              disabled={isActioning}
              activeOpacity={0.7}
            >
              {isActioning
                ? <ActivityIndicator size="small" color={active ? '#ef4444' : '#22c55e'} />
                : active
                  ? <XCircle size={16} color="#ef4444" />
                  : <CheckCircle size={16} color="#22c55e" />
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: 'rgba(239,68,68,0.12)' }]}
              onPress={() => handleDelete(item)}
              disabled={isActioning}
              activeOpacity={0.7}
            >
              <Trash2 size={16} color="#ef4444" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Buyer */}
        <View style={styles.buyerRow}>
          <View style={styles.avatar}>
            <UserIcon size={14} color="#a78bfa" />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            {item.buyer_name ? <Text style={styles.buyerName} numberOfLines={1}>{item.buyer_name}</Text> : null}
            {item.buyer_email ? <Text style={styles.buyerEmail} numberOfLines={1}>{item.buyer_email}</Text> : null}
          </View>
        </View>

        {/* Event */}
        {item.event_title ? (
          <Text style={styles.eventName} numberOfLines={1}>📅 {item.event_title}</Text>
        ) : null}

        {/* Details */}
        <View style={styles.detailsRow}>
          <View style={styles.detailChip}>
            <Ticket size={11} color="rgba(255,255,255,0.4)" />
            <Text style={styles.detailText}>
              {item.quantity} {item.quantity !== 1 ? 'entradas' : 'entrada'}
              {item.ticket_type_name ? ` · ${item.ticket_type_name}` : ''}
            </Text>
          </View>
          <Text style={styles.priceText}>{Number(item.total_price).toFixed(2)} €</Text>
        </View>

        <Text style={styles.dateText}>
          {new Date(item.purchase_date).toLocaleDateString('es-ES', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
        </Text>
      </GlassView>
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['rgba(244,63,94,0.12)', 'transparent']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.35 }}
        pointerEvents="none"
      />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={22} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Gestionar tickets</Text>
            <Text style={styles.subtitle}>{tickets.length} entradas cargadas</Text>
          </View>
          <TouchableOpacity onPress={() => fetchTickets(query)} style={styles.refreshBtn} activeOpacity={0.7}>
            <RefreshCw size={18} color="rgba(255,255,255,0.5)" />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={styles.searchRow}>
          <Search size={16} color="rgba(255,255,255,0.35)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar por nombre o email..."
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => fetchTickets(query)}
            returnKeyType="search"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(''); fetchTickets(''); }} activeOpacity={0.7}>
              <XCircle size={16} color="rgba(255,255,255,0.35)" />
            </TouchableOpacity>
          )}
        </View>

        {/* Legend */}
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <XCircle size={13} color="#ef4444" />
            <Text style={styles.legendText}>Invalidar</Text>
          </View>
          <View style={styles.legendItem}>
            <CheckCircle size={13} color="#22c55e" />
            <Text style={styles.legendText}>Reactivar</Text>
          </View>
          <View style={styles.legendItem}>
            <Trash2 size={13} color="#ef4444" />
            <Text style={styles.legendText}>Eliminar</Text>
          </View>
        </View>

        {loading ? (
          <ActivityIndicator color="#f472b6" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={tickets}
            keyExtractor={(item) => item.id}
            renderItem={renderTicket}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ticket size={40} color="rgba(255,255,255,0.12)" />
                <Text style={styles.emptyText}>No se encontraron entradas</Text>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 12,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { color: 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '500', marginTop: 1 },
  refreshBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '500' },
  legendRow: { flexDirection: 'row', gap: 16, paddingHorizontal: 16, marginBottom: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  card: { borderRadius: 16, padding: 14, marginBottom: 10, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 4,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: '700' },
  cardActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  buyerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(124,58,237,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  buyerName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  buyerEmail: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  eventName: { color: 'rgba(167,139,250,0.8)', fontSize: 12, fontWeight: '600' },
  detailsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  detailChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  detailText: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  priceText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  dateText: { color: 'rgba(255,255,255,0.3)', fontSize: 11 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { color: 'rgba(255,255,255,0.3)', fontSize: 15, fontWeight: '600' },
});
