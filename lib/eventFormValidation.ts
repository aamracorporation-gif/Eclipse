export type ValidationError = {
  field: string;
  code: string;
  message: string;
};

export const EVENT_VALIDATION_RULES = {
  title: { min: 3, max: 60 },
  description: { max: 2000 },
  location: { min: 3, max: 140 },
  theme: { max: 60 },
  dressCode: { max: 80 },
  ageRestriction: { min: 1, max: 99 },
  ticketTypeName: { min: 2, max: 40 },
  vipName: { min: 2, max: 60 },
};

export const DB_INT_LIMITS = {
  int4Max: 2147483647,
} as const;

export const TICKET_LIMITS = {
  price: { min: 1, max: 999999 },
  quantity: { min: 1, max: DB_INT_LIMITS.int4Max },
} as const;

export const VIP_LIMITS = {
  basePrice: { min: 1, max: 999999 },
  capacityPeople: { min: 1, max: 999 },
  includedBottles: { min: 0, max: 99 },
  extraBottlePrice: { min: 0, max: 999999 },
  quantityAvailable: { min: 0, max: 9999 },
} as const;

export const EVENT_VALIDATION_CODES = {
  TITLE_REQUIRED: 'EVT_TITLE_REQUIRED',
  TITLE_LENGTH: 'EVT_TITLE_LENGTH',
  TITLE_CHARS: 'EVT_TITLE_CHARS',
  LOCATION_REQUIRED: 'EVT_LOCATION_REQUIRED',
  LOCATION_LENGTH: 'EVT_LOCATION_LENGTH',
  LOCATION_CHARS: 'EVT_LOCATION_CHARS',
  DESCRIPTION_LENGTH: 'EVT_DESCRIPTION_LENGTH',
  DESCRIPTION_CHARS: 'EVT_DESCRIPTION_CHARS',
  THEME_LENGTH: 'EVT_THEME_LENGTH',
  THEME_CHARS: 'EVT_THEME_CHARS',
  DRESS_CODE_LENGTH: 'EVT_DRESS_CODE_LENGTH',
  DRESS_CODE_CHARS: 'EVT_DRESS_CODE_CHARS',
  AGE_INVALID: 'EVT_AGE_INVALID',
  IMAGE_REQUIRED: 'EVT_IMAGE_REQUIRED',
  DATE_INVALID: 'EVT_DATE_INVALID',
  TIME_INVALID: 'EVT_TIME_INVALID',
  DATETIME_PAST: 'EVT_DATETIME_PAST',
  TICKET_TYPES_REQUIRED: 'EVT_TICKET_TYPES_REQUIRED',
  TICKET_NEW_NOT_ADDED: 'EVT_TICKET_NEW_NOT_ADDED',
  TICKET_NAME_INVALID: 'EVT_TICKET_NAME_INVALID',
  TICKET_NAME_CHARS: 'EVT_TICKET_NAME_CHARS',
  TICKET_PRICE_INVALID: 'EVT_TICKET_PRICE_INVALID',
  TICKET_QTY_INVALID: 'EVT_TICKET_QTY_INVALID',
  TICKET_QTY_BELOW_SOLD: 'EVT_TICKET_QTY_BELOW_SOLD',
  CAPACITY_OUT_OF_RANGE: 'EVT_CAPACITY_OUT_OF_RANGE',
  TICKET_DUPLICATE: 'EVT_TICKET_DUPLICATE',
  VIP_NEW_NOT_ADDED: 'EVT_VIP_NEW_NOT_ADDED',
  VIP_NAME_INVALID: 'EVT_VIP_NAME_INVALID',
  VIP_BASE_PRICE_INVALID: 'EVT_VIP_BASE_PRICE_INVALID',
  VIP_CAPACITY_INVALID: 'EVT_VIP_CAPACITY_INVALID',
  VIP_QTY_INVALID: 'EVT_VIP_QTY_INVALID',
  VIP_BOTTLES_INVALID: 'EVT_VIP_BOTTLES_INVALID',
  VIP_EXTRA_PRICE_INVALID: 'EVT_VIP_EXTRA_PRICE_INVALID',
} as const;

