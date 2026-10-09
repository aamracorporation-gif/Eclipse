import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  ScrollView, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useState, useRef } from 'react';
import { BlurView } from 'expo-blur';
import { X, Music, Shirt, User, SlidersHorizontal, Euro } from '@/lib/icons';
import { Colors } from '@/constants/Colors';
import { LinearGradient } from 'expo-linear-gradient';

import { EMPTY_FILTERS as EMPTY, type FilterState } from '@/lib/FilterContext';
export type { FilterState } from '@/lib/FilterContext';

interface Props {
  filters: FilterState;
  onFilterChange: (f: FilterState) => void;
}

export default function AdvancedFilters({ filters, onFilterChange }: Props) {
  const [open, setOpen] = useState(false);
  const [temp, setTemp] = useState<FilterState>(filters);
  const [priceText, setPriceText] = useState(filters.maxPrice ? String(filters.maxPrice) : '');
  const priceRef = useRef<TextInput>(null);

  const activeCount = [filters.minAge, filters.dressCode, filters.musicType, filters.maxPrice].filter(Boolean).length;

  const handleOpen = () => {
    setTemp(filters);
    setPriceText(filters.maxPrice ? String(filters.maxPrice) : '');
    setOpen(true);
  };

  const handleApply = () => {
    const parsed = parseFloat(priceText.replace(',', '.'));
    const finalFilters: FilterState = {
      ...temp,
      maxPrice: !isNaN(parsed) && parsed > 0 ? parsed : null,
    };
    onFilterChange(finalFilters);
    setOpen(false);
  };

  const handleClear = () => {
    setTemp(EMPTY);
    setPriceText('');
    onFilterChange(EMPTY);
    setOpen(false);
  };

  // Quick toggles (apply instantly, outside modal)
  const quickMusic = (m: string) => onFilterChange({ ...filters, musicType: filters.musicType === m ? null : m });
  const quickAge   = (a: number) => onFilterChange({ ...filters, minAge:   filters.minAge   === a ? null : a });

  const Chip = ({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={[styles.chip, selected && styles.chipOn]}>
      {selected && (
        <LinearGradient
          colors={['#7C3AED', '#5B21B6']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        />
      )}
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <>
      {/* ── Horizontal quick-filter bar ── */}
      <View style={styles.bar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.barScroll}>
          {/* Filter icon */}
          <TouchableOpacity onPress={handleOpen} activeOpacity={0.8}>
            <View style={styles.iconBtn}>
              {activeCount > 0
                ? <LinearGradient colors={['#7C3AED', '#5B21B6']} style={styles.iconBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                    <SlidersHorizontal size={17} color="white" />
                  </LinearGradient>
                : <View style={styles.iconBtnEmpty}><SlidersHorizontal size={17} color="#A1A1AA" /></View>}
              {activeCount > 0 && (
                <View style={styles.badge}><Text style={styles.badgeText}>{activeCount}</Text></View>
              )}
            </View>
          </TouchableOpacity>

          <View style={styles.sep} />

          {['+18', 'Techno', 'Reggaeton', 'House', 'Comercial'].map(item => {
            const isAge  = item === '+18';
            const sel    = isAge ? filters.minAge === 18 : filters.musicType === item;
            return (
              <TouchableOpacity
                key={item}
                onPress={() => isAge ? quickAge(18) : quickMusic(item)}
                activeOpacity={0.75}
                style={[styles.quickChip, sel && styles.quickChipOn]}
              >
                <Text style={[styles.quickChipText, sel && styles.quickChipTextOn]}>{item}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Modal ── */}
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setOpen(false)} />

          <View style={styles.sheet}>
            <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
            <LinearGradient
              colors={['rgba(30,20,70,0.98)', 'rgba(5,5,16,0.98)']}
              style={StyleSheet.absoluteFill}
            />

            {/* Handle */}
            <View style={styles.handle} />

            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Filtros</Text>
              <TouchableOpacity onPress={() => setOpen(false)} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <X size={20} color="#A1A1AA" />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
            >

              {/* ── Precio Máximo ── */}
              <Section icon={<Euro size={16} color="#7C3AED" />} title="Precio Máximo">
                <View style={styles.priceRow}>
                  <View style={styles.priceInputWrap}>
                    <TextInput
                      ref={priceRef}
                      style={styles.priceInput}
                      placeholder="Ej: 25"
                      placeholderTextColor="rgba(161,161,170,0.5)"
                      keyboardType="decimal-pad"
                      value={priceText}
                      onChangeText={setPriceText}
                      returnKeyType="done"
                      onSubmitEditing={() => priceRef.current?.blur()}
                    />
                    <Text style={styles.priceUnit}>€</Text>
                  </View>
                  <Text style={styles.priceHint}>Escribe el precio máximo que estás dispuesto a pagar</Text>
                </View>
                <View style={styles.pricePresets}>
                  {[10, 20, 30, 50].map(p => (
                    <TouchableOpacity
                      key={p}
                      onPress={() => setPriceText(priceText === String(p) ? '' : String(p))}
                      activeOpacity={0.75}
                      style={[styles.presetChip, priceText === String(p) && styles.presetChipOn]}
                    >
                      {priceText === String(p) && (
                        <LinearGradient colors={['#7C3AED', '#5B21B6']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
                      )}
                      <Text style={[styles.presetText, priceText === String(p) && styles.presetTextOn]}>hasta {p}€</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Section>

              {/* ── Edad mínima ── */}
              <Section icon={<User size={16} color="#7C3AED" />} title="Edad mínima">
                <View style={styles.row}>
                  {[{ label: 'Todos', val: null }, { label: '+16', val: 16 }, { label: '+18', val: 18 }, { label: '+21', val: 21 }].map(({ label, val }) => (
                    <Chip
                      key={label}
                      label={label}
                      selected={temp.minAge === val}
                      onPress={() => setTemp(p => ({ ...p, minAge: val }))}
                    />
                  ))}
                </View>
              </Section>

              {/* ── Música ── */}
              <Section icon={<Music size={16} color="#7C3AED" />} title="Tipo de música">
                <View style={styles.row}>
                  {['Todos', 'Reggaeton', 'Techno', 'House', 'Comercial', 'Hip Hop', 'Latino', 'EDM'].map(g => (
                    <Chip
                      key={g}
                      label={g}
                      selected={g === 'Todos' ? temp.musicType === null : temp.musicType === g}
                      onPress={() => setTemp(p => ({ ...p, musicType: g === 'Todos' ? null : g }))}
                    />
                  ))}
                </View>
              </Section>

              {/* ── Dress code ── */}
              <Section icon={<Shirt size={16} color="#7C3AED" />} title="Código de vestimenta">
                <View style={styles.row}>
                  {['Todos', 'Casual', 'Elegante', 'Sport', 'Formal'].map(c => (
                    <Chip
                      key={c}
                      label={c}
                      selected={c === 'Todos' ? temp.dressCode === null : temp.dressCode === c}
                      onPress={() => setTemp(p => ({ ...p, dressCode: c === 'Todos' ? null : c }))}
                    />
                  ))}
                </View>
              </Section>

            </ScrollView>

            {/* Footer */}
            <View style={styles.footer}>
              <TouchableOpacity onPress={handleClear} style={styles.clearBtn} activeOpacity={0.7}>
                <Text style={styles.clearTxt}>Limpiar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleApply} style={styles.applyBtn} activeOpacity={0.85}>
                <LinearGradient colors={['#7C3AED', '#5B21B6']} style={styles.applyGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  <Text style={styles.applyTxt}>Aplicar filtros</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {icon}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Bar ──────────────────────────────────────────────────────
  bar: { height: 50, marginBottom: 8 },
  barScroll: { paddingHorizontal: 2, alignItems: 'center', gap: 8 },
  iconBtn: { width: 44, height: 44 },
  iconBtnGrad: { flex: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  iconBtnEmpty: {
    flex: 1, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  badge: {
    position: 'absolute', top: -3, right: -3,
    backgroundColor: '#EF4444',
    width: 17, height: 17, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.dark.background,
  },
  badgeText: { color: 'white', fontSize: 9, fontWeight: '800' },
  sep: { width: 1, height: 24, backgroundColor: 'rgba(255,255,255,0.12)', marginHorizontal: 4 },
  quickChip: {
    paddingHorizontal: 18, height: 44,
    borderRadius: 22, justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
  },
  quickChipOn: { backgroundColor: 'rgba(255,255,255,0.95)', borderColor: 'white' },
  quickChipText: { color: '#D4D4D8', fontSize: 14, fontWeight: '600' },
  quickChipTextOn: { color: '#050510', fontWeight: '700' },

  // ── Modal / Sheet ─────────────────────────────────────────────
  backdrop: { flex: 1 },
  sheet: {
    height: '85%',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    overflow: 'hidden',
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'center', marginTop: 12, marginBottom: 4,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingVertical: 18,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: 'white', letterSpacing: -0.3 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },

  // ── Content ───────────────────────────────────────────────────
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
  section: { paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#A1A1AA', letterSpacing: 0.8, textTransform: 'uppercase' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  // ── Generic chip ──────────────────────────────────────────────
  chip: {
    paddingHorizontal: 16, paddingVertical: 9,
    borderRadius: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  chipOn: { borderColor: '#7C3AED' },
  chipText: { color: '#A1A1AA', fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: 'white', fontWeight: '700' },

  // ── Price ─────────────────────────────────────────────────────
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  priceInputWrap: {
    flexDirection: 'row', alignItems: 'center',
    flex: 1, maxWidth: 130,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)',
    borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10,
  },
  priceInput: { flex: 1, color: 'white', fontSize: 20, fontWeight: '700', padding: 0 },
  priceUnit: { color: '#7C3AED', fontSize: 18, fontWeight: '700', marginLeft: 4 },
  priceHint: { flex: 1, color: 'rgba(161,161,170,0.7)', fontSize: 12, lineHeight: 17 },
  pricePresets: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  presetChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  presetChipOn: { borderColor: '#7C3AED' },
  presetText: { color: '#A1A1AA', fontSize: 13, fontWeight: '600' },
  presetTextOn: { color: 'white', fontWeight: '700' },

  // ── Footer ────────────────────────────────────────────────────
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)',
  },
  clearBtn: { paddingVertical: 14, paddingHorizontal: 18 },
  clearTxt: { color: '#A1A1AA', fontSize: 15, fontWeight: '600' },
  applyBtn: { flex: 1, borderRadius: 16, overflow: 'hidden' },
  applyGrad: { paddingVertical: 15, alignItems: 'center' },
  applyTxt: { color: 'white', fontSize: 16, fontWeight: '700' },
});
