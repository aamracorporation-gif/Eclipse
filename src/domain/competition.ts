import { ensure, integer } from './model.ts';
import type { Format, Sport, Row } from './model.ts';
export type Pair = { round: number; position: number; home: string | null; away: string | null };
export function fixtures(ids: string[], format: Format): Pair[] {
  ensure(ids.length >= 2 && new Set(ids).size === ids.length, 'ENTRANTS', 'Se necesitan al menos dos participantes diferentes.');
  if (format === 'challenge') {
    ensure(ids.length === 2, 'ENTRANTS', 'Un desafío necesita dos participantes.');
    return [{ round: 1, position: 0, home: ids[0], away: ids[1] }];
  }
  if (format === 'league') {
    const ring: (string | null)[] = [...ids];
    if (ring.length % 2) ring.push(null);
    const result: Pair[] = [];
    for (let round = 1; round < ring.length; round++) {
      for (let i = 0; i < ring.length / 2; i++) {
        let [home, away] = [ring[i], ring[ring.length - 1 - i]];
        if (round % 2 === 0) [home, away] = [away, home];
        if (home && away) result.push({ round, position: i, home, away });
      }
      ring.splice(1, 0, ring.pop()!);
    }
    return result;
  }
  const size = 2 ** Math.ceil(Math.log2(ids.length));
  // Spread byes across first-round pairs so there are never empty-v-empty matches.
  const byes = size - ids.length;
  const result: Pair[] = [];
  let cursor = 0;
  for (let i = 0; i < size / 2; i++) result.push({ round: 1, position: i, home: ids[cursor++], away: i < byes ? null : ids[cursor++] });
  for (let round = 2; round <= Math.log2(size); round++)
    for (let i = 0; i < size / 2 ** round; i++) result.push({ round, position: i, home: null, away: null });
  return result;
}
export type Score = { home: number; away: number; sets?: [number, number][]; tiebreak?: [number, number] };
export function validateScore(sport: Sport, format: Format, input: unknown): Score {
  ensure(input && typeof input === 'object', 'SCORE', 'Falta el marcador.');
  const s = input as Score;
  if (sport === 'padel' || sport === 'tennis') {
    ensure(Array.isArray(s.sets) && s.sets.length >= 2 && s.sets.length <= 3, 'SCORE', 'Usa dos o tres sets; formato al mejor de tres.');
    let home = 0, away = 0;
    for (const pair of s.sets) {
      ensure(home < 2 && away < 2, 'SCORE', 'Hay sets después del final del partido.');
      ensure(Array.isArray(pair) && pair.length === 2, 'SCORE', 'Cada set necesita dos resultados.');
      const [h, a] = pair;
      integer(h, 'Juegos local', 0, 7); integer(a, 'Juegos visitante', 0, 7);
      const hi = Math.max(h, a), lo = Math.min(h, a);
      ensure((hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6)), 'SCORE', 'Set no válido. Usa 6–0 a 6–4, 7–5 o 7–6.');
      h > a ? home++ : away++;
    }
    ensure(home === 2 || away === 2, 'SCORE', 'El ganador debe ganar dos sets.');
    return { home, away, sets: s.sets };
  }
  const home = integer(s.home, 'Marcador local', 0, 199), away = integer(s.away, 'Marcador visitante', 0, 199);
  if (home === away && (format !== 'league' || sport === 'basket3x3')) {
    ensure(sport === 'football7' && Array.isArray(s.tiebreak), 'TIE', 'Este partido necesita un ganador.');
    const h = integer(s.tiebreak[0], 'Penaltis local', 0, 99), a = integer(s.tiebreak[1], 'Penaltis visitante', 0, 99);
    ensure(h !== a, 'TIE', 'La tanda debe tener ganador.');
    return { home, away, tiebreak: [h, a] };
  }
  return { home, away };
}
export function winner(score: Score, home: string, away: string): string | null {
  const [h, a] = score.tiebreak ?? [score.home, score.away];
  return h === a ? null : h > a ? home : away;
}
export function standings(registrations: Row[], matches: Row[]) {
  const rows = new Map(registrations.filter(r => r.status === 'confirmed').map(r => [r.id, {
    id: r.id, name: r.display_name, played: 0, won: 0, drawn: 0, lost: 0, for: 0, against: 0, points: 0,
  }]));
  for (const m of matches) {
    if (m.status !== 'confirmed' || !m.score || !m.home || !m.away) continue;
    const h = rows.get(m.home), a = rows.get(m.away);
    if (!h || !a) continue;
    h.played++; a.played++; h.for += m.score.home; h.against += m.score.away; a.for += m.score.away; a.against += m.score.home;
    if (m.winner === m.home) { h.won++; h.points += 3; a.lost++; }
    else if (m.winner === m.away) { a.won++; a.points += 3; h.lost++; }
    else { h.drawn++; a.drawn++; h.points++; a.points++; }
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || (b.for - b.against) - (a.for - a.against) || b.for - a.for || a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id));
}
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const stamp = (s: string) => new Date(s).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z/, 'Z');
function fold(line: string) {
  const chunks: string[] = []; let current = '';
  for (const char of line) {
    if (new TextEncoder().encode(current + char).length > 73) { chunks.push(current); current = ' '; }
    current += char;
  }
  chunks.push(current); return chunks.join('\r\n');
}
export function calendar(title: string, matches: Row[], names: Record<string, string>, now = new Date().toISOString()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RONDIQO//Amateur Sport//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(title)}`];
  for (const m of matches.filter(m => m.starts_at && m.home && m.away)) lines.push(
    'BEGIN:VEVENT', `UID:${m.id}@rondiqo.local`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(m.starts_at)}`,
    `DTEND:${stamp(new Date(Date.parse(m.starts_at) + m.duration_minutes * 60000).toISOString())}`,
    `SUMMARY:${esc(`${names[m.home] ?? 'Participante'} vs ${names[m.away] ?? 'Participante'}`)}`,
    `LOCATION:${esc(m.court || '')}`, `SEQUENCE:${m.version}`, 'END:VEVENT');
  return [...lines, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}