function normalizeWhitespace(s: string) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function hasControlChars(s: string) {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s);
}

function isAllowedShortText(s: string) {
  const raw = String(s || '');
  if (!raw) return true;
  if (raw.includes('\n') || raw.includes('\r') || raw.includes('\t')) return false;
  if (hasControlChars(raw)) return false;
  return /^[\p{L}\p{N}\s.,'’"¡!¿?\-_:;()&+/€@#%]*$/u.test(raw);
}

export function parseEuro(input: string): number | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/\s/g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return value;
}

export function parsePositiveInt(input: string): number | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function parseDateDDMMYYYY(input: string): { ok: true; date: Date } | { ok: false } {
  const raw = String(input ?? '').trim();
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return { ok: false };
  const day = Number(m[1]);
  const month = Number(m[2]) - 1;
  const year = Number(m[3]);
  const d = new Date();
  d.setFullYear(year, month, day);
  d.setHours(0, 0, 0, 0);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return { ok: false };
  return { ok: true, date: d };
}

export function parseTimeHHMM(input: string): { ok: true; hours: number; minutes: number } | { ok: false } {
  const raw = String(input ?? '').trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return { ok: false };
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return { ok: false };
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return { ok: false };
  return { ok: true, hours, minutes };
}

export type TicketDraft = { id?: string; name: string; price: string; quantity: string; sold?: number };
export type VipDraft = {
  id: string;
  name: string;
  description: string;
  basePrice: string;
  capacityPeople: string;
  includedBottles: string;
  extraBottlePrice: string;
  quantityAvailable: string;
};

export type EventDraftValidationInput = {
  title: string;
  description: string;
  location: string;
  imageUrl: string;
  theme: string;
  dressCode: string;
  ageRestriction: string;
  dateText: string;
  timeText: string;
  hasDateSelected: boolean;
  hasTimeSelected: boolean;
  dateValue: Date;
  ticketTypes: Array<{ id: string; name: string; price: number; quantity: number; sold: number }>;
  newTicket: TicketDraft;
  vipTypes: VipDraft[];
  newVip: Omit<VipDraft, 'id'>;
};

export type EventDraftValidationResult = {
  ok: boolean;
  errors: ValidationError[];
  fieldErrors: Record<string, string>;
  newTicketErrors: Partial<Record<'name' | 'price' | 'quantity', string>>;
  ticketTypeErrors: Record<string, Partial<Record<'name' | 'price' | 'quantity', string>>>;
  newVipErrors: Partial<Record<'name' | 'basePrice' | 'capacityPeople' | 'quantityAvailable' | 'includedBottles' | 'extraBottlePrice', string>>;
  vipErrors: Record<string, Partial<Record<'name' | 'basePrice' | 'capacityPeople' | 'quantityAvailable' | 'includedBottles' | 'extraBottlePrice', string>>>;
  dateTime: Date | null;
};

