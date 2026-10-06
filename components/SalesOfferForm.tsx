import React, { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { Colors } from '@/constants/Colors';
import {
  OFFER_CATEGORIES,
  type TicketDraft,
} from '@/lib/createEventTicketConfig';

function SaleDate({
  label,
  value,
  onChange,
  base,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  base?: Date | null;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(new Date());
  const choose = () => {
    const initial = value ? new Date(value) : base || new Date();
    setDraft(initial);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: initial,
        mode: 'date',
        onChange: (e, d) => {
          if (e.type !== 'set' || !d) return;
          DateTimePickerAndroid.open({
            value: d,
            mode: 'time',
            is24Hour: true,
            onChange: (e2, time) => {
              if (e2.type === 'set' && time) {
                d.setHours(time.getHours(), time.getMinutes(), 0, 0);
                onChange(d.toISOString());
              }
            },
          });
        },
      });
    } else setOpen(true);
  };
  return (
    <View style={styles.dateBox}>
      <Text style={styles.label}>{label}</Text>
      {Platform.OS === 'web' ? (
        React.createElement('input', {
          type: 'datetime-local',
          value: value
            ? new Date(
                new Date(value).getTime() -
                  new Date(value).getTimezoneOffset() * 60000,
              )
                .toISOString()
                .slice(0, 16)
            : '',
          onChange: (e: any) =>
            onChange(
              e.target.value ? new Date(e.target.value).toISOString() : '',
            ),
          style: {
            background: '#11101e',
            color: '#eee8ff',
            border: '1px solid #393247',
            padding: 12,
            borderRadius: 12,
            width: '100%',
            colorScheme: 'dark',
            minWidth: 0,
            boxSizing: 'border-box',
          },
        })
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={choose}
          style={styles.dateButton}
        >
          <Text style={styles.value}>
            {value
              ? new Date(value).toLocaleString('es-ES', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'Sin programar'}
          </Text>
        </Pressable>
      )}
      {!!value && (
        <Pressable onPress={() => onChange('')}>
          <Text style={styles.link}>Quitar horario</Text>
        </Pressable>
      )}
      <Modal
        visible={open && Platform.OS === 'ios'}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modal}>
          <View style={styles.modalBody}>
            <DateTimePicker
              value={draft}
              mode="datetime"
              display="spinner"
              themeVariant="dark"
              onChange={(_, d) => d && setDraft(d)}
            />
            <ThemedButton
              title="Confirmar horario"
              onPress={() => {
                onChange(draft.toISOString());
                setOpen(false);
              }}
            />
            <Pressable onPress={() => setOpen(false)}>
              <Text style={styles.link}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
export function SalesOfferForm({
  value,
  onChange,
  errors,
  showErrors,
  onAdd,
  onCancel,
  eventDate,
}: {
  value: TicketDraft;
  onChange: (v: TicketDraft) => void;
  errors: Record<string, string>;
  showErrors: boolean;
  onAdd: () => void;
  onCancel?: () => void;
  eventDate?: Date | null;
}) {
  const v = value,
    table = v.category === 'vip_table',
    group = v.category === 'group';
  const bottleCount = v.vipFreeBottles.reduce(
    (n, b) => n + (Number(b.quantity) || 0),
    0,
  );
  const set = (key: keyof TicketDraft, next: any) =>
    onChange({ ...v, [key]: next });
  const field = (
    key: keyof TicketDraft,
    label: string,
    placeholder: string,
    numeric = false,
  ) => (
    <ThemedInput
      label={label}
      placeholder={placeholder}
      value={String(v[key] ?? '')}
      onChangeText={(x) => set(key, x)}
      keyboardType={numeric ? 'decimal-pad' : 'default'}
      error={showErrors ? errors[key] : undefined}
    />
  );
  const section = (number: string, title: string, body: string) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.number}>{number}</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.hint}>{body}</Text>
      </View>
    </View>
  );
  return (
    <View style={styles.root}>
      <View style={styles.heading}>
        <Text style={styles.eyebrow}>ECLIPSE / VENTAS</Text>
        <Text style={styles.title}>Diseña el acceso.</Text>
        <Text style={styles.subtitle}>
          Cada oferta, sus condiciones. Todo claro antes de pagar.
        </Text>
      </View>
      {section(
        '01',
        'Qué vendes',
        'El VIP corresponde siempre a un reservado de mesa.',
      )}
      <View style={styles.options}>
        {OFFER_CATEGORIES.map((c) => (
          <Pressable
            key={c.key}
            accessibilityRole="radio"
            accessibilityState={{ checked: v.category === c.key }}
            onPress={() =>
              onChange({
                ...v,
                category: c.key,
                price: c.key === 'free' ? '0' : v.price,
                earlyDedicatedLane: c.key === 'fast_lane',
                admissionsPerUnit: c.key === 'group' ? '4' : '1',
              })
            }
            style={[styles.option, v.category === c.key && styles.selected]}
          >
            <View style={styles.optionTop}>
              <Text
                style={[
                  styles.optionName,
                  v.category === c.key && styles.selectedText,
                ]}
              >
                {c.label}
              </Text>
              <View
                style={[styles.radio, v.category === c.key && styles.radioOn]}
              />
            </View>
            <Text style={styles.optionDetail}>{c.detail}</Text>
          </Pressable>
        ))}
      </View>
      {section(
        '02',
        'Precio y disponibilidad',
        table
          ? 'Precio por mesa completa.'
          : group
            ? 'Precio por pack, con acceso conjunto.'
            : 'Precio por persona. Los gastos se desglosan al comprar.',
      )}
      {field(
        'name',
        'Nombre de la oferta',
        table ? 'Mesa Eclipse · 6 personas' : 'Entrada + 2 consumiciones',
      )}
      <View style={styles.row}>
        <View style={styles.half}>
          {field(
            'price',
            table
              ? 'Precio por mesa (€)'
              : group
                ? 'Precio por pack (€)'
                : 'Precio por persona (€)',
            '20',
            true,
          )}
        </View>
        <View style={styles.half}>
          {field(
            'quantity',
            table
              ? 'Mesas disponibles'
              : group
                ? 'Packs disponibles'
                : 'Entradas a la venta',
            '100',
            true,
          )}
        </View>
      </View>
      {table && field('vipGroupSize', 'Personas incluidas por mesa', '6', true)}
      {group &&
        field('admissionsPerUnit', 'Personas incluidas por pack', '4', true)}
      {!table && (
        <View style={styles.row}>
          <View style={styles.half}>
            {field('minPerOrder', 'Mínimo por compra', '1', true)}
          </View>
          <View style={styles.half}>
            {field('maxPerOrder', 'Máximo por compra', '10', true)}
          </View>
        </View>
      )}
      {section(
        '03',
        'Qué incluye',
        'Estos detalles aparecerán en la compra y en la entrada.',
      )}
      {field(
        'generalAccessZone',
        'Zona de acceso',
        'Pista principal, terraza, mesa junto a cabina…',
      )}
      {!table &&
        field('includedDrinks', 'Consumiciones por persona', '0', true)}
      {table && (
        <View style={styles.bottles}>
          <Text style={styles.label}>Botellas incluidas</Text>
          {v.vipFreeBottles.map((b, i) => (
            <View key={i} style={styles.row}>
              <View style={{ flex: 3 }}>
                <ThemedInput
                  label="Botella"
                  placeholder="Tipo o marca"
                  value={b.brand}
                  onChangeText={(x) =>
                    set(
                      'vipFreeBottles',
                      v.vipFreeBottles.map((old, j) =>
                        j === i ? { ...old, brand: x } : old,
                      ),
                    )
                  }
                  error={
                    showErrors ? errors['bottle.' + i + '.brand'] : undefined
                  }
                />
              </View>
              <View style={{ flex: 1 }}>
                <ThemedInput
                  label="Uds."
                  value={b.quantity}
                  keyboardType="number-pad"
                  onChangeText={(x) =>
                    set(
                      'vipFreeBottles',
                      v.vipFreeBottles.map((old, j) =>
                        j === i ? { ...old, quantity: x } : old,
                      ),
                    )
                  }
                  error={
                    showErrors ? errors['bottle.' + i + '.quantity'] : undefined
                  }
                />
              </View>
              <Pressable
                accessibilityLabel="Quitar botella"
                onPress={() =>
                  set(
                    'vipFreeBottles',
                    v.vipFreeBottles.filter((_, j) => j !== i),
                  )
                }
                style={styles.remove}
              >
                <Text style={styles.value}>×</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={() =>
              set('vipFreeBottles', [
                ...v.vipFreeBottles,
                { brand: '', quantity: '1' },
              ])
            }
          >
            <Text style={styles.link}>+ Añadir botella incluida</Text>
          </Pressable>
        </View>
      )}
      {v.category === 'early' &&
        field(
          'earlyEntryMinutes',
          'Acceso antes de la apertura (minutos)',
          '30',
          true,
        )}
      {v.category === 'backstage' &&
        field(
          'backstageHost',
          'Artista o anfitrión (opcional)',
          'Anfitrión del encuentro',
        )}
      {field(
        'benefits',
        'Condiciones e inclusiones',
        'Qué incluye exactamente. Indica aquí las condiciones de acceso.',
      )}
      {field(
        'entryDeadlineMinutes',
        'Acceso hasta (minutos desde el inicio, opcional)',
        '120',
        true,
      )}
      {!!v.entryDeadlineMinutes && eventDate && (
        <Text style={styles.notice}>
          Acceso antes de{' '}
          {new Date(
            eventDate.getTime() + Number(v.entryDeadlineMinutes) * 60000,
          ).toLocaleString('es-ES')}
          . El límite figurará en el QR.
        </Text>
      )}
      {section(
        '04',
        'Cuándo se vende',
        'Una anticipada es un tramo de precio; no cambia la zona de acceso.',
      )}
      <Text style={styles.label}>Tramo comercial</Text>
      <View style={styles.phases}>
        {[
          'Anticipada',
          'Primer tramo',
          'Segundo tramo',
          'Último tramo',
          'Taquilla online',
        ].map((p) => (
          <Pressable
            key={p}
            onPress={() => set('salePhase', p)}
            style={[styles.phase, v.salePhase === p && styles.selected]}
          >
            <Text style={styles.phaseText}>{p}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <SaleDate
          label="Abrir venta"
          value={v.salesStartAt}
          onChange={(x) => set('salesStartAt', x)}
          base={eventDate}
        />
        <SaleDate
          label="Cerrar venta"
          value={v.salesEndAt}
          onChange={(x) => set('salesEndAt', x)}
          base={eventDate}
        />
      </View>
      {showErrors && errors.salesEndAt && (
        <Text style={styles.error}>{errors.salesEndAt}</Text>
      )}
      <LinearGradient
        colors={['#211339', '#11101E']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.preview}
      >
        <Text style={styles.eyebrow}>ASÍ SE VENDE</Text>
        <Text style={styles.previewName}>{v.name || 'Tu próxima noche'}</Text>
        <View style={styles.priceLine}>
          <Text style={styles.price}>
            {Number(v.price.replace(',', '.')) || 0} €
          </Text>
          <Text style={styles.unit}>
            {table ? 'por mesa' : group ? 'por pack' : 'por persona'}
          </Text>
        </View>
        <Text style={styles.previewDetail}>
          {table
            ? (v.vipGroupSize || '—') +
              ' personas · ' +
              bottleCount +
              (bottleCount === 1 ? ' botella incluida' : ' botellas incluidas')
            : group
              ? (v.admissionsPerUnit || '—') + ' personas · acceso conjunto'
              : (v.includedDrinks || '0') + ' consumiciones por persona'}
        </Text>
        <Text style={styles.hint}>
          Gastos de gestión desglosados al finalizar la compra.
        </Text>
      </LinearGradient>
      <ThemedButton
        title={
          v.id === 'draft'
            ? 'Añadir oferta al catálogo'
            : 'Guardar cambios de la oferta'
        }
        onPress={onAdd}
      />
      {onCancel && (
        <Pressable accessibilityRole="button" onPress={onCancel}>
          <Text style={[styles.link, { textAlign: 'center' }]}>
            {v.id === 'draft'
              ? 'Limpiar oferta'
              : 'Descartar cambios de esta oferta'}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { gap: 12, minWidth: 0 },
  heading: { paddingBottom: 8, gap: 8 },
  eyebrow: {
    color: '#BDA6F8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
  },
  title: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '800',
    color: '#F4F0FF',
    letterSpacing: -1,
  },
  subtitle: { fontSize: 14, lineHeight: 21, color: '#ADA6BC' },
  sectionHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    marginTop: 22,
    marginBottom: 4,
  },
  number: {
    color: '#BBA4F0',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: '#423350',
    padding: 8,
    borderRadius: 9,
  },
  sectionTitle: { fontSize: 19, fontWeight: '700', color: '#F4F0FF' },
  hint: { fontSize: 12, lineHeight: 18, color: '#A49BAD', marginTop: 3 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    width: '48%',
    flexGrow: 1,
    padding: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#30273D',
    backgroundColor: '#100D19',
    minHeight: 95,
  },
  selected: { borderColor: '#AE8BE9', backgroundColor: '#28173F' },
  selectedText: { color: '#E5D7FF' },
  optionTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 5 },
  optionName: { color: '#E4DEED', fontWeight: '700', fontSize: 13, flex: 1 },
  optionDetail: {
    color: '#A79BAF',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 7,
  },
  radio: {
    height: 12,
    width: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#655572',
    marginTop: 2,
  },
  radioOn: { backgroundColor: '#C5A3FF', borderColor: '#C5A3FF' },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  half: { flex: 1 },
  label: { color: '#C7BFD1', fontSize: 12, fontWeight: '600', marginBottom: 8 },
  phases: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  phase: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#393045',
  },
  phaseText: { color: '#DED4EA', fontSize: 11 },
  dateBox: { flex: 1, gap: 3, minWidth: 0 },
  dateButton: {
    padding: 13,
    backgroundColor: '#11101E',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#393247',
    minHeight: 48,
  },
  value: { color: '#F4EDFF', fontSize: 13 },
  link: {
    color: '#BDA6F8',
    fontSize: 12,
    paddingVertical: 12,
    fontWeight: '600',
  },
  remove: { padding: 12, marginTop: 22 },
  bottles: {
    gap: 8,
    padding: 13,
    backgroundColor: '#15101E',
    borderRadius: 15,
  },
  notice: { color: '#E1CD9E', lineHeight: 18, fontSize: 12 },
  preview: {
    padding: 22,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#594068',
    marginTop: 12,
    gap: 10,
  },
  previewName: {
    fontSize: 22,
    color: '#FFF',
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  price: {
    fontSize: 38,
    fontWeight: '800',
    color: '#EEE4FF',
    letterSpacing: -1,
  },
  unit: { fontSize: 12, color: '#B4A4C7' },
  previewDetail: { color: '#D7C8E9', fontSize: 13 },
  error: { color: Colors.dark.error, fontSize: 12 },
  modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0009' },
  modalBody: {
    backgroundColor: '#171022',
    padding: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
});
