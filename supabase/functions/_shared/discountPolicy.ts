/** Shared integer-cent pricing and product scope. The server remains authoritative. */
export type DiscountScope = 'tickets' | 'vip_tables' | 'all' | 'selected';
export type DiscountProductKind = 'event_ticket' | 'vip_table';
export type DiscountRule = {
  id?: string;
  event_id?: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  applicability?: DiscountScope;
  ticket_type_ids?: string[];
  vip_reservado_ids?: string[];
  is_active?: boolean;
  min_tickets?: number;
  max_uses?: number | null;
  uses_count?: number;
  valid_from?: string | null;
  valid_until?: string | null;
};

export function discountSelectionKey(eventId: string, kind: DiscountProductKind, productId: string | null, quantity: number) {
  return JSON.stringify([eventId, kind, productId, quantity]);
}

export function discountAppliesToProduct(rule: DiscountRule, kind: DiscountProductKind, productId: string | null): boolean {
  // Existing codes were only accepted for admission tickets. Never broaden them implicitly.
  switch (rule.applicability ?? 'tickets') {
    case 'all': return kind === 'event_ticket' || kind === 'vip_table';
    case 'tickets': return kind === 'event_ticket';
    case 'vip_tables': return kind === 'vip_table';
    case 'selected': return !!productId && (kind === 'event_ticket'
      ? (rule.ticket_type_ids ?? []).includes(productId)
      : (rule.vip_reservado_ids ?? []).includes(productId));
    default: return false;
  }
}

export function calculateDiscountCents(subtotalCents: number, rule: Pick<DiscountRule, 'discount_type' | 'discount_value'> | null): number {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0) throw new Error('Importe no válido.');
  if (!rule) return 0;
  const value = Number(rule.discount_value);
  if (!Number.isFinite(value) || value <= 0 || !['percentage', 'fixed'].includes(rule.discount_type)
      || (rule.discount_type === 'percentage' && value > 100)) throw new Error('Descuento no válido.');
  // Fixed discounts apply once per checkout, not once per guest or ticket.
  return Math.min(subtotalCents, rule.discount_type === 'percentage'
    ? Math.round(subtotalCents * value / 100) : Math.round(value * 100));
}

export function discountError(rule: DiscountRule | null, eventId: string, kind: DiscountProductKind,
  productId: string | null, quantity: number, now = Date.now()): string | null {
  if (!rule || rule.event_id !== eventId) return 'El código no es válido para este evento.';
  if (rule.is_active !== true) return 'El código está desactivado.';
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20 || (kind === 'vip_table' && quantity !== 1)) return 'Cantidad no válida.';
  for (const [date, future] of [[rule.valid_from, true], [rule.valid_until, false]] as const) {
    if (!date) continue;
    const instant = Date.parse(date);
    if (!Number.isFinite(instant)) return 'La vigencia del código no es válida.';
    if (future && instant > now) return 'Este código todavía no está activo.';
    if (!future && instant <= now) return 'Este código ha expirado.';
  }
  if (rule.max_uses != null && Number(rule.uses_count ?? 0) >= Number(rule.max_uses)) return 'Este código ha alcanzado su límite de usos.';
  if (quantity < Number(rule.min_tickets ?? 1)) return `Este código requiere un mínimo de ${rule.min_tickets} unidades. Una mesa o pack cuenta como una unidad.`;
  if (!discountAppliesToProduct(rule, kind, productId)) return 'Este código no se aplica a la entrada o mesa VIP seleccionada.';
  try { calculateDiscountCents(100, rule); } catch { return 'Descuento no válido.'; }
  return null;
}

export function discountScopeLabel(rule: Pick<DiscountRule, 'applicability' | 'ticket_type_ids' | 'vip_reservado_ids'>): string {
  switch (rule.applicability ?? 'tickets') {
    case 'all': return 'Todas las entradas y mesas VIP';
    case 'tickets': return 'Todas las entradas · no mesas VIP';
    case 'vip_tables': return 'Todas las mesas VIP · no entradas';
    case 'selected': return `${rule.ticket_type_ids?.length ?? 0} tipos de entrada y ${rule.vip_reservado_ids?.length ?? 0} mesas VIP seleccionados`;
    default: return 'Alcance no válido';
  }
}