export function validateEventDraft(input: EventDraftValidationInput): EventDraftValidationResult {
  const errors: ValidationError[] = [];
  const fieldErrors: Record<string, string> = {};
  const newTicketErrors: EventDraftValidationResult['newTicketErrors'] = {};
  const ticketTypeErrors: EventDraftValidationResult['ticketTypeErrors'] = {};
  const newVipErrors: EventDraftValidationResult['newVipErrors'] = {};
  const vipErrors: EventDraftValidationResult['vipErrors'] = {};

  const title = normalizeWhitespace(input.title);
  if (!title) {
    errors.push({ field: 'title', code: EVENT_VALIDATION_CODES.TITLE_REQUIRED, message: 'El nombre del evento es obligatorio.' });
    fieldErrors.title = 'Obligatorio.';
  } else if (title.length < EVENT_VALIDATION_RULES.title.min || title.length > EVENT_VALIDATION_RULES.title.max) {
    errors.push({ field: 'title', code: EVENT_VALIDATION_CODES.TITLE_LENGTH, message: `El nombre debe tener entre ${EVENT_VALIDATION_RULES.title.min} y ${EVENT_VALIDATION_RULES.title.max} caracteres.` });
    fieldErrors.title = `Entre ${EVENT_VALIDATION_RULES.title.min} y ${EVENT_VALIDATION_RULES.title.max} caracteres.`;
  } else if (!isAllowedShortText(title)) {
    errors.push({ field: 'title', code: EVENT_VALIDATION_CODES.TITLE_CHARS, message: 'El nombre contiene caracteres no permitidos.' });
    fieldErrors.title = 'Caracteres no permitidos.';
  }

  const location = normalizeWhitespace(input.location);
  if (!location) {
    errors.push({ field: 'location', code: EVENT_VALIDATION_CODES.LOCATION_REQUIRED, message: 'La ubicación es obligatoria.' });
    fieldErrors.location = 'Obligatorio.';
  } else if (location.length < EVENT_VALIDATION_RULES.location.min || location.length > EVENT_VALIDATION_RULES.location.max) {
    errors.push({ field: 'location', code: EVENT_VALIDATION_CODES.LOCATION_LENGTH, message: `La ubicación debe tener entre ${EVENT_VALIDATION_RULES.location.min} y ${EVENT_VALIDATION_RULES.location.max} caracteres.` });
    fieldErrors.location = `Entre ${EVENT_VALIDATION_RULES.location.min} y ${EVENT_VALIDATION_RULES.location.max} caracteres.`;
  } else if (!isAllowedShortText(location)) {
    errors.push({ field: 'location', code: EVENT_VALIDATION_CODES.LOCATION_CHARS, message: 'La ubicación contiene caracteres no permitidos.' });
    fieldErrors.location = 'Caracteres no permitidos.';
  }

  const description = String(input.description || '');
  if (description.length > EVENT_VALIDATION_RULES.description.max) {
    errors.push({ field: 'description', code: EVENT_VALIDATION_CODES.DESCRIPTION_LENGTH, message: `La descripción no puede superar ${EVENT_VALIDATION_RULES.description.max} caracteres.` });
    fieldErrors.description = `Máximo ${EVENT_VALIDATION_RULES.description.max} caracteres.`;
  } else if (hasControlChars(description)) {
    errors.push({ field: 'description', code: EVENT_VALIDATION_CODES.DESCRIPTION_CHARS, message: 'La descripción contiene caracteres no permitidos.' });
    fieldErrors.description = 'Caracteres no permitidos.';
  }

  const theme = normalizeWhitespace(input.theme);
  if (theme.length > EVENT_VALIDATION_RULES.theme.max) {
    errors.push({ field: 'theme', code: EVENT_VALIDATION_CODES.THEME_LENGTH, message: `La música/tema no puede superar ${EVENT_VALIDATION_RULES.theme.max} caracteres.` });
    fieldErrors.theme = `Máximo ${EVENT_VALIDATION_RULES.theme.max} caracteres.`;
  } else if (theme && !isAllowedShortText(theme)) {
    errors.push({ field: 'theme', code: EVENT_VALIDATION_CODES.THEME_CHARS, message: 'La música/tema contiene caracteres no permitidos.' });
    fieldErrors.theme = 'Caracteres no permitidos.';
  }

  const dressCode = normalizeWhitespace(input.dressCode);
  if (dressCode.length > EVENT_VALIDATION_RULES.dressCode.max) {
    errors.push({ field: 'dressCode', code: EVENT_VALIDATION_CODES.DRESS_CODE_LENGTH, message: `El dress code no puede superar ${EVENT_VALIDATION_RULES.dressCode.max} caracteres.` });
    fieldErrors.dressCode = `Máximo ${EVENT_VALIDATION_RULES.dressCode.max} caracteres.`;
  } else if (dressCode && !isAllowedShortText(dressCode)) {
    errors.push({ field: 'dressCode', code: EVENT_VALIDATION_CODES.DRESS_CODE_CHARS, message: 'El dress code contiene caracteres no permitidos.' });
    fieldErrors.dressCode = 'Caracteres no permitidos.';
  }

  const age = parsePositiveInt(input.ageRestriction);
  if (age === null || age < EVENT_VALIDATION_RULES.ageRestriction.min || age > EVENT_VALIDATION_RULES.ageRestriction.max) {
    errors.push({ field: 'ageRestriction', code: EVENT_VALIDATION_CODES.AGE_INVALID, message: 'La edad mínima debe ser un número entero positivo.' });
    fieldErrors.ageRestriction = 'Introduce un número entero válido.';
  }

  const imageUrl = String(input.imageUrl || '').trim();
  if (!imageUrl) {
    errors.push({ field: 'imageUrl', code: EVENT_VALIDATION_CODES.IMAGE_REQUIRED, message: 'La imagen del evento es obligatoria.' });
    fieldErrors.imageUrl = 'Obligatorio.';
  }

  let dateTime: Date | null = null;
  const base = new Date(input.dateValue);
  const hasDate = Boolean(input.hasDateSelected) || Boolean(String(input.dateText || '').trim());
  const hasTime = Boolean(input.hasTimeSelected) || Boolean(String(input.timeText || '').trim());

  if (!hasDate) {
    errors.push({ field: 'date', code: EVENT_VALIDATION_CODES.DATE_INVALID, message: 'Selecciona una fecha válida.' });
    fieldErrors.date = 'El campo fecha es obligatorio.';
  }
  if (!hasTime) {
    errors.push({ field: 'time', code: EVENT_VALIDATION_CODES.TIME_INVALID, message: 'Selecciona una hora válida.' });
    fieldErrors.time = 'El campo hora es obligatorio.';
  }

  const resolveDate = () => {
    if (input.hasDateSelected) return { ok: true as const, date: new Date(base) };
    const parsed = parseDateDDMMYYYY(input.dateText);
    if (!parsed.ok) return { ok: false as const };
    const d = new Date(base);
    d.setFullYear(parsed.date.getFullYear(), parsed.date.getMonth(), parsed.date.getDate());
    return { ok: true as const, date: d };
  };

  const resolveTime = () => {
    if (input.hasTimeSelected) {
      return { ok: true as const, hours: base.getHours(), minutes: base.getMinutes() };
    }
    const parsed = parseTimeHHMM(input.timeText);
    if (!parsed.ok) return { ok: false as const };
    return parsed;
  };

  if (hasDate && hasTime) {
    const rd = resolveDate();
    const rt = resolveTime();
    if (!rd.ok) {
      errors.push({ field: 'date', code: EVENT_VALIDATION_CODES.DATE_INVALID, message: 'Formato de fecha incorrecto: usa DD/MM/AAAA.' });
      fieldErrors.date = 'Formato de fecha incorrecto: usa DD/MM/AAAA.';
    }
    if (!rt.ok) {
      errors.push({ field: 'time', code: EVENT_VALIDATION_CODES.TIME_INVALID, message: 'Formato de hora incorrecto: usa HH:MM.' });
      fieldErrors.time = 'Formato de hora incorrecto: usa HH:MM.';
    }
    if (rd.ok && rt.ok) {
      const dt = new Date(rd.date);
      dt.setHours(rt.hours, rt.minutes, 0, 0);
      dateTime = dt;
      if (dt.getTime() <= Date.now()) {
        errors.push({ field: 'dateTime', code: EVENT_VALIDATION_CODES.DATETIME_PAST, message: 'La fecha y hora deben ser futuras.' });
        fieldErrors.date = 'La fecha debe ser futura.';
        fieldErrors.time = 'La hora debe ser futura.';
      }
    }
  }

  const newTicketHasAny = Boolean(normalizeWhitespace(input.newTicket.name)) || Boolean(String(input.newTicket.price || '').trim()) || Boolean(String(input.newTicket.quantity || '').trim());
  if (input.ticketTypes.length === 0) {
    if (newTicketHasAny) {
      errors.push({ field: 'newTicket', code: EVENT_VALIDATION_CODES.TICKET_NEW_NOT_ADDED, message: 'Tienes una entrada escrita pero no añadida.' });
      fieldErrors.ticketTypes = "Pulsa '+' para añadir la entrada.";
    } else {
      errors.push({ field: 'ticketTypes', code: EVENT_VALIDATION_CODES.TICKET_TYPES_REQUIRED, message: 'Añade al menos un tipo de entrada.' });
      fieldErrors.ticketTypes = 'Añade al menos un tipo de entrada.';
    }
  }

  if (newTicketHasAny) {
    const name = normalizeWhitespace(input.newTicket.name);
    const price = parseEuro(input.newTicket.price);
    const qty = parsePositiveInt(input.newTicket.quantity);
    if (!name) newTicketErrors.name = 'El campo nombre es obligatorio.';
    else if (name.length < EVENT_VALIDATION_RULES.ticketTypeName.min || name.length > EVENT_VALIDATION_RULES.ticketTypeName.max) {
      newTicketErrors.name = `Entre ${EVENT_VALIDATION_RULES.ticketTypeName.min} y ${EVENT_VALIDATION_RULES.ticketTypeName.max} caracteres.`;
    } else if (!isAllowedShortText(name)) {
      newTicketErrors.name = 'No se permiten emojis ni caracteres especiales.';
    }
    if (price === null) newTicketErrors.price = 'El precio debe ser un número.';
    else if (price < TICKET_LIMITS.price.min) newTicketErrors.price = 'El precio debe ser un número positivo (mínimo 1,00 €).';
    else if (price > TICKET_LIMITS.price.max) newTicketErrors.price = `El valor máximo permitido es ${TICKET_LIMITS.price.max.toLocaleString('es-ES')}.`;
    if (qty === null) newTicketErrors.quantity = 'La cantidad debe ser un número entero.';
    else if (qty < TICKET_LIMITS.quantity.min) newTicketErrors.quantity = 'La cantidad debe ser un entero positivo (mínimo 1).';
    else if (qty > TICKET_LIMITS.quantity.max) newTicketErrors.quantity = `El valor máximo permitido es ${TICKET_LIMITS.quantity.max.toLocaleString('es-ES')}.`;
  }

  const seenKeys = new Set<string>();
  let totalCapacity = 0;
  for (const tt of input.ticketTypes) {
    const tid = String(tt.id);
    const e: any = {};
    const name = normalizeWhitespace(tt.name);
    if (!name || name.length < EVENT_VALIDATION_RULES.ticketTypeName.min || name.length > EVENT_VALIDATION_RULES.ticketTypeName.max) {
      e.name = `Entre ${EVENT_VALIDATION_RULES.ticketTypeName.min} y ${EVENT_VALIDATION_RULES.ticketTypeName.max} caracteres.`;
      errors.push({ field: `ticketTypes.${tid}.name`, code: EVENT_VALIDATION_CODES.TICKET_NAME_INVALID, message: 'Nombre de entrada inválido.' });
    } else if (!isAllowedShortText(name)) {
      e.name = 'No se permiten emojis ni caracteres especiales.';
      errors.push({ field: `ticketTypes.${tid}.name`, code: EVENT_VALIDATION_CODES.TICKET_NAME_CHARS, message: 'El nombre de la entrada contiene caracteres no permitidos.' });
    }
    if (!Number.isFinite(tt.price) || tt.price < TICKET_LIMITS.price.min) {
      e.price = 'El precio debe ser un número positivo (mínimo 1,00 €).';
      errors.push({ field: `ticketTypes.${tid}.price`, code: EVENT_VALIDATION_CODES.TICKET_PRICE_INVALID, message: 'Precio de entrada inválido.' });
    } else if (tt.price > TICKET_LIMITS.price.max) {
      e.price = `El valor máximo permitido es ${TICKET_LIMITS.price.max.toLocaleString('es-ES')}.`;
      errors.push({ field: `ticketTypes.${tid}.price`, code: EVENT_VALIDATION_CODES.TICKET_PRICE_INVALID, message: 'El precio de la entrada supera el máximo permitido.' });
    }
    if (!Number.isFinite(tt.quantity) || !Number.isInteger(tt.quantity)) {
      e.quantity = 'La cantidad debe ser un número entero.';
      errors.push({ field: `ticketTypes.${tid}.quantity`, code: EVENT_VALIDATION_CODES.TICKET_QTY_INVALID, message: 'Cantidad de entradas inválida.' });
    } else if (tt.quantity < TICKET_LIMITS.quantity.min) {
      e.quantity = 'La cantidad debe ser un entero positivo (mínimo 1).';
      errors.push({ field: `ticketTypes.${tid}.quantity`, code: EVENT_VALIDATION_CODES.TICKET_QTY_INVALID, message: 'Cantidad de entradas inválida.' });
    } else if (tt.quantity > TICKET_LIMITS.quantity.max) {
      e.quantity = `El valor máximo permitido es ${TICKET_LIMITS.quantity.max.toLocaleString('es-ES')}.`;
      errors.push({ field: `ticketTypes.${tid}.quantity`, code: EVENT_VALIDATION_CODES.TICKET_QTY_INVALID, message: 'Cantidad de entradas inválida.' });
    } else if (Number.isFinite(tt.sold) && tt.sold > 0 && tt.quantity < tt.sold) {
      e.quantity = `No puede ser menor que lo vendido (${Number(tt.sold)}).`;
      errors.push({ field: `ticketTypes.${tid}.quantity`, code: EVENT_VALIDATION_CODES.TICKET_QTY_BELOW_SOLD, message: 'La cantidad no puede ser menor que lo vendido.' });
    }
    if (Number.isFinite(tt.quantity) && Number.isInteger(tt.quantity) && tt.quantity > 0) {
      totalCapacity += tt.quantity;
    }
    const key = `${name.toLowerCase()}|${Number.isFinite(tt.price) ? tt.price.toFixed(2) : 'nan'}`;
    if (name && seenKeys.has(key)) {
      errors.push({ field: `ticketTypes.${tid}`, code: EVENT_VALIDATION_CODES.TICKET_DUPLICATE, message: 'No se permiten tipos de entrada duplicados (mismo nombre y precio).' });
      fieldErrors.ticketTypes = 'Hay tipos de entrada duplicados.';
    }
    if (name) seenKeys.add(key);
    if (Object.keys(e).length) ticketTypeErrors[tid] = e;
  }

  if (totalCapacity > DB_INT_LIMITS.int4Max) {
    errors.push({
      field: 'capacity',
      code: EVENT_VALIDATION_CODES.CAPACITY_OUT_OF_RANGE,
      message: 'La capacidad total supera el máximo permitido por el sistema.',
    });
    fieldErrors.ticketTypes = `La capacidad total supera el máximo permitido (${DB_INT_LIMITS.int4Max.toLocaleString('es-ES')}). Reduce cantidades.`;
  }

  const vipHasAny = (v: VipDraft) => {
    const fields = [
      v.name,
      v.description,
      v.basePrice,
      v.capacityPeople,
      v.includedBottles,
      v.extraBottlePrice,
      v.quantityAvailable,
    ];
    return fields.some((f) => String(f || '').trim().length > 0);
  };

  const validateVip = (
    vip: { name: string; basePrice: string; capacityPeople: string; includedBottles: string; quantityAvailable: string; extraBottlePrice: string },
    set: (k: string, v: string) => void,
    fieldPrefix: string,
    idForErrors?: string
  ) => {
    const name = normalizeWhitespace(vip.name);
    const basePrice = parseEuro(vip.basePrice);
    const cap = parsePositiveInt(vip.capacityPeople);
    const included = vip.includedBottles.trim() ? parsePositiveInt(vip.includedBottles) : 0;
    const qtyRaw = vip.quantityAvailable.trim() ? parsePositiveInt(vip.quantityAvailable) : 0;
    const extra = vip.extraBottlePrice.trim() ? parseEuro(vip.extraBottlePrice) : null;

    if (!name || name.length < EVENT_VALIDATION_RULES.vipName.min || name.length > EVENT_VALIDATION_RULES.vipName.max) {
      set('name', `El nombre debe tener entre ${EVENT_VALIDATION_RULES.vipName.min} y ${EVENT_VALIDATION_RULES.vipName.max} caracteres.`);
      if (idForErrors) errors.push({ field: `${fieldPrefix}.${idForErrors}.name`, code: EVENT_VALIDATION_CODES.VIP_NAME_INVALID, message: 'El nombre del VIP no es válido.' });
    }
    if (basePrice === null) {
      set('basePrice', 'El precio debe ser un número.');
      if (idForErrors) errors.push({ field: `${fieldPrefix}.${idForErrors}.basePrice`, code: EVENT_VALIDATION_CODES.VIP_BASE_PRICE_INVALID, message: 'El precio del VIP debe ser un número.' });
    } else if (basePrice < VIP_LIMITS.basePrice.min) {
      set('basePrice', `El precio debe ser un número positivo (mínimo ${VIP_LIMITS.basePrice.min.toFixed(2)} €).`);
      if (idForErrors) errors.push({ field: `${fieldPrefix}.${idForErrors}.basePrice`, code: EVENT_VALIDATION_CODES.VIP_BASE_PRICE_INVALID, message: 'El precio del VIP debe ser al menos 1,00 €.' });
    } else if (basePrice > VIP_LIMITS.basePrice.max) {
      set('basePrice', `El valor máximo permitido es ${VIP_LIMITS.basePrice.max.toLocaleString('es-ES')}.`);
      if (idForErrors) errors.push({ field: `${fieldPrefix}.${idForErrors}.basePrice`, code: EVENT_VALIDATION_CODES.VIP_BASE_PRICE_INVALID, message: 'El precio del VIP supera el máximo permitido.' });
    }
    if (cap === null) {
      set('capacityPeople', 'La capacidad debe ser un número entero.');
      if (idForErrors) errors.push({ field: `${fieldPrefix}.${idForErrors}.capacityPeople`, code: EVENT_VALIDATION_CODES.VIP_CAPACITY_INVALID, message: 'La capacidad del VIP debe ser un número entero.' });
    } else if (cap < VIP_LIMITS.capacityPeople.min) {
      set('capacityPeople', `La capacidad debe ser un entero positivo (mínimo ${VIP_LIMITS.capacityPeople.min}).`);
      if (idForErrors) errors.push({ field: `${fieldPrefix}.${idForErrors}.capacityPeople`, code: EVENT_VALIDATION_CODES.VIP_CAPACITY_INVALID, message: 'La capacidad del VIP debe ser al menos 1.' });
    } else if (cap > VIP_LIMITS.capacityPeople.max) {
      set('capacityPeople', `El valor máximo permitido es ${VIP_LIMITS.capacityPeople.max.toLocaleString('es-ES')}.`);
      if (idForErrors) errors.push({ field: `${fieldPrefix}.${idForErrors}.capacityPeople`, code: EVENT_VALIDATION_CODES.VIP_CAPACITY_INVALID, message: 'La capacidad del VIP supera el máximo permitido.' });
    }
    if (qtyRaw === null) {
      set('quantityAvailable', 'La cantidad disponible debe ser un número entero.');
      if (idForErrors) errors.push({ field: `${fieldPrefix}.${idForErrors}.quantityAvailable`, code: EVENT_VALIDATION_CODES.VIP_QTY_INVALID, message: 'La cantidad disponible VIP debe ser un número entero.' });
    } else if (qtyRaw < VIP_LIMITS.quantityAvailable.min) {
      set('quantityAvailable', `La cantidad disponible debe ser un número entero mayor o igual a ${VIP_LIMITS.quantityAvailable.min}.`);
      if (idForErrors) errors.push({ field: `${fieldPrefix}.${idForErrors}.quantityAvailable`, code: EVENT_VALIDATION_CODES.VIP_QTY_INVALID, message: 'La cantidad disponible VIP no es válida.' });
    } else if (qtyRaw > VIP_LIMITS.quantityAvailable.max) {
      set('quantityAvailable', `El valor máximo permitido es ${VIP_LIMITS.quantityAvailable.max.toLocaleString('es-ES')}.`);
      if (idForErrors) errors.push({ field: `${fieldPrefix}.${idForErrors}.quantityAvailable`, code: EVENT_VALIDATION_CODES.VIP_QTY_INVALID, message: 'La cantidad disponible VIP supera el máximo permitido.' });
    }
    if (included === null) {
      set('includedBottles', 'Las botellas incluidas deben ser un número entero.');
      if (idForErrors) errors.push({ field: `${fieldPrefix}.${idForErrors}.includedBottles`, code: EVENT_VALIDATION_CODES.VIP_BOTTLES_INVALID, message: 'Las botellas incluidas VIP deben ser un número entero.' });
    } else if (included < VIP_LIMITS.includedBottles.min) {
      set('includedBottles', `Las botellas incluidas deben ser un número entero mayor o igual a ${VIP_LIMITS.includedBottles.min}.`);
      if (idForErrors) errors.push({ field: `${fieldPrefix}.${idForErrors}.includedBottles`, code: EVENT_VALIDATION_CODES.VIP_BOTTLES_INVALID, message: 'Las botellas incluidas VIP no son válidas.' });
    } else if (included > VIP_LIMITS.includedBottles.max) {
      set('includedBottles', `El valor máximo permitido es ${VIP_LIMITS.includedBottles.max.toLocaleString('es-ES')}.`);
      if (idForErrors) errors.push({ field: `${fieldPrefix}.${idForErrors}.includedBottles`, code: EVENT_VALIDATION_CODES.VIP_BOTTLES_INVALID, message: 'Las botellas incluidas VIP superan el máximo permitido.' });
    }
    if (extra !== null && extra < VIP_LIMITS.extraBottlePrice.min) {
      set('extraBottlePrice', `El precio extra debe ser un número mayor o igual a ${VIP_LIMITS.extraBottlePrice.min.toFixed(2)} €.`);
      if (idForErrors) errors.push({ field: `${fieldPrefix}.${idForErrors}.extraBottlePrice`, code: EVENT_VALIDATION_CODES.VIP_EXTRA_PRICE_INVALID, message: 'El precio extra VIP no es válido.' });
    } else if (extra !== null && extra > VIP_LIMITS.extraBottlePrice.max) {
      set('extraBottlePrice', `El valor máximo permitido es ${VIP_LIMITS.extraBottlePrice.max.toLocaleString('es-ES')}.`);
      if (idForErrors) errors.push({ field: `${fieldPrefix}.${idForErrors}.extraBottlePrice`, code: EVENT_VALIDATION_CODES.VIP_EXTRA_PRICE_INVALID, message: 'El precio extra VIP supera el máximo permitido.' });
    }
  };

  for (const vip of input.vipTypes) {
    if (!vipHasAny(vip)) continue;
    const id = String(vip.id);
    const e: any = {};
    validateVip(
      vip,
      (k, v) => {
        e[k] = v;
      },
      'vip',
      id
    );
    if (Object.keys(e).length) vipErrors[id] = e;
  }

  const newVipHasAny = vipHasAny({ id: 'new', ...input.newVip } as any);
  if (newVipHasAny) {
    validateVip(
      input.newVip,
      (k, v) => {
        (newVipErrors as any)[k] = v;
      },
      'newVip'
    );
    if (Object.keys(newVipErrors).length === 0) {
      errors.push({ field: 'newVip', code: EVENT_VALIDATION_CODES.VIP_NEW_NOT_ADDED, message: 'Tienes un VIP escrito pero no añadido.' });
      fieldErrors.vipTypes = "Pulsa '+' para añadir el VIP.";
    }
  }

  const hasNewTicketErrors = Object.values(newTicketErrors).some(Boolean);
  const hasTicketTypeErrors = Object.values(ticketTypeErrors).some((e) => Object.values(e || {}).some(Boolean));
  const hasVipErrors = Object.values(vipErrors).some((e) => Object.values(e || {}).some(Boolean));
  const hasNewVipErrors = Object.values(newVipErrors).some(Boolean);

  return {
    ok: errors.length === 0 && !hasNewTicketErrors && !hasTicketTypeErrors && !hasVipErrors && !hasNewVipErrors,
    errors,
    fieldErrors,
    newTicketErrors,
    ticketTypeErrors,
    newVipErrors,
    vipErrors,
    dateTime,
  };
}
