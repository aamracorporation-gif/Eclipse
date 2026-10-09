/** One interpretation of a purchased product for the app, PDF and both Wallets. */
export type TicketVisual = 'general' | 'vip' | 'backstage' | 'fastlane';
export type ProductSnapshot = {
  kind: 'admission' | 'vip_table';
  category: string;
  name: string;
  metadata: Record<string, any>;
};
export function resolveTicketProduct(
  ticket: any,
): ProductSnapshot & { visual: TicketVisual } {
  const direct = Array.isArray(ticket.event_ticket_types)
    ? ticket.event_ticket_types[0]
    : ticket.event_ticket_types;
  const related =
    direct ||
    ticket.events?.event_ticket_types?.find(
      (t: any) => t.id === ticket.ticket_type_id,
    );
  const snapshot = ticket.product_snapshot || {};
  const category = String(
    snapshot.category || related?.category || ticket.ticket_type || '',
  ).toLowerCase();
  const kind =
    snapshot.kind === 'vip_table' || category === 'vip_table'
      ? 'vip_table'
      : 'admission';
  const metadata = {
    ...(snapshot.kind ? snapshot.metadata || {} : related?.metadata || {}),
  };
  metadata.benefits = [
    metadata.benefits,
    Number(metadata.includedDrinks) > 0
      ? `${metadata.includedDrinks} consumiciones por persona`
      : '',
    Number(metadata.admissionsPerUnit) > 1
      ? `Pack de ${metadata.admissionsPerUnit} personas; acceso conjunto`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const name = String(
    snapshot.name ||
      related?.name ||
      (kind === 'vip_table'
        ? 'Reservado de mesa VIP'
        : category === 'free'
          ? 'Invitación'
          : 'Entrada general'),
  );
  const text = `${category} ${name}`.toLowerCase();
  const visual: TicketVisual =
    kind === 'vip_table' || /\bvip\b|reservado/.test(text)
      ? 'vip'
      : /backstage|back stage/.test(text)
        ? 'backstage'
        : /fast[_ -]?lane|express/.test(text) || metadata.dedicatedLane === true
          ? 'fastlane'
          : 'general';
  return { kind, category: category || 'general', name, metadata, visual };
}

/** Validates the conditions visible to buyers before creating a payment. */
export function offerUnavailableReason(
  offer: any,
  quantity: number,
  now = Date.now(),
): string | null {
  if (offer.is_active === false || offer.deleted_at)
    return 'Esta oferta ya no está a la venta.';
  if (['vip', 'vip_table'].includes(String(offer.category || '').toLowerCase()))
    return 'El VIP se reserva como mesa. Selecciona Reservados de mesa.';
  const m = offer.metadata || {};
  const min = Number(m.minPerOrder || 1),
    max = Number(m.maxPerOrder || 10);
  if (
    !Number.isInteger(min) ||
    !Number.isInteger(max) ||
    min < 1 ||
    max > 10 ||
    max < min
  )
    return 'Los límites de compra no son válidos.';
  if (!Number.isInteger(quantity) || quantity < min || quantity > max)
    return `Compra entre ${min} y ${max} unidades de esta oferta.`;
  for (const field of ['salesStartAt', 'salesEndAt']) {
    if (m[field] && !Number.isFinite(Date.parse(m[field])))
      return 'El horario de venta no es válido.';
  }
  if (m.salesStartAt && now < Date.parse(m.salesStartAt))
    return 'La venta de este tramo todavía no ha comenzado.';
  if (m.salesEndAt && now >= Date.parse(m.salesEndAt))
    return 'La venta de este tramo ha terminado.';
  if (
    offer.event_date &&
    Number(m.entryDeadlineMinutes) > 0 &&
    now >= Date.parse(offer.event_date) + Number(m.entryDeadlineMinutes) * 60000
  )
    return 'La hora límite de acceso ya ha pasado.';
  if (Number(offer.quantity) - Number(offer.sold || 0) < quantity)
    return 'No quedan suficientes unidades de esta oferta.';
  return null;
}
