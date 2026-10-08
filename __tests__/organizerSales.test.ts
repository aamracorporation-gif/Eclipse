import { loadOrganizerSales, periodSales, salesPeriodStart } from '../lib/organizerSales';

describe('organizer sales periods', () => {
  const now = new Date(2026, 9, 8, 12);
  const sale = (day: number, amount = 10) => ({ date: new Date(2026, 9, day, 10).toISOString(), amount, qty: 1 });
  const sales = [sale(1), sale(5), sale(8), sale(9), { ...sale(8), date: 'invalid' }];
  it('uses the same calendar boundaries for totals and the chart, excluding future/invalid dates', () => {
    expect(periodSales(sales, 'day', now)).toEqual([sales[2]]);
    expect(periodSales(sales, 'week', now)).toEqual([sales[1], sales[2]]);
    expect(periodSales(sales, 'month', now)).toEqual(sales.slice(0, 3));
  });
  it('starts weeks on Monday and handles month/year rollover', () => {
    expect(salesPeriodStart('week', new Date(2027, 0, 3, 23))).toEqual(new Date(2026, 11, 28));
    expect(salesPeriodStart('month', new Date(2027, 0, 31))).toEqual(new Date(2027, 0, 1));
    expect(now).toEqual(new Date(2026, 9, 8, 12));
  });
});

describe('organizer sales loading', () => {
  function database(pages: any[]) {
    const query: any = { select: jest.fn(() => query), eq: jest.fn(() => query), order: jest.fn(() => query), range: jest.fn() };
    for (const page of pages) query.range.mockResolvedValueOnce(page);
    return { from: jest.fn(() => query), query };
  }
  it('loads sales independently of the public feed, only for the current owner and paid tickets', async () => {
    const db = database([{ data: [{ purchase_date: '2026-10-08', total_price: '25', quantity: 2 }], error: null }]);
    await expect(loadOrganizerSales(db, 'owner')).resolves.toEqual([{ date: '2026-10-08', amount: 25, qty: 2 }]);
    expect(db.query.eq.mock.calls).toEqual([['events.creator_id', 'owner'], ['payment_status', 'paid']]);
    expect(db.query.select.mock.calls[0][0]).toContain('events!inner');
  });
  it('does not silently truncate accounts with more than one response page', async () => {
    const row = { purchase_date: '2026-10-08', total_price: '10', quantity: 1 };
    const db = database([{ data: Array(500).fill(row) }, { data: [{ ...row, quantity: null }] }]);
    const sales = await loadOrganizerSales(db, 'owner');
    expect(sales).toHaveLength(501);
    expect(sales.reduce((sum, s) => sum + s.amount, 0)).toBe(5010);
    expect(db.query.range.mock.calls).toEqual([[0, 499], [500, 999]]);
  });
  it('returns a real empty state and propagates failures instead of reporting zero sales', async () => {
    await expect(loadOrganizerSales(database([{ data: [] }]), 'owner')).resolves.toEqual([]);
    const error = { message: 'offline' };
    await expect(loadOrganizerSales(database([{ error }]), 'owner')).rejects.toBe(error);
  });
});
