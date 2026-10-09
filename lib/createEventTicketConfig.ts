export type TicketCategory =
  | 'general'
  | 'vip_table'
  | 'early'
  | 'backstage'
  | 'fast_lane'
  | 'group'
  | 'free'
  | 'custom';
export type FreeBottleEntry = { brand: string; quantity: string };
export type TicketDraft = {
  id: string;
  name: string;
  category: TicketCategory;
  price: string;
  quantity: string;
  benefits: string;
  featured: boolean;
  vipGroupSize: string;
  vipFreeBottles: FreeBottleEntry[];
  generalAccessZone: string;
  generalNumberedSeat: boolean;
  earlyEntryMinutes: string;
  entryDeadlineMinutes?: string;
  earlyDedicatedLane: boolean;
  backstageMeetGreet: boolean;
  backstageHost: string;
  salePhase?: string;
  includedDrinks?: string;
  admissionsPerUnit?: string;
  salesStartAt?: string;
  salesEndAt?: string;
  minPerOrder?: string;
  maxPerOrder?: string;
  extraBottlePrice?: string;
  originalMetadata?: Record<string, any>;
};
export const OFFER_CATEGORIES: {
  key: TicketCategory;
  label: string;
  detail: string;
}[] = [
  {
    key: 'general',
    label: 'Entrada',
    detail: 'Pista, zona o entrada con consumiciones',
  },
  {
    key: 'vip_table',
    label: 'Mesa VIP',
    detail: 'Un reservado completo para tu grupo',
  },
  {
    key: 'early',
    label: 'Acceso anticipado',
    detail: 'Entrada antes de la apertura general',
  },
  {
    key: 'fast_lane',
    label: 'Acceso prioritario',
    detail: 'Entrada con carril rápido',
  },
  {
    key: 'group',
    label: 'Pack de grupo',
    detail: 'Un precio por pack; acceso conjunto',
  },
  {
    key: 'free',
    label: 'Invitación',
    detail: 'Acceso gratuito con cupo y condiciones',
  },
  {
    key: 'backstage',
    label: 'Backstage',
    detail: 'Acceso a una zona restringida',
  },
  {
    key: 'custom',
    label: 'Personalizada',
    detail: 'Nombre, zona y condiciones propias',
  },
];
export function parsePositiveInt(text: string) {
  const raw = String(text || '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
export function parsePositiveNumber(text: string) {
  const raw = String(text || '')
    .trim()
    .replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function createEmptyTicketDraft(): TicketDraft {
  return {
    id: 'draft',
    name: '',
    category: 'general',
    price: '',
    quantity: '',
    benefits: '',
    featured: false,
    vipGroupSize: '',
    vipFreeBottles: [],
    generalAccessZone: '',
    generalNumberedSeat: false,
    earlyEntryMinutes: '',
    entryDeadlineMinutes: '',
    earlyDedicatedLane: false,
    backstageMeetGreet: false,
    backstageHost: '',
    salePhase: 'Anticipada',
    includedDrinks: '0',
    admissionsPerUnit: '1',
    salesStartAt: '',
    salesEndAt: '',
    minPerOrder: '1',
    maxPerOrder: '10',
    extraBottlePrice: '',
  };
}
export function getTicketDraftErrors(t: TicketDraft) {
  const errors: Record<string, string> = {};
  if (!t.name.trim()) errors.name = 'Pon un nombre para la oferta.';
  const price = parsePositiveNumber(t.price),
    qty = parsePositiveInt(t.quantity);
  if (price === null || (price > 0 && price < 0.5) || (price || 0) > 500000)
    errors.price = 'Precio entre 0,50 € y 500.000 €, o 0 € para invitaciones.';
  if (t.category === 'free' && price !== 0)
    errors.price = 'Una invitación es gratuita.';
  if (t.category === 'vip_table' && (price === null || price < 0.5))
    errors.price = 'Indica el precio del reservado completo.';
  if (
    (qty === null &&
      !(
        t.category === 'vip_table' &&
        t.id !== 'draft' &&
        t.quantity === '0'
      )) ||
    (qty || 0) > 50000
  )
    errors.quantity =
      'Introduce entre 1 y 50.000 unidades; una mesa existente puede quedar agotada con 0.';
  if (!OFFER_CATEGORIES.some((c) => c.key === t.category))
    errors.category = 'El VIP solo se vende como reservado de mesa.';
  if (t.category !== 'vip_table' && /\bvip\b/i.test(t.name))
    errors.name = 'Reserva el nombre VIP para los reservados de mesa.';
  if (
    t.entryDeadlineMinutes?.trim() &&
    (parsePositiveInt(t.entryDeadlineMinutes) === null ||
      Number(t.entryDeadlineMinutes) > 1440)
  )
    errors.entryDeadlineMinutes = 'Entre 1 y 1440 minutos desde el inicio.';
  if (t.category === 'vip_table') {
    const group = parsePositiveInt(t.vipGroupSize);
    if (group === null || group > 20)
      errors.vipGroupSize = 'La mesa admite entre 1 y 20 personas.';
    t.vipFreeBottles.forEach((b, i) => {
      if (!b.brand.trim())
        errors['bottle.' + i + '.brand'] = 'Indica la botella incluida.';
      const n = parsePositiveInt(b.quantity);
      if (n === null || n > 99)
        errors['bottle.' + i + '.quantity'] = 'Entre 1 y 99 botellas.';
    });
    if (
      t.extraBottlePrice?.trim() &&
      parsePositiveNumber(t.extraBottlePrice) === null
    )
      errors.extraBottlePrice = 'Precio inválido.';
  }
  if (t.category === 'group') {
    const n = parsePositiveInt(t.admissionsPerUnit || '');
    if (n === null || n < 2 || n > 20)
      errors.admissionsPerUnit = 'Entre 2 y 20 personas por pack.';
  }
  if (t.category === 'early') {
    const n = parsePositiveInt(t.earlyEntryMinutes);
    if (n === null || n < 5 || n > 240)
      errors.earlyEntryMinutes = 'Entre 5 y 240 minutos de antelación.';
  }
  if (t.backstageMeetGreet && !t.backstageHost.trim())
    errors.backstageHost = 'Indica el anfitrión o artista.';
  if (!/^\d+$/.test(t.includedDrinks || '0') || Number(t.includedDrinks) > 20)
    errors.includedDrinks = 'Entre 0 y 20 consumiciones por persona.';
  const min = parsePositiveInt(t.minPerOrder || '1'),
    max = parsePositiveInt(t.maxPerOrder || '10');
  if (!min || !max || min > max || max > 10)
    errors.maxPerOrder =
      'Entre 1 y 10 unidades; máximo igual o mayor al mínimo.';
  const start = t.salesStartAt ? Date.parse(t.salesStartAt) : null,
    end = t.salesEndAt ? Date.parse(t.salesEndAt) : null;
  if (start !== null && !Number.isFinite(start))
    errors.salesStartAt = 'Fecha de apertura inválida.';
  if (
    end !== null &&
    (!Number.isFinite(end) || (start !== null && end <= start))
  )
    errors.salesEndAt = 'El cierre debe ser posterior a la apertura.';
  return errors;
}
export function buildTicketName(t: TicketDraft) {
  return (
    t.name.trim() ||
    OFFER_CATEGORIES.find((c) => c.key === t.category)?.label ||
    'Entrada'
  );
}
export function serializeTicketMetadata(t: TicketDraft) {
  const original = { ...(t.originalMetadata || {}) };
  delete original.catalogAvailable;
  return {
    ...original,
    category: t.category,
    productKind: t.category === 'vip_table' ? 'vip_table' : 'admission',
    featured: t.featured,
    benefits: t.benefits.trim(),
    salePhase: t.salePhase?.trim() || '',
    includedDrinks: Number(t.includedDrinks || 0),
    admissionsPerUnit:
      t.category === 'group' ? Number(t.admissionsPerUnit || 1) : 1,
    minPerOrder: t.category === 'vip_table' ? 1 : Number(t.minPerOrder || 1),
    maxPerOrder: t.category === 'vip_table' ? 1 : Number(t.maxPerOrder || 10),
    salesStartAt: t.salesStartAt || null,
    salesEndAt: t.salesEndAt || null,
    entryDeadlineMinutes: t.entryDeadlineMinutes?.trim()
      ? parsePositiveInt(t.entryDeadlineMinutes)
      : null,
    accessZone: t.generalAccessZone.trim(),
    numberedSeat: false,
    earlyEntryMinutes: t.category === 'early' ? Number(t.earlyEntryMinutes) : 0,
    dedicatedLane: t.category === 'fast_lane' || t.earlyDedicatedLane,
    backstageMeetGreet: t.backstageMeetGreet,
    backstageHost: t.backstageHost.trim(),
    ...(t.category === 'vip_table'
      ? {
          vipGroupSize: Number(t.vipGroupSize),
          vipBottles: t.vipFreeBottles.map((b) => ({
            brand: b.brand.trim(),
            quantity: Number(b.quantity),
          })),
        }
      : {}),
  };
}
export function offerFromRow(row: any, table = false): TicketDraft {
  const m = row.metadata || {};
  return {
    ...createEmptyTicketDraft(),
    id: row.id,
    name: row.name || '',
    category: table
      ? 'vip_table'
      : row.category === 'fastlane'
        ? 'fast_lane'
        : row.category || 'general',
    price: String(table ? row.base_price : row.price),
    quantity: String(table ? row.quantity_available : row.quantity),
    benefits: m.benefits || row.description || '',
    featured: !!m.featured,
    vipGroupSize: String(row.capacity_people || m.vipGroupSize || ''),
    vipFreeBottles:
      m.vipBottles?.map((b: any) => ({
        brand: b.brand || '',
        quantity: String(b.quantity || 1),
      })) ||
      (row.included_bottles
        ? [
            {
              brand: 'Botella incluida',
              quantity: String(row.included_bottles),
            },
          ]
        : []),
    generalAccessZone: m.accessZone || '',
    earlyEntryMinutes: String(m.earlyEntryMinutes || ''),
    entryDeadlineMinutes: String(m.entryDeadlineMinutes || ''),
    earlyDedicatedLane: !!m.dedicatedLane,
    backstageMeetGreet: !!m.backstageMeetGreet,
    backstageHost: m.backstageHost || '',
    salePhase: m.salePhase || '',
    includedDrinks: String(m.includedDrinks || 0),
    admissionsPerUnit: String(m.admissionsPerUnit || 1),
    salesStartAt: m.salesStartAt || '',
    salesEndAt: m.salesEndAt || '',
    minPerOrder: String(m.minPerOrder || 1),
    maxPerOrder: String(m.maxPerOrder || 10),
    extraBottlePrice:
      row.extra_bottle_price == null ? '' : String(row.extra_bottle_price),
    originalMetadata: {
      ...m,
      ...(table ? { catalogAvailable: row.quantity_available } : {}),
    },
  };
}
