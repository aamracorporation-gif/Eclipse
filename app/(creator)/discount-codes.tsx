import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, Switch, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Tag, RefreshCw, ChevronDown, Trash2, Users, ChevronUp } from '@/lib/icons';
import { GlassView } from '@/components/ui/GlassView';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import { useCallback, useEffect, useState } from 'react';

type DiscountCode = {
  id: string;
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  max_uses: number | null;
  uses_count: number;
  min_tickets: number;
  valid_until: string | null;
  is_active: boolean;
  created_at: string;
  event_id: string;
  event_title?: string | null;
};

type CodeUse = {
  id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  applied_at: string;
};

type EventOption = { id: string; title: string };

export default function DiscountCodesScreen() {
  const { user } = useAuth();
  const userId = user?.id;

  const [allCodes, setAllCodes] = useState<DiscountCode[]>([]);
  const [eventOptions, setEventOptions] = useState<EventOption[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [showEventDropdown, setShowEventDropdown] = useState(false);
  const [loading, setLoading] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [uses, setUses] = useState<Record<string, CodeUse[]>>({});
  const [loadingUses, setLoadingUses] = useState<string | null>(null);

  const codes = selectedEventId
    ? allCodes.filter((c) => c.event_id === selectedEventId)
    : allCodes;

  const fetchCodes = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('discount_codes')
        .select('*')
        .eq('creator_id', userId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const rows = (data || []) as DiscountCode[];
      if (rows.length > 0) {
        const eventIds = [...new Set(rows.map((r) => r.event_id).filter(Boolean))];
        const { data: eventsData } = await supabase
          .from('events').select('id, title').in('id', eventIds);
        const eventMap: Record<string, string> = {};
        const opts: EventOption[] = [];
        for (const ev of eventsData || []) {
          eventMap[(ev as any).id] = (ev as any).title;
          opts.push({ id: (ev as any).id, title: (ev as any).title });
        }
        setEventOptions(opts);
        setAllCodes(rows.map((r) => ({ ...r, event_title: eventMap[r.event_id] ?? null })));
      } else {
        setAllCodes([]);
        setEventOptions([]);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar los códigos');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { fetchCodes(); }, [fetchCodes]);

  const fetchUses = async (codeId: string) => {
    if (uses[codeId]) return;
    setLoadingUses(codeId);
    try {
      const { data, error } = await supabase
        .from('discount_code_uses')
        .select('id, buyer_name, buyer_email, applied_at')
        .eq('discount_code_id', codeId)
        .order('applied_at', { ascending: false });
      if (error) throw error;
      setUses((prev) => ({ ...prev, [codeId]: (data || []) as CodeUse[] }));
    } catch {
      setUses((prev) => ({ ...prev, [codeId]: [] }));
    } finally {
      setLoadingUses(null);
    }
  };

  const toggleExpand = (codeId: string) => {
    if (expandedId === codeId) { setExpandedId(null); return; }
    setExpandedId(codeId);
    fetchUses(codeId);
  };

  const toggleActive = async (code: DiscountCode) => {
    try {
      const { error } = await supabase
        .from('discount_codes').update({ is_active: !code.is_active }).eq('id', code.id);
      if (error) throw error;
      setAllCodes((prev) => prev.map((c) => c.id === code.id ? { ...c, is_active: !c.is_active } : c));
    } catch (e: any) { Alert.alert('Error', e?.message); }
  };

  const handleDelete = (code: DiscountCode) => {
    Alert.alert('Eliminar código', `¿Eliminar "${code.code}"?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar', style: 'destructive',
        onPress: async () => {
          try {
            const { error } = await supabase.from('discount_codes').delete().eq('id', code.id);
            if (error) throw error;
            setAllCodes((prev) => prev.filter((c) => c.id !== code.id));
            if (expandedId === code.id) setExpandedId(null);
          } catch (e: any) { Alert.alert('Error', e?.message); }
        },
      },
    ]);
  };

  const formatDiscount = (c: DiscountCode) =>
    c.discount_type === 'percentage' ? `${c.discount_value}%` : `${c.discount_value.toFixed(2)} €`;

  const selectedLabel = selectedEventId
    ? (eventOptions.find((e) => e.id === selectedEventId)?.title ?? 'Evento')
    : 'Todos los eventos';

  const renderUses = (item: DiscountCode) => {
    if (expandedId !== item.id) return null;
    const list = uses[item.id];
    const isLoading = loadingUses === item.id;
    return (
      <View style={styles.usesSection}>
        <View style={styles.usesSectionHeader}>
          <Users size={12} color="rgba(167,139,250,0.7)" />
          <Text style={styles.usesSectionTitle}>Entradas con este código</Text>
        </View>
        {isLoading ? (
          <ActivityIndicator color="#a78bfa" size="small" style={{ marginVertical: 8 }} />
        ) : !list || list.length === 0 ? (
          <Text style={styles.usesEmpty}>Aún no se ha usado este código</Text>
        ) : (
          list.map((u) => (
            <View key={u.id} style={styles.useRow}>
              <View style={styles.useAvatar}>
                <Text style={styles.useAvatarText}>
                  {(u.buyer_name || u.buyer_email || '?')[0].toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                {u.buyer_name ? <Text style={styles.useName} numberOfLines={1}>{u.buyer_name}</Text> : null}
                {u.buyer_email
                  ? <Text style={styles.useEmail} numberOfLines={1}>{u.buyer_email}</Text>
                  : !u.buyer_name ? <Text style={styles.useEmail}>Usuario anónimo</Text> : null}
              </View>
              <Text style={styles.useDate}>
                {new Date(u.applied_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })}
              </Text>
            </View>
          ))
        )}
      </View>
    );
  };

  const renderCode = ({ item }: { item: DiscountCode }) => {
    const isExpanded = expandedId === item.id;
    return (
      <GlassView intensity={18} style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.codeChip}>
            <Tag size={13} color="#a78bfa" />
            <Text style={styles.codeText}>{item.code}</Text>
          </View>
          <View style={styles.cardHeaderRight}>
            <Switch
              value={item.is_active}
              onValueChange={() => toggleActive(item)}
              trackColor={{ false: '#333', true: '#7c3aed' }}
              thumbColor="#fff"
              style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
            />
            <TouchableOpacity onPress={() => handleDelete(item)} style={styles.deleteBtn} activeOpacity={0.7}>
              <Trash2 size={16} color="#ef4444" />
            </TouchableOpacity>
          </View>
        </View>

        {item.event_title && (
          <Text style={styles.cardEventName} numberOfLines={1}>{item.event_title}</Text>
        )}

        <View style={styles.cardMeta}>
          <View style={styles.metaBadge}>
            <Text style={styles.metaBadgeText}>
              {item.discount_type === 'percentage' ? '% Porcentaje' : '€ Fijo'}
            </Text>
          </View>
          <Text style={styles.discountValue}>{formatDiscount(item)}</Text>
        </View>

        <View style={styles.cardStats}>
          <Text style={styles.statText}>
            Usos: <Text style={styles.statVal}>{item.uses_count}{item.max_uses ? `/${item.max_uses}` : ''}</Text>
          </Text>
          {item.min_tickets > 1 && (
            <Text style={styles.statText}>
              Mín.: <Text style={styles.statVal}>{item.min_tickets} entradas</Text>
            </Text>
          )}
          {item.valid_until && (
            <Text style={styles.statText}>
              Expira: <Text style={styles.statVal}>{new Date(item.valid_until).toLocaleDateString('es-ES')}</Text>
            </Text>
          )}
          <View style={[styles.activeBadge, { backgroundColor: item.is_active ? '#22c55e22' : '#ef444422' }]}>
            <View style={[styles.activeDot, { backgroundColor: item.is_active ? '#22c55e' : '#ef4444' }]} />
            <Text style={[styles.activeText, { color: item.is_active ? '#22c55e' : '#ef4444' }]}>
              {item.is_active ? 'Activo' : 'Inactivo'}
            </Text>
          </View>
        </View>

        {item.uses_count > 0 && (
          <TouchableOpacity style={styles.expandBtn} onPress={() => toggleExpand(item.id)} activeOpacity={0.7}>
            <Text style={styles.expandBtnText}>
              {isExpanded ? 'Ocultar entradas' : `Ver ${item.uses_count} entrada${item.uses_count !== 1 ? 's' : ''}`}
            </Text>
            {isExpanded ? <ChevronUp size={14} color="#a78bfa" /> : <ChevronDown size={14} color="#a78bfa" />}
          </TouchableOpacity>
        )}

        {renderUses(item)}
      </GlassView>
    );
  };

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['rgba(124,58,237,0.14)', 'transparent']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.4 }}
        pointerEvents="none"
      />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Descuentos</Text>
            <Text style={styles.subtitle}>Todos tus códigos</Text>
          </View>
          <TouchableOpacity onPress={fetchCodes} style={styles.refreshBtn} activeOpacity={0.7}>
            <RefreshCw size={18} color="rgba(255,255,255,0.5)" />
          </TouchableOpacity>
        </View>

        {/* Event filter — always visible */}
        <TouchableOpacity
          style={styles.filterSelector}
          onPress={() => setShowEventDropdown(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.filterSelectorText} numberOfLines={1}>{selectedLabel}</Text>
          <ChevronDown size={16} color="#a78bfa" />
        </TouchableOpacity>

        <View style={styles.hintRow}>
          <Text style={styles.hintText}>
            {'Para crear códigos, accede a un evento desde "Mis eventos" → %'}
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color="#a78bfa" style={{ marginTop: 40 }} />
        ) : (
          <FlatList
            data={codes}
            keyExtractor={(item) => item.id}
            renderItem={renderCode}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Tag size={40} color="rgba(255,255,255,0.12)" />
                <Text style={styles.emptyText}>
                  {selectedEventId ? 'Sin códigos para este evento' : 'No hay códigos de descuento'}
                </Text>
                <Text style={styles.emptyHint}>{'Crea códigos desde "Mis eventos" → %'}</Text>
              </View>
            }
          />
        )}
      </SafeAreaView>

      {/* Event dropdown modal */}
      <Modal visible={showEventDropdown} transparent animationType="fade">
        <TouchableOpacity
          style={styles.dropdownOverlay}
          activeOpacity={1}
          onPress={() => setShowEventDropdown(false)}
        >
          <View style={styles.dropdownSheet}>
            <Text style={styles.dropdownTitle}>Filtrar por evento</Text>
            <TouchableOpacity
              style={[styles.dropdownOption, !selectedEventId && styles.dropdownOptionActive]}
              onPress={() => { setSelectedEventId(null); setShowEventDropdown(false); }}
              activeOpacity={0.7}
            >
              <Text style={[styles.dropdownOptionText, !selectedEventId && styles.dropdownOptionTextActive]}>
                Todos los eventos
              </Text>
              {!selectedEventId && <View style={styles.dropdownDot} />}
            </TouchableOpacity>
            {eventOptions.map((ev) => (
              <TouchableOpacity
                key={ev.id}
                style={[styles.dropdownOption, selectedEventId === ev.id && styles.dropdownOptionActive]}
                onPress={() => { setSelectedEventId(ev.id); setShowEventDropdown(false); }}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.dropdownOptionText, selectedEventId === ev.id && styles.dropdownOptionTextActive]}
                  numberOfLines={2}
                >
                  {ev.title}
                </Text>
                {selectedEventId === ev.id && <View style={styles.dropdownDot} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
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
  title: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { color: 'rgba(255,255,255,0.35)', fontSize: 12, fontWeight: '500', marginTop: 1 },
  refreshBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  filterSelector: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    backgroundColor: 'rgba(124,58,237,0.12)',
    borderRadius: 12, borderWidth: 1, borderColor: 'rgba(124,58,237,0.3)',
  },
  filterSelectorText: { flex: 1, color: '#c4b5fd', fontSize: 14, fontWeight: '600' },
  hintRow: {
    marginHorizontal: 16, marginBottom: 12, padding: 10,
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10,
  },
  hintText: { color: 'rgba(255,255,255,0.35)', fontSize: 12, textAlign: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 120 },
  card: { borderRadius: 16, padding: 14, marginBottom: 10, gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  codeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(124,58,237,0.18)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(124,58,237,0.3)',
  },
  codeText: { color: '#c4b5fd', fontSize: 15, fontWeight: '800', letterSpacing: 1.5 },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  deleteBtn: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: 'rgba(239,68,68,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  cardEventName: { color: 'rgba(167,139,250,0.7)', fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaBadge: {
    backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
  },
  metaBadgeText: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '600' },
  discountValue: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: -0.5 },
  cardStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  statText: { color: 'rgba(255,255,255,0.45)', fontSize: 12 },
  statVal: { color: 'rgba(255,255,255,0.8)', fontWeight: '700' },
  activeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3 },
  activeText: { fontSize: 11, fontWeight: '700' },
  expandBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: 'rgba(167,139,250,0.1)', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1, borderColor: 'rgba(167,139,250,0.2)',
  },
  expandBtnText: { color: '#a78bfa', fontSize: 12, fontWeight: '600' },
  usesSection: {
    marginTop: 2, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 10, gap: 6,
  },
  usesSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  usesSectionTitle: { color: 'rgba(167,139,250,0.7)', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  usesEmpty: { color: 'rgba(255,255,255,0.3)', fontSize: 12, textAlign: 'center', paddingVertical: 8 },
  useRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 8,
  },
  useAvatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: 'rgba(124,58,237,0.25)', alignItems: 'center', justifyContent: 'center',
  },
  useAvatarText: { color: '#c4b5fd', fontSize: 13, fontWeight: '800' },
  useName: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' },
  useEmail: { color: 'rgba(255,255,255,0.4)', fontSize: 11 },
  useDate: { color: 'rgba(255,255,255,0.3)', fontSize: 11, flexShrink: 0 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyText: { color: 'rgba(255,255,255,0.3)', fontSize: 15, fontWeight: '600' },
  emptyHint: { color: 'rgba(255,255,255,0.2)', fontSize: 13, textAlign: 'center' },
  dropdownOverlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 28,
  },
  dropdownSheet: {
    width: '100%', backgroundColor: '#1a1a2e',
    borderRadius: 20, padding: 8, borderWidth: 1, borderColor: 'rgba(124,58,237,0.25)',
  },
  dropdownTitle: {
    color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: '700',
    letterSpacing: 0.8, textTransform: 'uppercase', paddingHorizontal: 12, paddingVertical: 10,
  },
  dropdownOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 13, borderRadius: 12,
  },
  dropdownOptionActive: { backgroundColor: 'rgba(124,58,237,0.18)' },
  dropdownOptionText: { color: 'rgba(255,255,255,0.65)', fontSize: 14, fontWeight: '500', flex: 1 },
  dropdownOptionTextActive: { color: '#c4b5fd', fontWeight: '700' },
  dropdownDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#a78bfa', marginLeft: 8 },
});
