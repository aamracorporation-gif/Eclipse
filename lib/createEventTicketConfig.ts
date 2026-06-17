export type TicketCategory = 'general' | 'vip' | 'early' | 'backstage';

export type VipBottleType = 'vodka' | 'whisky' | 'gin' | 'rum' | 'champagne';

export type TicketDraft = {
  id: string;
  name: string;
  category: TicketCategory;
  price: string;
  quantity: string;
  benefits: string;
  featured: boolean;
  vipGroupSize: string;
  vipBottleQuantities: Record<VipBottleType, string>;
  generalAccessZone: string;
  generalNumberedSeat: boolean;
  earlyEntryMinutes: string;
  earlyDedicatedLane: boolean;
  backstageMeetGreet: boolean;
  backstageHost: string;
};

export function parsePositiveInt(text: string) {
  const raw = String(text || '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

export function parsePositiveNumber(text: string) {
  const raw = String(text || '').trim().replace(',', '.');
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
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
    vipBottleQuantities: {
      vodka: '',
      whisky: '',
      gin: '',
      rum: '',
      champagne: '',
    },
    generalAccessZone: '',
    generalNumberedSeat: false,
    earlyEntryMinutes: '',
    earlyDedicatedLane: false,
    backstageMeetGreet: false,
    backstageHost: '',
  };
}

export function getBottleOptions() {
  return [
    { key: 'vodka' as const, label: 'Vodka' },
    { key: 'whisky' as const, label: 'Whisky' },
    { key: 'gin' as const, label: 'Gin' },
    { key: 'rum' as const, label: 'Ron' },
    { key: 'champagne' as const, label: 'Champagne' },
  ];
}

export function getTicketDraftErrors(ticket: TicketDraft) {
  const errors: Record<string, string> = {};
  const name = ticket.name.trim();
  const price = parsePositiveNumber(ticket.price);
  const quantity = parsePositiveInt(ticket.quantity);
  const hasPartial =
    Boolean(name) ||
    Boolean(ticket.price.trim()) ||
    Boolean(ticket.quantity.trim()) ||
    Boolean(ticket.benefits.trim()) ||
    Boolean(ticket.vipGroupSize.trim()) ||
    Object.values(ticket.vipBottleQuantities).some((v) => String(v || '').trim()) ||
    Boolean(ticket.generalAccessZone.trim()) ||
    Boolean(ticket.earlyEntryMinutes.trim()) ||
    Boolean(ticket.backstageHost.trim()) ||
    ticket.generalNumberedSeat ||
    ticket.earlyDedicatedLane ||
    ticket.backstageMeetGreet;

  if (!hasPartial) return errors;

  if (!name) errors.name = 'Pon un nombre para la entrada.';
  if (price === null) errors.price = 'Precio inválido.';
  if (quantity === null) errors.quantity = 'Cantidad inválida.';

  if (ticket.category === 'vip') {
    const groupSize = parsePositiveInt(ticket.vipGroupSize);
    if (groupSize === null || groupSize < 1 || groupSize > 20) {
      errors.vipGroupSize = 'El grupo VIP debe ser entre 1 y 20 personas.';
    }
    for (const option of getBottleOptions()) {
      const raw = String(ticket.vipBottleQuantities[option.key] || '').trim();
      if (!raw) continue;
      const qty = parsePositiveInt(raw);
      if (qty === null || qty < 1 || qty > 20) {
        errors[`bottle.${option.key}`] = `Cantidad inválida para ${option.label}.`;
      }
    }
  }

  if (ticket.category === 'general') {
    if (!ticket.generalAccessZone.trim()) {
      errors.generalAccessZone = 'Indica la zona de acceso.';
    }
  }

  if (ticket.category === 'early') {
    const minutes = parsePositiveInt(ticket.earlyEntryMinutes);
    if (minutes === null || minutes < 5 || minutes > 240) {
      errors.earlyEntryMinutes = 'La antelación debe estar entre 5 y 240 minutos.';
    }
  }

  if (ticket.category === 'backstage') {
    if (ticket.backstageMeetGreet && !ticket.backstageHost.trim()) {
      errors.backstageHost = 'Indica el anfitrión o artista del backstage.';
    }
  }

  return errors;
}

export function buildTicketName(ticket: TicketDraft) {
  const categoryLabel =
    ticket.category === 'vip'
      ? 'VIP'
      : ticket.category === 'early'
        ? 'Early Access'
        : ticket.category === 'backstage'
          ? 'Backstage'
          : 'General';

  const baseName = ticket.name.trim() || categoryLabel;
  const benefits = ticket.benefits.trim();
  const featuredPrefix = ticket.featured ? 'Premium · ' : '';
  return benefits ? `${featuredPrefix}${categoryLabel} - ${baseName} (${benefits})` : `${featuredPrefix}${categoryLabel} - ${baseName}`;
}

export function serializeTicketMetadata(ticket: TicketDraft) {
  const common = {
    category: ticket.category,
    featured: ticket.featured,
    benefits: ticket.benefits.trim(),
  };

  if (ticket.category === 'vip') {
    const bottles = getBottleOptions()
      .map((option) => ({
        type: option.key,
        label: option.label,
        quantity: parsePositiveInt(ticket.vipBottleQuantities[option.key] || ''),
      }))
      .filter((item) => item.quantity !== null)
      .map((item) => ({ ...item, quantity: item.quantity as number }));

    return {
      ...common,
      vipGroupSize: parsePositiveInt(ticket.vipGroupSize) || 1,
      vipBottles: bottles,
    };
  }

  if (ticket.category === 'general') {
    return {
      ...common,
      accessZone: ticket.generalAccessZone.trim(),
      numberedSeat: ticket.generalNumberedSeat,
    };
  }

  if (ticket.category === 'early') {
    return {
      ...common,
      earlyEntryMinutes: parsePositiveInt(ticket.earlyEntryMinutes) || 0,
      dedicatedLane: ticket.earlyDedicatedLane,
    };
  }

  return {
    ...common,
    backstageMeetGreet: ticket.backstageMeetGreet,
    backstageHost: ticket.backstageHost.trim(),
  };
}

