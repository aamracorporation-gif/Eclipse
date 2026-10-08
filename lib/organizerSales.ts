export type SalesRange = 'day' | 'week' | 'month';
export type OrganizerSale = { date: string; amount: number; qty: number };

// Calendar periods in the device's local timezone, shared by totals and chart.
export function salesPeriodStart(range: SalesRange, now: Date): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (range === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (range === 'month') start.setDate(1);
  return start;
}

export function periodSales(data: OrganizerSale[], range: SalesRange, now: Date) {
  const start = salesPeriodStart(range, now).getTime();
  return data.filter(sale => {
    const date = new Date(sale.date).getTime();
    return date >= start && date <= now.getTime();
  });
}

// Query ownership at the database, including past/unpublished events absent from the public feed.
// Keep RLS enabled and paginate: PostgREST caps rows in a single response.
export async function loadOrganizerSales(client: any, organizerId: string): Promise<OrganizerSale[]> {
  const sales: OrganizerSale[] = [];
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from('tickets')
      .select('id,purchase_date,total_price,quantity,events!inner(creator_id)')
      .eq('events.creator_id', organizerId).eq('payment_status', 'paid')
      .order('id', { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    for (const row of data || []) {
      sales.push({ date: row.purchase_date, amount: Number(row.total_price) || 0,
        qty: row.quantity == null ? 1 : Math.max(0, Number(row.quantity) || 0) });
    }
    if (!data || data.length < pageSize) return sales;
  }
}
