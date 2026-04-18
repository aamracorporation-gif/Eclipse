const { supabaseAdmin } = require('./supabaseService');

async function createEvent({ creatorId, payload }) {
  const insertPayload = { ...payload, creator_id: creatorId };
  const { data, error } = await supabaseAdmin.from('events').insert(insertPayload).select('*').single();
  if (error) throw error;
  return data;
}

async function listEvents() {
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
