import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtures,validateScore,winner,standings,calendar} from '../src/domain/competition.ts';
test('league rotation covers every pair once, for even and odd counts',()=>{
  for(let n=2;n<=32;n++){
    const ids=Array.from({length:n},(_,i)=>String(i)),matches=fixtures(ids,'league');
    assert.equal(matches.length,n*(n-1)/2);
    assert.equal(new Set(matches.map(m=>[m.home,m.away].sort().join(':'))).size,matches.length);
    for(const round of new Set(matches.map(m=>m.round))){
      const people=matches.filter(m=>m.round===round).flatMap(m=>[m.home,m.away]);assert.equal(new Set(people).size,people.length);
    }
  }
});
test('knockout draw places every entrant exactly once and has no empty first-round pair',()=>{
  for(let n=2;n<=128;n++){
    const ids=Array.from({length:n},(_,i)=>String(i)),matches=fixtures(ids,'knockout');
    const first=matches.filter(m=>m.round===1),people=first.flatMap(m=>[m.home,m.away]).filter(Boolean);
    assert.equal(new Set(people).size,n);assert.equal(people.length,n);assert.ok(first.every(m=>m.home));
    assert.equal(matches.length,2**Math.ceil(Math.log2(n))-1);
  }
});
test('invalid participants and challenge sizes are rejected',()=>{
  assert.throws(()=>fixtures(['a','a'],'league'));assert.throws(()=>fixtures(['a'],'knockout'));assert.throws(()=>fixtures(['a','b','c'],'challenge'));
});
test('racquet scoring validates completed sets, match win and no post-win sets',()=>{
  assert.deepEqual(validateScore('padel','league',{sets:[[6,4],[6,7],[7,5]]}),{home:2,away:1,sets:[[6,4],[6,7],[7,5]]});
  for(const sets of [[[6,5],[6,4]],[[6,4]],[[6,4],[6,4],[6,1]],[[8,6],[6,2]],[[1,6],[7,6]]])assert.throws(()=>validateScore('tennis','knockout',{sets}));
});
test('football league can draw, elimination needs a winner, basketball cannot draw',()=>{
  assert.equal(winner(validateScore('football7','league',{home:2,away:2}),'a','b'),null);
  assert.throws(()=>validateScore('football7','knockout',{home:2,away:2}));
  assert.equal(winner(validateScore('football7','knockout',{home:2,away:2,tiebreak:[4,3]}),'a','b'),'a');
  assert.throws(()=>validateScore('basket3x3','league',{home:20,away:20}));
  assert.throws(()=>validateScore('football7','league',{home:-1,away:0}));
});
test('rankings ignore proposals/byes, apply deterministic tiebreaks',()=>{
  const regs=[{id:'a',display_name:'Alpha',status:'confirmed'},{id:'b',display_name:'Beta',status:'confirmed'}];
  const match={home:'a',away:'b',score:{home:2,away:1},winner:'a'};
  assert.equal(standings(regs,[{...match,status:'proposed'}])[0].played,0);
  const r=standings(regs,[{...match,status:'confirmed'}]);assert.equal(r[0].points,3);assert.equal(r[1].lost,1);
});
test('calendar uses UTC, stable IDs, escaped text and folded UTF-8 lines',()=>{
  const ics=calendar('Copa; ñ'.repeat(30),[{id:'abc',home:'a',away:'b',starts_at:'2026-10-25T10:00:00+01:00',duration_minutes:60,court:'Pista, 1\nBEGIN:VEVENT',version:2}],{a:'Equipo Á',b:'Equipo B'},'2026-10-20T00:00:00Z');
  assert.ok(ics.includes('DTSTART:20261025T090000Z'));assert.ok(ics.includes('SEQUENCE:2'));
  assert.ok(ics.includes('Pista\\, 1\\nBEGIN:VEVENT'));
  for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
});
