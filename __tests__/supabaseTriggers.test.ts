import { createClient } from '@supabase/supabase-js';

const shouldRun =
  !!process.env.SUPABASE_TEST_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

const describeDb = shouldRun ? describe : describe.skip;

describeDb('Supabase triggers (event updates/cancellations)', () => {
  const supabase = shouldRun
    ? createClient(
        process.env.SUPABASE_TEST_URL as string,
        process.env.SUPABASE_SERVICE_ROLE_KEY as string,
        {
          auth: { persistSession: false, autoRefreshToken: false },
        }
      )
    : (null as any);

  const createUser = async (email: string) => {
    const res = await supabase.auth.admin.createUser({
      email,
      password: 'Passw0rd!12345',
      email_confirm: true,
    });
    if (res.error) throw res.error;
    if (!res.data.user) throw new Error('Failed to create user');
    return res.data.user;
  };

  const deleteUser = async (id: string) => {
    const res = await supabase.auth.admin.deleteUser(id);
    if (res.error) throw res.error;
  };

  const getNotificationsForEvent = async (userId: string, eventId: string) => {
    const res = await supabase
      .from('notifications')
      .select('id, type, data, created_at')
      .eq('user_id', userId)
      .contains('data', { event_id: eventId });
    if (res.error) throw res.error;
    return res.data || [];
  };

  const purgeEventNotifications = async (eventId: string) => {
    await supabase
      .from('notifications')
      .delete()
      .contains('data', { event_id: eventId });
  };

  it('notifica a compradores en update (evento, venue, disponibilidad) y en delete (cancelación)', async () => {
    const suffix = Math.random().toString(16).slice(2);
    const organizer = await createUser(`org_${suffix}@test.local`);
    const buyerA = await createUser(`buyerA_${suffix}@test.local`);
    const buyerB = await createUser(`buyerB_${suffix}@test.local`);

    let venueId: string | null = null;
    let eventId: string | null = null;

    try {
      const venueRes = await supabase
        .from('venues')
        .insert({
          name: `Venue ${suffix}`,
          address: `Addr ${suffix}`,
          latitude: 40.4168,
          longitude: -3.7038,
        })
        .select('id')
        .single();
      if (venueRes.error) throw venueRes.error;
      venueId = venueRes.data.id;
      if (!venueId) throw new Error('Failed to create venue');

      const eventRes = await supabase
        .from('events')
        .insert({
          venue_id: venueId,
          title: `Event ${suffix}`,
          description: 'desc',
          poster_url: '',
          event_date: new Date(Date.now() + 86400000).toISOString(),
          ticket_price: 10,
          available_tickets: 100,
          creator_id: organizer.id,
        })
        .select('id')
        .single();
      if (eventRes.error) throw eventRes.error;
      eventId = eventRes.data.id;
      if (!eventId) throw new Error('Failed to create event');

      const tRes = await supabase.from('tickets').insert([
        {
          event_id: eventId,
          user_id: buyerA.id,
          buyer_name: 'A',
          buyer_email: buyerA.email,
          quantity: 1,
          total_price: 10,
          status: 'valid',
        },
        {
          event_id: eventId,
          user_id: buyerB.id,
          buyer_name: 'B',
          buyer_email: buyerB.email,
          quantity: 1,
          total_price: 10,
          status: 'valid',
        },
        {
          event_id: eventId,
          user_id: null,
          buyer_name: 'B-EMAIL-ONLY',
          buyer_email: buyerB.email,
          quantity: 1,
          total_price: 10,
          status: 'valid',
        },
      ]);
      if (tRes.error) throw tRes.error;

      await purgeEventNotifications(eventId);

      const updEvent = await supabase
        .from('events')
        .update({ title: `Event ${suffix} v2` })
        .eq('id', eventId);
      if (updEvent.error) throw updEvent.error;

      const a1 = await getNotificationsForEvent(buyerA.id, eventId);
      const b1 = await getNotificationsForEvent(buyerB.id, eventId);
      expect(a1.some((n: any) => n.type === 'event_updated')).toBe(true);
      expect(b1.some((n: any) => n.type === 'event_updated')).toBe(true);

      await purgeEventNotifications(eventId);

      const updVenue = await supabase
        .from('venues')
        .update({ name: `Venue ${suffix} moved` })
        .eq('id', venueId);
      if (updVenue.error) throw updVenue.error;

      const a2 = await getNotificationsForEvent(buyerA.id, eventId);
      const b2 = await getNotificationsForEvent(buyerB.id, eventId);
      expect(a2.some((n: any) => n.type === 'event_location_changed')).toBe(true);
      expect(b2.some((n: any) => n.type === 'event_location_changed')).toBe(true);

      await purgeEventNotifications(eventId);

      const updAvailability = await supabase
        .from('events')
        .update({ available_tickets: 150 })
        .eq('id', eventId);
      if (updAvailability.error) throw updAvailability.error;

      const a3 = await getNotificationsForEvent(buyerA.id, eventId);
      expect(a3.some((n: any) => n.type === 'event_capacity_or_price_changed')).toBe(true);

      await purgeEventNotifications(eventId);

      const purchaseLike = await supabase
        .from('events')
        .update({ available_tickets: 149, sold_tickets: 1 })
        .eq('id', eventId);
      if (purchaseLike.error) throw purchaseLike.error;

      const a4 = await getNotificationsForEvent(buyerA.id, eventId);
      expect(a4.length).toBe(0);

      const delEvent = await supabase.from('events').delete().eq('id', eventId);
      if (delEvent.error) throw delEvent.error;

      const a5 = await getNotificationsForEvent(buyerA.id, eventId);
      expect(a5.some((n: any) => n.type === 'event_cancelled')).toBe(true);
    } finally {
      if (eventId) {
        await purgeEventNotifications(eventId);
        await supabase.from('tickets').delete().eq('event_id', eventId);
        await supabase.from('reservados_vip').delete().eq('event_id', eventId);
      }
      if (venueId) {
        await supabase.from('venues').delete().eq('id', venueId);
      }
      await deleteUser(buyerA.id);
      await deleteUser(buyerB.id);
      await deleteUser(organizer.id);
    }
  }, 120000);
});
