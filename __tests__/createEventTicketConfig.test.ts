import {
  buildTicketName,
  createEmptyTicketDraft,
  getTicketDraftErrors,
  serializeTicketMetadata,
} from '@/lib/createEventTicketConfig';

describe('createEventTicketConfig', () => {
  it('valida campos VIP condicionales', () => {
    const ticket = createEmptyTicketDraft();
    ticket.category = 'vip';
    ticket.name = 'Mesa Oro';
    ticket.price = '250';
    ticket.quantity = '5';
    ticket.vipGroupSize = '25';
    ticket.vipFreeBottles = [{ brand: 'Belvedere', quantity: '0' }];

    const errors = getTicketDraftErrors(ticket);
    expect(errors.vipGroupSize).toContain('1 y 20');
    expect(errors['bottle.0.quantity']).toBeTruthy();
  });

  it('acepta un ticket VIP válido y serializa botellas', () => {
    const ticket = createEmptyTicketDraft();
    ticket.category = 'vip';
    ticket.name = 'Mesa Diamante';
    ticket.price = '400';
    ticket.quantity = '2';
    ticket.benefits = 'Acceso privado';
    ticket.featured = true;
    ticket.vipGroupSize = '5';
    ticket.vipFreeBottles = [
      { brand: 'Belvedere', quantity: '2' },
      { brand: 'Moët', quantity: '1' },
    ];

    const errors = getTicketDraftErrors(ticket);
    expect(errors).toEqual({});

    const metadata = serializeTicketMetadata(ticket);
    expect(metadata.category).toBe('vip');
    expect((metadata as any).vipGroupSize).toBe(5);
    expect((metadata as any).vipBottles).toHaveLength(2);
  });

  it('valida campos específicos de general, early y backstage', () => {
    const general = createEmptyTicketDraft();
    general.category = 'general';
    general.name = 'General pista';
    general.price = '25';
    general.quantity = '100';
    expect(getTicketDraftErrors(general).generalAccessZone).toBeTruthy();

    const early = createEmptyTicketDraft();
    early.category = 'early';
    early.name = 'Early';
    early.price = '15';
    early.quantity = '80';
    early.earlyEntryMinutes = '2';
    expect(getTicketDraftErrors(early).earlyEntryMinutes).toBeTruthy();

    const backstage = createEmptyTicketDraft();
    backstage.category = 'backstage';
    backstage.name = 'Backstage';
    backstage.price = '120';
    backstage.quantity = '10';
    backstage.backstageMeetGreet = true;
    expect(getTicketDraftErrors(backstage).backstageHost).toBeTruthy();
  });

  it('compone un nombre legible para la entrada', () => {
    const ticket = createEmptyTicketDraft();
    ticket.category = 'vip';
    ticket.name = 'Mesa';
    ticket.featured = true;
    ticket.benefits = 'Botella incluida';

    expect(buildTicketName(ticket)).toContain('Premium');
    expect(buildTicketName(ticket)).toContain('VIP');
    expect(buildTicketName(ticket)).toContain('Botella incluida');
  });
});
