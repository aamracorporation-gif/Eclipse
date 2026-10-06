import { DiscountScopePicker } from '@/components/DiscountScopePicker';
import { discountScopeLabel, type DiscountScope } from '@/supabase/functions/_shared/discountPolicy';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, Switch,
  ScrollView, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Plus, Trash2, Tag, RefreshCw, X, ChevronDown, ChevronUp, Users, Calendar } from '@/lib/icons';
import { GlassView } from '@/components/ui/GlassView';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/AuthContext';
import { useCallback, useEffect, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';

type DiscountCode = {
  applicability?: DiscountScope;
  ticket_type_ids?: string[];
  vip_reservado_ids?: string[];
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
};

type CodeUse = {
  id: string;
  buyer_name: string | null;
  buyer_email: string | null;
  applied_at: string;
};

export default function EventDiscountsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ event_id: string; event_title?: string }>();
  const event_id = params.event_id;
  const event_title = params.event_title ? decodeURIComponent(String(params.event_title)) : '';
  const { user } = useAuth();

  const [codes, setCodes] = useState<DiscountCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scope, setScope] = useState<DiscountScope>('tickets');
  const [ticketIds, setTicketIds] = useState<string[]>([]);
  const [vipIds, setVipIds] = useState<string[]>([]);
  const [scopeReady, setScopeReady] = useState(true);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [uses, setUses] = useState<Record<string, CodeUse[]>>({});
  const [loadingUses, setLoadingUses] = useState<string | null>(null);

  const [formCode, setFormCode] = useState('');
  const [formType, setFormType] = useState<'percentage' | 'fixed'>('percentage');
  const [formValue, setFormValue] = useState('');
  const [formMaxUses, setFormMaxUses] = useState('');
  const [formMinTickets, setFormMinTickets] = useState('1');
  const [formValidUntil, setFormValidUntil] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [tempDate, setTempDate] = useState<Date>(new Date());

  const fetchCodes = useCallback(async () => {
    if (!event_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('discount_codes')
        .select('*')
        .eq('event_id', event_id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setCodes((data || []) as DiscountCode[]);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'No se pudieron cargar los códigos');
    } finally {
      setLoading(false);
    }
  }, [event_id]);

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

  const resetForm = () => {
    setFormCode(''); setFormType('percentage'); setFormValue('');
    setFormMaxUses(''); setFormMinTickets('1'); setFormValidUntil(null);
    setTempDate(new Date());
    setEditingId(null); setScope('tickets'); setTicketIds([]); setVipIds([]); setScopeReady(true);
  };

  const editCode = (item: DiscountCode) => {
    setEditingId(item.id); setFormCode(item.code); setFormType(item.discount_type);
    setFormValue(String(item.discount_value)); setFormMaxUses(item.max_uses == null ? '' : String(item.max_uses));
    setFormMinTickets(String(item.min_tickets)); setFormValidUntil(item.valid_until ? new Date(item.valid_until) : null);
    setScope(item.applicability ?? 'tickets'); setTicketIds(item.ticket_type_ids ?? []); setVipIds(item.vip_reservado_ids ?? []);
    setScopeReady(item.applicability !== 'selected'); setShowForm(true);
  };

  const handleSave = async () => {
    if (saving || !user || !event_id) return;
    if (!scopeReady || (scope === 'selected' && !ticketIds.length && !vipIds.length)) {
      Alert.alert('Selecciona productos', 'Escoge al menos una entrada o mesa VIP válida.'); return;
    }
    if (!/^\d+$/.test(formMinTickets.trim()) || Number(formMinTickets) < 1 || Number(formMinTickets) > 20) {
      Alert.alert('Cantidad no válida', 'El mínimo debe ser un número entero entre 1 y 20.'); return;
    }
    if (formMaxUses.trim() && (!/^\d+$/.test(formMaxUses.trim()) || !Number.isSafeInteger(Number(formMaxUses)) || Number(formMaxUses) < 1 || Number(formMaxUses) > 2147483647)) {
      Alert.alert('Límite no válido', 'Los usos máximos deben ser un número entero positivo.'); return;
    }
    if (scope === 'vip_tables' && Number(formMinTickets) !== 1) {
      Alert.alert('Mínimo para mesas VIP', 'Se compra una mesa por operación, independientemente de las personas. Usa un mínimo de 1.'); return;
    }
    const code = formCode.trim().toUpperCase();
    if (!code) { Alert.alert('Error', 'Introduce un código'); return; }
    const val = Number(formValue.trim().replace(',', '.'));
    if (!Number.isFinite(val) || val <= 0) { Alert.alert('Error', 'Introduce un descuento válido'); return; }
    if (formType === 'percentage' && val > 100) { Alert.alert('Error', 'El porcentaje no puede superar el 100%'); return; }

    setSaving(true);
    try {
      const payload = {
        event_id,
        code,
        discount_type: formType,
        discount_value: val,
        max_uses: formMaxUses.trim() ? parseInt(formMaxUses) : null,
        min_tickets: parseInt(formMinTickets) || 1,
        valid_until: formValidUntil ? formValidUntil.toISOString() : null,
        applicability: scope,
        ticket_type_ids: scope === 'selected' ? ticketIds : [],
        vip_reservado_ids: scope === 'selected' ? vipIds : [],
      };
      const { error } = editingId
        ? await supabase.from('discount_codes').update(payload).eq('id', editingId).eq('event_id', event_id).select('id').single()
        : await supabase.from('discount_codes').insert({ ...payload, creator_id: user.id, is_active: true }).select('id').single();
      if (error) throw error;
      resetForm();
      setShowForm(false);
      fetchCodes();
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('unique') || msg.includes('duplicate')) {
        Alert.alert('Código duplicado', 'Ya existe ese código para este evento.');
      } else {
        Alert.alert('Error', msg || 'No se pudo guardar el código');
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (code: DiscountCode) => {
    try {
      const { error } = await supabase
        .from('discount_codes').update({ is_active: !code.is_active }).eq('id', code.id);
      if (error) throw error;
      setCodes((prev) => prev.map((c) => c.id === code.id ? { ...c, is_active: !c.is_active } : c));
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
            setCodes((prev) => prev.filter((c) => c.id !== code.id));
            if (expandedId === code.id) setExpandedId(null);
          } catch (e: any) { Alert.alert('Error', e?.message); }
        },
      },
    ]);
  };

  const formatDiscount = (c: DiscountCode) =>
    c.discount_type === 'percentage' ? `${c.discount_value}%` : `${c.discount_value.toFixed(2)} €`;

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
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Editar código ${item.code}`} onPress={() => editCode(item)} style={{padding:10}}>
              <Text style={{color:'#C8ADF8',fontSize:12,fontWeight:'700'}}>Editar</Text>
            </TouchableOpacity>
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

        <View style={styles.cardMeta}>
          <View style={styles.metaBadge}>
            <Text style={styles.metaBadgeText}>
              {item.discount_type === 'percentage' ? '% Porcentaje' : '€ Fijo'}
            </Text>
          </View>
          <Text style={styles.discountValue}>{formatDiscount(item)}</Text>
        </View>

        <Text style={{color:'#BDAECF',fontSize:12,marginBottom:10}}>{discountScopeLabel(item)}</Text>
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

  const renderDatePicker = () => {
    if (Platform.OS === 'android') {
      return showDatePicker ? (
        <DateTimePicker
          value={tempDate} mode="date" display="default" minimumDate={new Date()}
          onChange={(_, selected) => { setShowDatePicker(false); if (selected) setFormValidUntil(selected); }}
        />
      ) : null;
    }
    return (
      <Modal visible={showDatePicker} transparent animationType="slide">
        <View style={styles.dateModalOverlay}>
          <View style={styles.dateModalSheet}>
            <View style={styles.dateModalHeader}>
              <TouchableOpacity onPress={() => setShowDatePicker(false)} activeOpacity={0.7}>
                <Text style={styles.dateModalCancel}>Cancelar</Text>
              </TouchableOpacity>
              <Text style={styles.dateModalTitle}>Fecha de expiración</Text>
              <TouchableOpacity
                onPress={() => { setFormValidUntil(tempDate); setShowDatePicker(false); }}
                activeOpacity={0.7}
              >
                <Text style={styles.dateModalConfirm}>Confirmar</Text>
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={tempDate} mode="date" display="spinner" minimumDate={new Date()}
              onChange={(_, selected) => { if (selected) setTempDate(selected); }}
              style={{ height: 200 }} textColor="#fff" locale="es-ES"
            />
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.container}>
        <LinearGradient
          colors={['rgba(124,58,237,0.14)', 'transparent']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 0.4 }}
          pointerEvents="none"
        />
        <SafeAreaView style={styles.safe} edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
              <ArrowLeft size={22} color="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Descuentos</Text>
              {event_title ? (
                <Text style={styles.subtitle} numberOfLines={1}>{event_title}</Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={fetchCodes} style={styles.refreshBtn} activeOpacity={0.7}>
              <RefreshCw size={18} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          </View>

          {showForm ? (
            <ScrollView
              style={styles.formScroll}
              contentContainerStyle={styles.form}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.formHeader}>
                <Text style={styles.formTitle}>{editingId ? 'Editar código' : 'Nuevo código'}</Text>
                <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} activeOpacity={0.7}>
                  <X size={20} color="rgba(255,255,255,0.5)" />
                </TouchableOpacity>
              </View>

              <Text style={styles.fieldLabel}>Código *</Text>
              <TextInput
                style={styles.input}
                placeholder="Ej: VERANO20"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={formCode}
                onChangeText={(t) => setFormCode(t.toUpperCase())}
                autoCapitalize="characters"
                autoCorrect={false}
              />

              <DiscountScopePicker eventId={event_id} scope={scope} ticketIds={ticketIds} vipIds={vipIds}
                disabled={saving} onScope={setScope} onTickets={setTicketIds} onVips={setVipIds} onReady={setScopeReady}/>

              <Text style={styles.fieldLabel}>Tipo de descuento</Text>
              <View style={styles.typeRow}>
                {(['percentage', 'fixed'] as const).map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.typeChip, formType === t && styles.typeChipActive]}
                    onPress={() => setFormType(t)}
                    activeOpacity={0.8}
                  >
                    {formType === t && (
                      <LinearGradient colors={['#7c3aed', '#5b21b6']} style={[StyleSheet.absoluteFill, { borderRadius: 10 }]} />
                    )}
                    <Text style={[styles.typeSymbol, formType === t && { color: '#fff' }]}>
                      {t === 'percentage' ? '%' : '€'}
                    </Text>
                    <Text style={[styles.typeChipText, formType === t && { color: '#fff' }]}>
                      {t === 'percentage' ? 'Porcentaje' : 'Importe fijo'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>
                {formType === 'percentage' ? 'Descuento (%) *' : 'Descuento (€) *'}
              </Text>
              <TextInput
                style={styles.input}
                placeholder={formType === 'percentage' ? 'Ej: 20' : 'Ej: 5.00'}
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={formValue}
                onChangeText={setFormValue}
                keyboardType="decimal-pad"
              />

              <Text style={styles.fieldLabel}>Usos máximos (vacío = ilimitado)</Text>
              <TextInput
                style={styles.input}
                placeholder="Ej: 50"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={formMaxUses}
                onChangeText={setFormMaxUses}
                keyboardType="number-pad"
              />

              <Text style={styles.fieldLabel}>Mínimo de unidades por compra</Text>
              <Text style={{color:'#AA9BB7',fontSize:12,lineHeight:18}}>Una entrada, un pack o una mesa completa cuenta como una unidad. El descuento fijo se resta una vez por compra. No incluye la tasa de servicio.</Text>
              <TextInput
                style={styles.input}
                placeholder="1"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={formMinTickets}
                onChangeText={setFormMinTickets}
                keyboardType="number-pad"
              />

              <Text style={styles.fieldLabel}>Fecha de expiración (opcional)</Text>
              <TouchableOpacity
                style={styles.datePickerBtn}
                onPress={() => { setTempDate(formValidUntil ?? new Date()); setShowDatePicker(true); }}
                activeOpacity={0.8}
              >
                <Calendar size={16} color={formValidUntil ? '#a78bfa' : 'rgba(255,255,255,0.3)'} />
                <Text style={[styles.datePickerText, formValidUntil && { color: '#fff' }]}>
                  {formValidUntil
                    ? formValidUntil.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
                    : 'Sin fecha de expiración'}
                </Text>
                {formValidUntil && (
                  <TouchableOpacity
                    onPress={(e) => { e.stopPropagation(); setFormValidUntil(null); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <X size={14} color="rgba(255,255,255,0.4)" />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>

              {renderDatePicker()}

              <ThemedButton
                title={saving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear código'}
                onPress={handleSave}
                disabled={saving || !scopeReady}
                style={{ marginTop: 8, height: 52, borderRadius: 14 }}
              />
            </ScrollView>
          ) : (
            <>
              <TouchableOpacity style={styles.newBtn} onPress={() => setShowForm(true)} activeOpacity={0.8}>
                <LinearGradient
                  colors={['#7c3aed', '#5b21b6']} style={[StyleSheet.absoluteFill, { borderRadius: 14 }]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                />
                <Plus size={18} color="#fff" />
                <Text style={styles.newBtnText}>Nuevo código de descuento</Text>
              </TouchableOpacity>

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
                      <Text style={styles.emptyText}>No hay códigos para este evento</Text>
                      <Text style={styles.emptyHint}>Crea el primero pulsando el botón de arriba</Text>
                    </View>
                  }
                />
              )}
            </>
          )}
        </SafeAreaView>
      </View>
    </KeyboardAvoidingView>
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
  subtitle: { color: 'rgba(255,255,255,0.45)', fontSize: 12, fontWeight: '500', marginTop: 1 },
  refreshBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  newBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginHorizontal: 16, height: 50, borderRadius: 14,
    overflow: 'hidden', marginBottom: 16,
  },
  newBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
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
  datePickerBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13,
  },
  datePickerText: { flex: 1, color: 'rgba(255,255,255,0.3)', fontSize: 15, fontWeight: '600' },
  dateModalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  dateModalSheet: {
    backgroundColor: '#1a1a2e', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40,
  },
  dateModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  dateModalTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  dateModalCancel: { color: 'rgba(255,255,255,0.45)', fontSize: 15 },
  dateModalConfirm: { color: '#a78bfa', fontSize: 15, fontWeight: '700' },
  formScroll: { flex: 1 },
  form: { paddingHorizontal: 16, paddingBottom: 80, gap: 6 },
  formHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8,
  },
  formTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  fieldLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: '600', marginTop: 8 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    color: '#fff', fontSize: 15, fontWeight: '600',
  },
  typeRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  typeChip: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', overflow: 'hidden',
  },
  typeChipActive: { borderColor: 'transparent' },
  typeSymbol: { color: 'rgba(255,255,255,0.5)', fontSize: 18, fontWeight: '900' },
  typeChipText: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '600' },
});
