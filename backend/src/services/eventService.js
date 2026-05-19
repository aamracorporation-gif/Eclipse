const { supabaseAdmin } = require('./supabaseService');

async function createEvent({ creatorId, payload }) {
  const insertPayload = { ...payload, creator_id: creatorId };
  const { data, error } = await supabaseAdmin.from('events').insert(insertPayload).select('*').single();
  if (error) throw error;
  return data;
}

async function listEvents({ bbox } = {}) {
  if (bbox && bbox.enabled) {
    const { minLat, maxLat, minLng, maxLng, fromIso, toIso } = bbox;

    const venuesRes = await supabaseAdmin
      .from('venues')
      .select('id')
      .gte('latitude', minLat)
      .lte('latitude', maxLat)
      .gte('longitude', minLng)
      .lte('longitude', maxLng);
    if (venuesRes.error) throw venuesRes.error;
    const venueIds = (venuesRes.data || []).map((v) => v.id);
    if (!venueIds.length) return [];

    let q = supabaseAdmin
      .from('events')
      .select(
        `
          id,
          title,
          description,
          poster_url,
          venue_plan_url,
          event_date,
          ticket_price,
          available_tickets,
          sold_tickets,
          dress_code,
          age_restriction,
          theme,
          event_type,
          creator_id,
          updated_at,
          venues (name, latitude, longitude)
        `
      )
      .in('venue_id', venueIds);

    if (fromIso) q = q.gte('event_date', fromIso);
    if (toIso) q = q.lte('event_date', toIso);

    const { data, error } = await q.order('event_date', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  const { data, error } = await supabaseAdmin.from('events').select('*').order('event_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function getEventById(eventId) {
  const { data, error } = await supabaseAdmin.from('events').select('*').eq('id', eventId).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function updateEvent({ eventId, creatorId, updates }) {
  const existing = await getEventById(eventId);
  if (!existing) {
    const err = new Error('Event not found');
    err.status = 404;
    throw err;
  }
  if (String(existing.creator_id) !== String(creatorId)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const { data, error } = await supabaseAdmin.from('events').update(updates).eq('id', eventId).select('*').single();
  if (error) throw error;
  return data;
}

async function deleteEvent({ eventId, creatorId }) {
  const existing = await getEventById(eventId);
  if (!existing) {
    const err = new Error('Event not found');
    err.status = 404;
    throw err;
  }
  if (String(existing.creator_id) !== String(creatorId)) {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }

  const { error } = await supabaseAdmin.from('events').delete().eq('id', eventId);
  if (error) throw error;
  return { ok: true };
}

module.exports = { createEvent, listEvents, getEventById, updateEvent, deleteEvent };
