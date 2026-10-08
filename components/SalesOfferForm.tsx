import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemedInput } from '@/components/ui/ThemedInput';
import { ThemedButton } from '@/components/ui/ThemedButton';
import { Colors } from '@/constants/Colors';
import { theme } from '@/theme/styles';
import { FormDateTimeField } from '@/components/ui/FormDateTimeField';
import {
  OFFER_CATEGORIES,
  type TicketDraft,
} from '@/lib/createEventTicketConfig';

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
    hint?: string,
  ) => (
    <ThemedInput
      label={label}
      hint={hint}
      multiline={key === 'benefits'}
      inputStyle={key === 'benefits' ? { minHeight: 100, textAlignVertical: 'top' } : undefined}
      maxLength={key === 'name' ? 120 : undefined}
      editable={!(key === 'price' && v.category === 'free')}
      placeholder={placeholder}
      value={String(v[key] ?? '')}
      onChangeText={(x) => set(key, x)}
      keyboardType={numeric ? key === 'price' || key === 'extraBottlePrice' ? 'decimal-pad' : 'number-pad' : 'default'}
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
        <Text style={styles.eyebrow}>CONFIGURAR OFERTA</Text>
        <Text style={styles.title}>{v.id === 'draft' ? 'Nueva entrada o mesa' : 'Editar oferta'}</Text>
        <Text style={styles.subtitle}>
          Los campos con * son obligatorios. El precio siempre corresponde a una unidad de venta.
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
            onPress={() => v.category !== c.key &&
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
        'Nombre de la oferta *',
        table ? 'Mesa Eclipse · 6 personas' : group ? 'Pack de 4 entradas' : 'Entrada + consumición',
        false, 'Es el nombre que verá el cliente al comprar y en su entrada.',
      )}
      <View style={styles.row}>
        <View style={styles.half}>
          {field(
            'price',
            table
              ? 'Precio por mesa (€) *'
              : group
                ? 'Precio por pack (€) *'
                : 'Precio por persona (€) *',
            '20',
            true,
            v.category === 'free' ? 'Las invitaciones siempre son gratuitas.' : 'Precio base. El cliente verá los gastos de gestión por separado.',
          )}
        </View>
        <View style={styles.half}>
          {field(
            'quantity',
            table
              ? 'Mesas disponibles *'
              : group
                ? 'Cupo de packs *'
                : 'Cupo de entradas *',
            table ? '4' : group ? '20' : '100',
            true,
            table ? 'Mesas que quedan disponibles, sin contar las vendidas.' : `Cupo total, incluidas las unidades vendidas${v.originalMetadata?.catalogSold ? ': ' + v.originalMetadata.catalogSold : ''}.`,
          )}
        </View>
      </View>
      {table && field('vipGroupSize', 'Capacidad por mesa *', '6', true, 'Número máximo de personas incluidas en una reserva completa.')}
      {group &&
        field('admissionsPerUnit', 'Personas por pack *', '4', true, 'Por ejemplo: 20 packs de 4 personas permiten acceder a 80 personas. Un QR por pack y acceso conjunto, sin mesa reservada.')}
      {!table && (
        <View style={styles.row}>
          <View style={styles.half}>
            {field('minPerOrder', 'Mínimo por compra *', '1', true, group ? 'Packs completos, no personas.' : 'Entradas en una misma compra.')}
          </View>
          <View style={styles.half}>
            {field('maxPerOrder', 'Máximo por compra *', '10', true, group ? 'Entre 1 y 10 packs.' : 'Entre 1 y 10 entradas.')}
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
        'Zona de acceso (opcional)',
        'Pista principal, terraza, mesa junto a cabina…',
      )}
      {!table &&
        field('includedDrinks', 'Consumiciones por persona', '0', true, 'Pon 0 si no incluye bebida. En un pack, esta cantidad se aplica a cada persona.')}
      {table && (
        <View style={styles.bottles}>
          <Text style={styles.label}>Botellas incluidas (opcional)</Text><Text style={styles.hint}>Se incluyen en el precio de la mesa. Si no añades ninguna, se vende sin botellas.</Text>
          {v.vipFreeBottles.map((b, i) => (
            <View key={i} style={styles.row}>
              <View style={{ flex: 3 }}>
                <ThemedInput
                  label="Botella *"
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
              <View style={{ width: 110 }}>
                <ThemedInput
                  label="Cantidad *"
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
          'Minutos de acceso anticipado *',
          '30',
          true,
          'Por ejemplo, 30 permite entrar media hora antes del inicio del evento. No es un tramo de precio anticipado.',
        )}
      {table && field('extraBottlePrice', 'Precio de botella adicional (€, opcional)', '80', true, 'Se muestra como información adicional. No forma parte del precio base de la mesa.')}
      {v.category === 'backstage' &&
        field(
          'backstageHost',
          'Artista o anfitrión (opcional)',
          'Anfitrión del encuentro',
        )}
      {field(
        'benefits',
        'Otras condiciones (opcional)',
        'Ej.: bebida a elegir entre refresco y cerveza.',
        false, 'Añade detalles que no hayas indicado arriba y que el cliente deba conocer antes de pagar.',
      )}
      {field(
        'entryDeadlineMinutes',
        'Límite de llegada en minutos (opcional)',
        '120',
        true,
        'Se cuenta desde el inicio del evento: 120 significa dos horas después. En blanco, esta oferta no añade un límite de llegada.',
      )}
      {!!v.entryDeadlineMinutes && eventDate && (
        <Text style={styles.notice}>
          Acceso antes de{' '}
          {new Date(
            eventDate.getTime() + Number(v.entryDeadlineMinutes) * 60000,
          ).toLocaleString('es-ES')}
          . Se mostrará en la entrada y se comprobará al acceder.
        </Text>
      )}
      {section(
        '04',
        'Cuándo se vende',
        'Una anticipada es un tramo de precio; no cambia la zona de acceso.',
      )}
      <Text style={styles.label}>Tramo de precio (opcional)</Text>
      <View style={styles.phases}>
        {[
          'Anticipada',
          'Primer tramo',
          'Segundo tramo',
          'Último tramo',
          'Precio final',
          'Sin tramo',
        ].map((p) => (
          <Pressable
            key={p}
            accessibilityRole="radio" accessibilityState={{ checked: v.salePhase === (p === 'Sin tramo' ? '' : p) }}
            onPress={() => set('salePhase', p === 'Sin tramo' ? '' : p)}
            style={[styles.phase, v.salePhase === (p === 'Sin tramo' ? '' : p) && styles.selected]}
          >
            <Text style={styles.phaseText}>{p}</Text>
          </Pressable>
        ))}
      </View>
      <FormDateTimeField label="Abrir venta (opcional)" value={v.salesStartAt} onChange={x => set('salesStartAt', x)} optional hint="En blanco, se podrá comprar al publicar el evento." error={showErrors ? errors.salesStartAt : undefined}/>
      <FormDateTimeField label="Cerrar venta (opcional)" value={v.salesEndAt} onChange={x => set('salesEndAt', x)} base={eventDate} optional hint="En blanco, no añades un cierre programado. Siguen aplicándose la disponibilidad y las condiciones de acceso." error={showErrors ? errors.salesEndAt : undefined}/>
      <LinearGradient
        colors={[Colors.dark.primarySoft, Colors.dark.surfaceSubtle]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.preview}
      >
        <Text style={styles.eyebrow}>ASÍ SE VENDE</Text>
        <Text style={styles.previewName}>{v.name || 'Tu próxima noche'}</Text>
        <View style={styles.priceLine}>
          <Text style={styles.price}>
            {v.price.trim() ? new Intl.NumberFormat('es-ES', {style: 'currency', currency: 'EUR'}).format(Number(v.price.replace(',', '.')) || 0) : '— €'}
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
              ? (v.admissionsPerUnit || '—') + ' personas · sin mesa · acceso conjunto'
              : (v.includedDrinks || '0') + ' consumiciones por persona'}
        </Text>
        <Text style={styles.hint}>
          Gastos de gestión desglosados al finalizar la compra.
        </Text>
      </LinearGradient>
      <ThemedButton
        title={
          v.id === 'draft'
            ? 'Añadir al evento'
            : 'Guardar oferta'
        }
        onPress={onAdd}
      />
      {onCancel && (
        <Pressable accessibilityRole="button" onPress={onCancel}>
          <Text style={[styles.link, { textAlign: 'center' }]}>
            {v.id === 'draft'
              ? 'Cancelar oferta'
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
    color: Colors.dark.secondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: theme.typography.fontFamily.display,
    fontWeight: '800',
    color: Colors.dark.text,
    letterSpacing: -1,
  },
  subtitle: { fontSize: 14, lineHeight: 21, color: Colors.dark.textSecondary },
  sectionHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    marginTop: 22,
    marginBottom: 4,
  },
  number: {
    color: Colors.dark.secondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    padding: 8,
    borderRadius: 9,
  },
  sectionTitle: { fontSize: 19, fontWeight: '700', color: Colors.dark.text },
  hint: { fontSize: 12, lineHeight: 18, color: Colors.dark.textSecondary, marginTop: 3 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    width: '47%',
    minWidth: 130,
    flexGrow: 1,
    padding: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    backgroundColor: Colors.dark.surfaceSubtle,
    minHeight: 95,
  },
  selected: { borderColor: Colors.dark.primary, backgroundColor: Colors.dark.primarySoft },
  selectedText: { color: Colors.dark.text },
  optionTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 5 },
  optionName: { color: Colors.dark.text, fontWeight: '700', fontSize: 13, flex: 1 },
  optionDetail: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 7,
  },
  radio: {
    height: 12,
    width: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.dark.borderStrong,
    marginTop: 2,
  },
  radioOn: { backgroundColor: Colors.dark.primary, borderColor: Colors.dark.primary },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' },
  half: { flex: 1, minWidth: 170 },
  label: { color: Colors.dark.text, fontSize: 12, fontWeight: '600', marginBottom: 8 },
  phases: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  phase: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
  },
  phaseText: { color: Colors.dark.text, fontSize: 11 },
  dateBox: { flex: 1, gap: 3, minWidth: 0 },
  dateButton: {
    padding: 13,
    backgroundColor: Colors.dark.surfaceSubtle,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    minHeight: 48,
  },
  value: { color: Colors.dark.text, fontSize: 13 },
  link: {
    color: Colors.dark.secondary,
    fontSize: 12,
    paddingVertical: 12,
    fontWeight: '600',
  },
  remove: { padding: 12, marginTop: 22 },
  bottles: {
    gap: 8,
    padding: 13,
    backgroundColor: Colors.dark.surfaceSubtle,
    borderRadius: 15,
  },
  notice: { color: Colors.dark.secondary, lineHeight: 18, fontSize: 12 },
  preview: {
    padding: 22,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.dark.border,
    marginTop: 12,
    gap: 10,
  },
  previewName: {
    fontSize: 22,
    color: Colors.dark.text,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  priceLine: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  price: {
    fontSize: 38,
    fontWeight: '800',
    color: Colors.dark.text,
    letterSpacing: -1,
  },
  unit: { fontSize: 12, color: Colors.dark.textSecondary },
  previewDetail: { color: Colors.dark.textSecondary, fontSize: 13 },
  error: { color: Colors.dark.error, fontSize: 12 },
  modal: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.dark.overlay },
  modalBody: {
    backgroundColor: Colors.dark.backgroundElevated,
    padding: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
});
