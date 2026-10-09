import { createEmptyTicketDraft, getTicketDraftErrors, parsePositiveNumber, parsePositiveInt, serializeTicketMetadata } from '../lib/createEventTicketConfig';
describe('free ticket creation', () => {
 const free = () => ({ ...createEmptyTicketDraft(), name: 'Gratis', price: '0', quantity: '50', generalAccessZone: 'Pista', entryDeadlineMinutes: '120' });
 test.each(['0', '0.00', '0,00'])('accepts explicit zero %s', value => expect(parsePositiveNumber(value)).toBe(0));
 test.each(['', ' ', '-1', 'NaN', 'Infinity', '0.001', '0x10'])('rejects invalid money %s', value => expect(parsePositiveNumber(value)).toBeNull());
 test('capacity remains positive', () => expect(parsePositiveInt('0')).toBeNull());
 test('free ticket can be submitted and retains cutoff', () => { expect(getTicketDraftErrors(free())).toEqual({}); expect(serializeTicketMetadata(free()).entryDeadlineMinutes).toBe(120); });
 test('paid ticket minimum is retained', () => expect(getTicketDraftErrors({...free(),price:'0.25'}).price).toBeTruthy());
 test.each(['-1','0','1441','abc'])('rejects invalid cutoff %s', entryDeadlineMinutes => expect(getTicketDraftErrors({...free(),entryDeadlineMinutes}).entryDeadlineMinutes).toBeTruthy());
});
