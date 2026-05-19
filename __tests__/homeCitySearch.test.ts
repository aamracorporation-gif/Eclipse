import { filterEventsByQuery } from '@/lib/validators';

describe('home city search filtering', () => {
  const events: any[] = [
    { id: '1', title: 'Fiesta A', location: 'Madrid', description: '', eventType: 'fiesta' },
    { id: '2', title: 'Fiesta B', location: 'Barcelona', description: '', eventType: 'fiesta' },
    { id: '3', title: 'Fiesta C', location: 'Malaga', description: '', eventType: 'fiesta' },
  ];

  it('filters in real time for partial queries', () => {
    const out = filterEventsByQuery(events, 'ma');
    expect(out.map((e) => e.id).sort()).toEqual(['1', '3']);
  });

  it('filters for full city query', () => {
    const out = filterEventsByQuery(events, 'madrid');
    expect(out.map((e) => e.id)).toEqual(['1']);
  });

  it('updates correctly when deleting partially', () => {
    const full = filterEventsByQuery(events, 'madrid');
    expect(full.map((e) => e.id)).toEqual(['1']);

    const partial = filterEventsByQuery(events, 'ma');
    expect(partial.map((e) => e.id).sort()).toEqual(['1', '3']);
  });

  it('returns all events when query is cleared', () => {
    const out = filterEventsByQuery(events, '');
    expect(out.length).toBe(3);
  });

  it('returns empty only when there are no matches', () => {
    const out = filterEventsByQuery(events, 'zzzzz');
    expect(out).toEqual([]);
  });
});

