import { validateEventDraft } from '@/lib/eventFormValidation';
import { buildPublicEventShareUrl, isSafeAddressText, isSafeOrgText, isUuid, isValidPersonName } from '@/lib/validators';

const baseInput = () => {
  const now = new Date();
  const future = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const dateText = `${pad2(future.getDate())}/${pad2(future.getMonth() + 1)}/${future.getFullYear()}`;
  const timeText = `${pad2(future.getHours())}:${pad2(future.getMinutes())}`;

  return {
    title: 'Evento Test',
    description: 'Descripción',
    location: 'Madrid',
    imageUrl: 'https://example.com/poster.jpg',
    theme: 'Techno',
    dressCode: 'Casual',
    ageRestriction: '18',
    dateText,
    timeText,
    hasDateSelected: false,
    hasTimeSelected: false,
    dateValue: future,
    ticketTypes: [{ id: 't1', name: 'General', price: 10, quantity: 100, sold: 0 }],
    newTicket: { name: '', price: '', quantity: '' },
    vipTypes: [],
    newVip: {
      name: '',
      description: '',
      basePrice: '',
      capacityPeople: '',
      includedBottles: '',
      extraBottlePrice: '',
      quantityAvailable: '',
    },
  };
};

describe('validateEventDraft', () => {
  it('valida nombres de persona sin emojis ni caracteres especiales', () => {
    expect(isValidPersonName('Juan Pérez')).toBe(true);
    expect(isValidPersonName('Juan 😿')).toBe(false);
    expect(isValidPersonName('Juan-')).toBe(false);
    expect(isValidPersonName('')).toBe(false);
  });

  it('valida texto seguro sin emojis (org/dirección)', () => {
    expect(isSafeOrgText('Club 24/7')).toBe(true);
    expect(isSafeOrgText('Club 😿')).toBe(false);
    expect(isSafeAddressText('Calle del Amor Hermoso, 65, Madrid')).toBe(true);
    expect(isSafeAddressText('Calle 😿')).toBe(false);
  });

  it('genera URLs públicas de share sin exponer IDs internos', () => {
    const token = '550e8400-e29b-41d4-a716-446655440000';
    expect(isUuid(token)).toBe(true);
    const url = buildPublicEventShareUrl('https://weareeclipseoficial.com', token);
    expect(url).toBe('https://weareeclipseoficial.com/evento/550e8400-e29b-41d4-a716-446655440000');
    expect(url.includes('supabase')).toBe(false);
    expect(url.split('/evento/')[1].includes('/')).toBe(false);
  });
  it('rechaza edades negativas o no enteras', () => {
    const inputA = baseInput();
    inputA.ageRestriction = '-1';
    const rA = validateEventDraft(inputA as any);
    expect(rA.ok).toBe(false);
    expect(rA.fieldErrors.ageRestriction).toBeTruthy();

    const inputB = baseInput();
    inputB.ageRestriction = '18.5';
    const rB = validateEventDraft(inputB as any);
    expect(rB.ok).toBe(false);
    expect(rB.fieldErrors.ageRestriction).toBeTruthy();
  });

  it('rechaza precios menores a 1,00 €', () => {
    const input = baseInput();
    input.newTicket = { name: 'Promo', price: '0.50', quantity: '10' };
    input.ticketTypes = [];
    const r = validateEventDraft(input as any);
    expect(r.ok).toBe(false);
    expect(r.newTicketErrors.price).toBeTruthy();
  });

  it('rechaza emojis en el nombre de entradas', () => {
    const input = baseInput();
    input.newTicket = { name: 'Miau 😿', price: '10', quantity: '10' };
    input.ticketTypes = [];
    const r = validateEventDraft(input as any);
    expect(r.ok).toBe(false);
    expect(String(r.newTicketErrors.name || '')).toContain('emojis');
  });

  it('rechaza campos obligatorios vacíos', () => {
    const input = baseInput();
    input.title = '';
    input.location = '';
    input.imageUrl = '';
    input.ticketTypes = [];
    const r = validateEventDraft(input as any);
    expect(r.ok).toBe(false);
    expect(r.fieldErrors.title).toBeTruthy();
    expect(r.fieldErrors.location).toBeTruthy();
    expect(r.fieldErrors.imageUrl).toBeTruthy();
    expect(r.fieldErrors.ticketTypes).toBeTruthy();
  });

  it('rechaza fechas pasadas', () => {
    const input = baseInput();
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const pad2 = (n: number) => String(n).padStart(2, '0');
    input.dateValue = past;
    input.dateText = `${pad2(past.getDate())}/${pad2(past.getMonth() + 1)}/${past.getFullYear()}`;
    input.timeText = `${pad2(past.getHours())}:${pad2(past.getMinutes())}`;
    const r = validateEventDraft(input as any);
    expect(r.ok).toBe(false);
    expect(r.fieldErrors.date).toBeTruthy();
    expect(r.fieldErrors.time).toBeTruthy();
  });

  it('muestra mensajes detallados para formatos de fecha/hora', () => {
    const input = baseInput();
    input.dateText = '32/13/2026';
    input.timeText = '25:61';
    const r = validateEventDraft(input as any);
    expect(r.ok).toBe(false);
    expect(String(r.fieldErrors.date || '')).toContain('DD/MM/AAAA');
    expect(String(r.fieldErrors.time || '')).toContain('HH:MM');
  });

  it('impide enviar si hay un ticket nuevo escrito pero no añadido', () => {
    const input = baseInput();
    input.ticketTypes = [];
    input.newTicket = { name: 'General', price: '10', quantity: '10' };
    const r = validateEventDraft(input as any);
    expect(r.ok).toBe(false);
    expect(r.fieldErrors.ticketTypes).toContain('+');
  });

  it('impide enviar si hay un VIP nuevo escrito pero no añadido', () => {
    const input = baseInput();
    input.newVip = {
      name: 'Mesa VIP',
      description: '',
      basePrice: '200',
      capacityPeople: '4',
      includedBottles: '1',
      extraBottlePrice: '50',
      quantityAvailable: '2',
    };
    const r = validateEventDraft(input as any);
    expect(r.ok).toBe(false);
    expect(r.fieldErrors.vipTypes).toContain('+');
  });

  it('valida máximos en VIP con mensaje amigable', () => {
    const input = baseInput();
    input.newVip = {
      name: 'Mesa VIP',
      description: '',
      basePrice: '1000000',
      capacityPeople: '4',
      includedBottles: '1',
      extraBottlePrice: '50',
      quantityAvailable: '2',
    };
    const r = validateEventDraft(input as any);
    expect(r.ok).toBe(false);
    expect(String(r.newVipErrors.basePrice || '')).toContain('máximo');
  });

  it('avisa antes de out of range en cantidad de entradas', () => {
    const input = baseInput();
    input.newTicket = { name: 'General', price: '10', quantity: '3000000000' };
    input.ticketTypes = [];
    const r = validateEventDraft(input as any);
    expect(r.ok).toBe(false);
    expect(String(r.newTicketErrors.quantity || '')).toContain('máximo');
  });

  it('avisa si la capacidad total supera el máximo permitido', () => {
    const input = baseInput();
    input.ticketTypes = [
      { id: 't1', name: 'General', price: 10, quantity: 2147483647, sold: 0 },
      { id: 't2', name: 'VIP', price: 20, quantity: 1, sold: 0 },
    ];
    const r = validateEventDraft(input as any);
    expect(r.ok).toBe(false);
    expect(String(r.fieldErrors.ticketTypes || '')).toContain('capacidad');
  });

  it('acepta un formulario válido y devuelve dateTime', () => {
    const input = baseInput();
    const r = validateEventDraft(input as any);
    expect(r.ok).toBe(true);
    expect(r.dateTime).toBeInstanceOf(Date);
  });
});
