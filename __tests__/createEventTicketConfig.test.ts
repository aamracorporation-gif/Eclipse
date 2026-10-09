import {
  buildTicketName,
  createEmptyTicketDraft,
  getTicketDraftErrors,
  serializeTicketMetadata,
  offerFromRow,
} from '@/lib/createEventTicketConfig';
import {
  resolveTicketProduct,
  offerUnavailableReason,
} from '@/supabase/functions/_shared/ticketProduct';
const draft = () => ({
  ...createEmptyTicketDraft(),
  name: 'Entrada',
  price: '20',
  quantity: '100',
});
describe('Nightlife catalogue', () => {
  it('only accepts VIP as an actual table', () => {
    const v = { ...draft(), category: 'vip' as any };
    expect(getTicketDraftErrors(v).category).toBeTruthy();
    expect(
      getTicketDraftErrors({ ...draft(), name: 'Entrada VIP' }).name,
    ).toBeTruthy();
  });
  it('serializes a table with capacity and bottles, without inventing a second VIP', () => {
    const v = {
      ...draft(),
      name: 'Mesa Eclipse',
      category: 'vip_table' as const,
      vipGroupSize: '6',
      vipFreeBottles: [{ brand: 'Botella', quantity: '1' }],
    };
    expect(getTicketDraftErrors(v)).toEqual({});
    expect(serializeTicketMetadata(v)).toMatchObject({
      productKind: 'vip_table',
      vipGroupSize: 6,
      maxPerOrder: 1,
      vipBottles: [{ brand: 'Botella', quantity: 1 }],
    });
    expect(buildTicketName(v)).toBe('Mesa Eclipse');
  });
  it('rejects incomplete bottles, undersized groups, invalid schedules and order bounds', () => {
    expect(
      getTicketDraftErrors({
        ...draft(),
        category: 'vip_table',
        vipGroupSize: '25',
        vipFreeBottles: [{ brand: '', quantity: '0' }],
      }),
    ).toHaveProperty('vipGroupSize');
    expect(
      getTicketDraftErrors({
        ...draft(),
        category: 'group',
        admissionsPerUnit: '1',
      }),
    ).toHaveProperty('admissionsPerUnit');
    expect(
      getTicketDraftErrors({
        ...draft(),
        salesStartAt: '2027-01-02',
        salesEndAt: '2027-01-01',
      }),
    ).toHaveProperty('salesEndAt');
    expect(
      getTicketDraftErrors({ ...draft(), minPerOrder: '4', maxPerOrder: '2' }),
    ).toHaveProperty('maxPerOrder');
  });
  it('keeps price phases separate from access and retains paid entry deadlines', () => {
    const m = serializeTicketMetadata({
      ...draft(),
      salePhase: 'Primer tramo',
      entryDeadlineMinutes: '120',
      includedDrinks: '2',
    });
    expect(m).toMatchObject({
      category: 'general',
      salePhase: 'Primer tramo',
      entryDeadlineMinutes: 120,
      includedDrinks: 2,
    });
  });
  it('sells invitations for zero and groups by complete pack', () => {
    expect(
      getTicketDraftErrors({ ...draft(), category: 'free', price: '20' }).price,
    ).toBeTruthy();
    expect(
      getTicketDraftErrors({ ...draft(), category: 'free', price: '0' }),
    ).toEqual({});
    expect(
      serializeTicketMetadata({
        ...draft(),
        category: 'group',
        admissionsPerUnit: '4',
      }),
    ).toMatchObject({ admissionsPerUnit: 4 });
  });
  it('round trips remaining table stock without silently restoring purchased tables', () => {
    const v = offerFromRow(
      {
        id: 'table',
        name: 'Mesa',
        base_price: 200,
        quantity_available: 3,
        capacity_people: 6,
        included_bottles: 1,
      },
      true,
    );
    expect(v.category).toBe('vip_table');
    expect(v.originalMetadata?.catalogAvailable).toBe(3);
  });
});
describe('Purchase presentation and availability', () => {
  it('shows an actual table correctly without any event_ticket_types relation', () => {
    expect(
      resolveTicketProduct({
        ticket_type: null,
        product_snapshot: {
          kind: 'vip_table',
          category: 'vip_table',
          name: 'Mesa Eclipse',
          metadata: {
            vipGroupSize: 6,
            vipBottles: [{ brand: 'Botella', quantity: 1 }],
          },
        },
        events: { event_ticket_types: [] },
      }),
    ).toMatchObject({
      visual: 'vip',
      kind: 'vip_table',
      name: 'Mesa Eclipse',
      metadata: { vipGroupSize: 6 },
    });
  });
  it('prefers the sold snapshot over a renamed or deleted catalogue offer', () => {
    expect(
      resolveTicketProduct({
        product_snapshot: {
          kind: 'admission',
          category: 'backstage',
          name: 'Cabina',
          metadata: {},
        },
        event_ticket_types: { category: 'general', name: 'Edited' },
      }),
    ).toMatchObject({ name: 'Cabina', visual: 'backstage' });
  });
  it('supports both relation shapes and fast_lane spelling', () => {
    expect(
      resolveTicketProduct({
        event_ticket_types: [{ category: 'fast_lane', name: 'Acceso rápido' }],
      }).visual,
    ).toBe('fastlane');
    expect(
      resolveTicketProduct({
        ticket_type_id: 'x',
        events: {
          event_ticket_types: [
            { id: 'x', category: 'early', name: 'Anticipada' },
          ],
        },
      }).visual,
    ).toBe('general');
  });
  it('rejects retired VIP, inactive, future and ended sales before Stripe', () => {
    const o = { quantity: 10, sold: 0, category: 'general', is_active: true };
    expect(offerUnavailableReason({ ...o, category: 'vip' }, 1)).toContain(
      'mesa',
    );
    expect(offerUnavailableReason({ ...o, is_active: false }, 1)).toBeTruthy();
    expect(
      offerUnavailableReason(
        { ...o, metadata: { salesStartAt: '2027-01-01' } },
        1,
        Date.parse('2026-10-06'),
      ),
    ).toBeTruthy();
    expect(
      offerUnavailableReason(
        { ...o, metadata: { salesEndAt: '2026-01-01' } },
        1,
        Date.parse('2026-10-06'),
      ),
    ).toBeTruthy();
  });
  it('checks minimum, maximum, available stock and access deadline', () => {
    const o = {
      quantity: 8,
      sold: 6,
      metadata: { minPerOrder: 2, maxPerOrder: 4 },
    };
    expect(offerUnavailableReason(o, 1)).toBeTruthy();
    expect(offerUnavailableReason(o, 3)).toBeTruthy();
    expect(offerUnavailableReason(o, 2)).toBeNull();
    expect(
      offerUnavailableReason(
        {
          quantity: 10,
          event_date: '2026-10-06T20:00Z',
          metadata: { entryDeadlineMinutes: 60 },
        },
        1,
        Date.parse('2026-10-06T21:01Z'),
      ),
    ).toBeTruthy();
  });
});
