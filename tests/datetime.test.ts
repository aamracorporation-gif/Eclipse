import {test} from 'node:test';
import assert from 'node:assert/strict';
import {madridToIso,madridParts} from '../src/domain/datetime.ts';
import {newCompetitionDraft,competitionPayload} from '../src/domain/competitionDraft.ts';
test('Madrid dates use summer/winter offsets and reject DST gaps/ambiguity',()=>{
 assert.equal(madridToIso('2027-01-20','18:00'),'2027-01-20T17:00:00.000Z');
 assert.equal(madridToIso('2027-07-20','18:00'),'2027-07-20T16:00:00.000Z');
 assert.deepEqual(madridParts('2027-01-20T17:00:00.000Z'),{date:'2027-01-20',time:'18:00'});
 assert.throws(()=>madridToIso('2027-03-28','02:30'),/no existe/);
 assert.throws(()=>madridToIso('2027-10-31','02:30'),/se repite/);
 assert.throws(()=>madridToIso('2027-02-31','18:00'),/Revisa/);
});
test('wizard validates whole-team price, capacity and chronological registration cutoff',()=>{
 const draft={...newCompetitionDraft('club'),title:'Liga Sevilla',sport:'football7' as const,venue:'Campo central',format:'league' as const,price:'24,50'};
 const p=competitionPayload(draft);assert.equal(p.price_cents,2450);assert.equal(p.entry_mode,'team');
 assert.throws(()=>competitionPayload({...draft,capacity:'33'}),/32/);
 assert.throws(()=>competitionPayload({...draft,price:'24,505'}),/decimales/);
 assert.throws(()=>competitionPayload({...draft,closeDate:draft.startDate,closeTime:'23:59'}),/cierre/);
 assert.equal(competitionPayload({...draft,format:'challenge',capacity:'8'}).capacity,2);
});
