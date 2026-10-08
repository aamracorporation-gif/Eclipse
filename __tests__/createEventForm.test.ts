import { getEventDraftErrors, eventStepForField, type EventDraft } from '@/lib/createEventForm';
import { createEmptyTicketDraft, getTicketDraftErrors, getCatalogSummary, hasPendingOffer, offerFromRow, prepareOfferForCatalog, serializeTicketMetadata } from '@/lib/createEventTicketConfig';

const now = new Date('2026-10-06T16:00:00Z');
const event = (): EventDraft => ({ title: 'Eclipse', description: 'Música en directo', location: 'Málaga', coordinates: { latitude: 36.72, longitude: -4.42 }, imageUri: 'https://example.com/poster.png', venuePlanUri: '', theme: '', dressCode: '', ageRestriction: '18', eventType: 'party', allowResale: false, dateTime: new Date('2026-10-10T21:30:00Z'), endDateTime: new Date('2026-10-11T04:00:00Z') });
const offer = () => ({...createEmptyTicketDraft(), name: 'Entrada', price: '20', quantity: '100'});

describe('Event creation and editing flow', () => {
  it('accepts an overnight event without optional information', () => {
    expect(getEventDraftErrors(event(), false, now, 1)).toEqual({});
  });
  it('rejects a missing pin, same-day ending before opening and missing catalogue', () => {
    const errors = getEventDraftErrors({...event(), coordinates: null, endDateTime: new Date('2026-10-10T04:00:00Z')}, false, now, 0);
    expect(errors.coordinates).toBeTruthy();
    expect(errors.endDateTime).toBeTruthy();
    expect(errors.ticketTypes).toBeTruthy();
    expect(eventStepForField('coordinates')).toBe(1);
    expect(eventStepForField('ticketTypes')).toBe(2);
  });
  it('requires the poster and valid age on both new and edited events', () => {
    for (const editing of [false, true]) {
      const errors = getEventDraftErrors({...event(), imageUri: '', ageRestriction: 'abc'}, editing, now, 1);
      expect(errors.imageUri).toBeTruthy();
      expect(errors.ageRestriction).toBeTruthy();
    }
  });
  it('rejects past new events but allows editing an existing past start', () => {
    const draft = {...event(), dateTime: new Date('2026-10-01T21:00:00Z')};
    expect(getEventDraftErrors(draft, false, now, 1).dateTime).toBeTruthy();
    expect(getEventDraftErrors(draft, true, now, 1).dateTime).toBeUndefined();
  });
  it('detects unfinished offers even when only a condition or category changed', () => {
    expect(hasPendingOffer(createEmptyTicketDraft())).toBe(false);
    expect(hasPendingOffer({...createEmptyTicketDraft(), benefits:'Una bebida'})).toBe(true);
    expect(hasPendingOffer({...createEmptyTicketDraft(), category:'group'})).toBe(true);
  });
  it('saves a sold-out existing table without silently adding stock', () => {
    const table = offerFromRow({id:'table',name:'Mesa Eclipse',quantity_available:0,base_price:300,capacity_people:6}, true);
    expect(prepareOfferForCatalog(table)?.quantity).toBe('0');
    expect(prepareOfferForCatalog({...table,id:'draft'})).toBeNull();
  });
  it('prevents total stock falling below sales and does not serialize editor counters', () => {
    const loaded = offerFromRow({id:'entry',name:'Entrada',price:20,quantity:100,sold:30});
    expect(getTicketDraftErrors({...loaded,quantity:'29'}).quantity).toBeTruthy();
    expect(getTicketDraftErrors({...loaded,quantity:'30'})).toEqual({});
    expect(serializeTicketMetadata(loaded)).not.toHaveProperty('catalogSold');
  });
  it('counts available people independently of selling units, packs and tables', () => {
    const summary = getCatalogSummary([
      {...offer(), originalMetadata:{catalogSold:20}},
      {...offer(),category:'group',quantity:'10',admissionsPerUnit:'4',originalMetadata:{catalogSold:3}},
      {...offer(),category:'vip_table',quantity:'2',vipGroupSize:'6'},
    ]);
    expect(summary).toEqual({tickets:80,packs:7,tables:2,people:120});
  });
  it('rejects impossible minimum orders and marks the relevant fields', () => {
    expect(getTicketDraftErrors({...offer(), minPerOrder:'0'}).minPerOrder).toBeTruthy();
    expect(getTicketDraftErrors({...offer(), minPerOrder:'5',quantity:'4'}).quantity).toBeTruthy();
    expect(getTicketDraftErrors({...offer(), minPerOrder:'5', maxPerOrder:'3'}).maxPerOrder).toBeTruthy();
  });
});
