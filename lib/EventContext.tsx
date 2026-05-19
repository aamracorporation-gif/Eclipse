import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { supabase, Event } from '@/lib/supabase';
import i18n from '@/lib/i18n';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { invokeEdgeFunction, invokeEdgeFunctionStrict } from '@/lib/edgeFunctions';

export type TicketType = {
  id: string;
  name: string;
  price: number;
  quantity: number;
  sold: number;
};

// Extended Event type to include local-only fields if needed, or just match Supabase
export type AppEvent = {
  id: string;
  title: string;
  startsAt?: string;
  updatedAt?: string;
  date: string; // YYYY-MM-DD
  time: string;
  location: string;
  price: string;
  capacity: number;
  sold: number;
  imageUrl: string;
  venuePlanUrl?: string;
  description: string;
  theme?: string;
  ageRestriction?: string;
  dressCode?: string;
  eventType?: string;
  creatorId?: string; // To link to the creator
  creatorProfile?: {
    id?: string;
    full_name?: string | null;
    club_name?: string | null;
    verification_status?: 'pending_verification' | 'verified' | 'rejected' | null;
  };
  ticketTypes: TicketType[];
  venues?: {
    latitude: number;
    longitude: number;
    name?: string;
  };
};

const INITIAL_EVENTS: AppEvent[] = [];

type EventContextType = {
  events: AppEvent[];
  addEvent: (event: Omit<AppEvent, 'id' | 'sold'>) => Promise<string>;
  updateEvent: (id: string, updates: Partial<AppEvent>, expectedUpdatedAt?: string | null) => Promise<string | null>;
  deleteEvent: (id: string) => Promise<void>;
  getEventById: (id: string) => AppEvent | undefined;
  refreshEvents: () => Promise<void>;
};

const EventContext = createContext<EventContextType>({
  events: [],
  addEvent: async () => '',
  updateEvent: async () => null,
  deleteEvent: async () => {},
  getEventById: () => undefined,
  refreshEvents: async () => {},
});

export const useEvents = () => useContext(EventContext);

export function __test_shouldApplyRemoteEvents(prevCount: number, remoteCount: number, lastGoodAtMs: number, nowMs: number) {
  const seventyTwoHoursMs = 72 * 60 * 60 * 1000;
  if (remoteCount === 0 && prevCount > 0 && nowMs - lastGoodAtMs < seventyTwoHoursMs) return false;
  return true;
}

export function EventProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<AppEvent[]>(INITIAL_EVENTS);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchInFlightRef = useRef(false);
  const fetchQueuedRef = useRef(false);
  const cacheKey = 'events_cache_v1';
  const cacheTsKey = 'events_cache_v1_ts';
  const lastGoodAtRef = useRef(0);
  const eventsCountRef = useRef(0);

  useEffect(() => {
    eventsCountRef.current = events.length;
  }, [events.length]);

  useEffect(() => {
    AsyncStorage.multiGet([cacheKey, cacheTsKey])
      .then((pairs) => {
        const map = new Map(pairs);
        const raw = map.get(cacheKey);
        const rawTs = map.get(cacheTsKey);
        const ts = rawTs ? Number(rawTs) : 0;
        if (Number.isFinite(ts) && ts > 0) lastGoodAtRef.current = ts;
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setEvents(parsed as AppEvent[]);
        } catch {}
      })
      .catch(() => {});
  }, []);

  const fetchEventsQuery = useCallback(async (includeVerificationStatus: boolean) => {
    return supabase
      .from('events')
      .select(
        `
          *,
          venues (*),
          event_ticket_types (*),
          profiles!events_creator_id_fkey_profiles (
            id,
            full_name,
            club_name${includeVerificationStatus ? ',\n            verification_status' : ''}
          )
        `
      )
      .order('event_date', { ascending: true });
  }, []);

  const fetchEvents = useCallback(async () => {
    if (fetchInFlightRef.current) {
      fetchQueuedRef.current = true;
      return;
    }
    fetchInFlightRef.current = true;
    try {
      let data: any[] | null = null;
      let error: any = null;

      {
        const res = await fetchEventsQuery(true);
        data = res.data as any;
        error = res.error as any;
      }

      if (error?.code === '42703' && String(error?.message || '').includes('verification_status')) {
        const res = await fetchEventsQuery(false);
        data = res.data as any;
        error = res.error as any;
      }

      if (error) throw error;

      if (data) {
        const mappedEvents: AppEvent[] = data.map((e: any) => {
          const lang = String(i18n.language || 'es').split('-')[0];
          const localeTag = lang === 'en' ? 'en-US' : lang === 'fr' ? 'fr-FR' : 'es-ES';
          const eventDate = new Date(e.event_date);
          const creatorProfile = Array.isArray(e.profiles) ? e.profiles[0] : e.profiles;
          const pad2 = (n: number) => String(n).padStart(2, '0');
          const localDate = `${eventDate.getFullYear()}-${pad2(eventDate.getMonth() + 1)}-${pad2(eventDate.getDate())}`;
          return {
            id: e.id,
            title: e.title,
            startsAt: e.event_date,
            updatedAt: e.updated_at || null,
            date: localDate,
            time: eventDate.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' }),
            location: e.venues?.name || 'Ubicación desconocida',
            price: e.ticket_price.toString(),
            capacity: e.available_tickets, // Use actual available count
            sold: e.sold_tickets || 0,
            imageUrl: e.poster_url || 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg',
            venuePlanUrl: e.venue_plan_url,
            description: e.description,
            theme: e.theme,
            ageRestriction: e.age_restriction?.toString(),
            dressCode: e.dress_code,
            eventType: e.event_type,
            creatorId: e.creator_id, // Ensure this is mapped
            creatorProfile: creatorProfile
              ? {
                  id: creatorProfile.id,
                  full_name: creatorProfile.full_name ?? null,
                  club_name: creatorProfile.club_name ?? null,
                  verification_status: creatorProfile.verification_status ?? null,
                }
              : undefined,
            ticketTypes: e.event_ticket_types
              ? (e.event_ticket_types as any[])
                  .filter((t: any) => !t?.deleted_at && (t?.is_active ?? true))
                  .map((t: any) => ({
                    id: t.id,
                    name: t.name,
                    price: t.price,
                    quantity: t.quantity,
                    sold: t.sold,
                  }))
              : [],
            venues: e.venues ? {
              latitude: e.venues.latitude,
              longitude: e.venues.longitude,
              name: e.venues.name
            } : undefined
          };
        });
        const nowMs = Date.now();
        const shouldApply = __test_shouldApplyRemoteEvents(eventsCountRef.current, mappedEvents.length, lastGoodAtRef.current || 0, nowMs);
        if (shouldApply) {
          setEvents(mappedEvents);
          if (mappedEvents.length > 0) {
            lastGoodAtRef.current = nowMs;
            AsyncStorage.multiSet([[cacheKey, JSON.stringify(mappedEvents)], [cacheTsKey, String(nowMs)]]).catch(() => {});
          }
        }
      }
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      fetchInFlightRef.current = false;
      if (fetchQueuedRef.current) {
        fetchQueuedRef.current = false;
        if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = setTimeout(() => {
          fetchEvents();
        }, 900);
      }
    }
  }, [fetchEventsQuery]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => {
      fetchEvents();
    }, 900);
  }, [fetchEvents]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    const channel = supabase
      .channel('events-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'events',
        },
        () => {
          scheduleRefresh();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'event_ticket_types',
        },
        () => {
          scheduleRefresh();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'venues',
        },
        () => {
          scheduleRefresh();
        }
      )
      .subscribe();

    return () => {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [scheduleRefresh]);

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    };
  }, []);

  const addEvent = async (newEvent: Omit<AppEvent, 'id' | 'sold'>) => {
    try {
      if (!newEvent.creatorId) {
        throw new Error('No se ha podido identificar al creador del evento.');
      }

      let creatorProfile: any = null;
      let creatorError: any = null;

      {
        const res = await supabase.from('profiles').select('role, verification_status').eq('id', newEvent.creatorId).maybeSingle();
        creatorProfile = res.data as any;
        creatorError = res.error as any;
      }

      if (creatorError?.code === '42703' && String(creatorError?.message || '').includes('verification_status')) {
        const res = await supabase.from('profiles').select('role').eq('id', newEvent.creatorId).maybeSingle();
        creatorProfile = res.data as any;
        creatorError = res.error as any;
      }

      if (creatorError) throw creatorError;

      if (creatorProfile?.role !== 'organizer') {
        throw new Error('Debes ser organizador para crear eventos.');
      }

      if ('verification_status' in (creatorProfile || {}) && creatorProfile?.verification_status !== 'verified') {
        throw new Error('Tu cuenta de organizador está pendiente de verificación. Nuestro equipo revisará tus documentos en breve.');
      }

      // 1. Create Venue first (simplified strategy: always create new venue for custom events)
      // In a real app, you'd select from existing venues
      const { data: venueData, error: venueError } = await supabase
        .from('venues')
        .insert({
          name: newEvent.location,
          address: newEvent.location, // Fallback
          latitude: newEvent.venues?.latitude || 0,
          longitude: newEvent.venues?.longitude || 0,
          description: 'Custom event venue',
          image_url: ''
        })
        .select()
        .single();

      if (venueError) throw venueError;

      // 2. Create Event
      const eventDate = new Date(`${newEvent.date}T${newEvent.time}`);
      
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .insert({
          venue_id: venueData.id,
          creator_id: newEvent.creatorId,
          title: newEvent.title,
          description: newEvent.description,
          poster_url: newEvent.imageUrl,
          venue_plan_url: newEvent.venuePlanUrl,
          event_date: eventDate.toISOString(),
          ticket_price: parseFloat(newEvent.price), // Using the display price (min price)
          available_tickets: newEvent.capacity,
          sold_tickets: 0,
          dress_code: newEvent.dressCode,
          age_restriction: parseInt(newEvent.ageRestriction || '18'),
          theme: newEvent.theme,
          event_type: newEvent.eventType
        })
        .select()
        .single();

      if (eventError) throw eventError;

      // 3. Create Ticket Types
      if (newEvent.ticketTypes && newEvent.ticketTypes.length > 0) {
        const ticketTypesToInsert = newEvent.ticketTypes.map(t => ({
          event_id: eventData.id,
          name: t.name,
          price: t.price,
          quantity: t.quantity,
          sold: 0
        }));

        const { error: ticketsError } = await supabase
          .from('event_ticket_types')
          .insert(ticketTypesToInsert);

        if (ticketsError) {
          console.error('Error creating ticket types:', ticketsError);
          throw ticketsError;
        }
      }

      // 4. Update local state
      await fetchEvents();
      return eventData.id;
    } catch (error) {
      console.error('Error adding event:', error);
      throw error;
    }
  };

  const updateEvent = async (id: string, updates: Partial<AppEvent>, expectedUpdatedAt?: string | null) => {
    try {
      const isUuid = (value: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

      // Map updates to DB schema
      const dbUpdates: any = {};
      if (updates.title !== undefined) dbUpdates.title = updates.title;
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.imageUrl !== undefined) dbUpdates.poster_url = updates.imageUrl;
      if (updates.venuePlanUrl !== undefined) dbUpdates.venue_plan_url = updates.venuePlanUrl;
      if (updates.date !== undefined && updates.time !== undefined) {
        dbUpdates.event_date = new Date(`${updates.date}T${updates.time}`).toISOString();
      }
      if (Array.isArray(updates.ticketTypes) && updates.ticketTypes.length > 0) {
        const minPrice = Math.min(...updates.ticketTypes.map((t) => Number(t.price) || 0));
        dbUpdates.ticket_price = Number.isFinite(minPrice) ? minPrice : 0;
        const totalQty = updates.ticketTypes.reduce((acc, t) => acc + (Number(t.quantity) || 0), 0);
        const totalSold = updates.ticketTypes.reduce((acc, t) => acc + (Number(t.sold) || 0), 0);
        dbUpdates.available_tickets = Math.max(totalQty - totalSold, 0);
        dbUpdates.sold_tickets = Math.max(totalSold, 0);
      } else {
        if (updates.price !== undefined) {
          const price = parseFloat(String(updates.price));
          if (Number.isFinite(price)) dbUpdates.ticket_price = price;
        }
        if (updates.capacity !== undefined) dbUpdates.available_tickets = updates.capacity;
      }
      if (updates.dressCode !== undefined) dbUpdates.dress_code = updates.dressCode;
      if (updates.ageRestriction !== undefined) dbUpdates.age_restriction = parseInt(updates.ageRestriction);
      if (updates.theme !== undefined) dbUpdates.theme = updates.theme;
      if (updates.eventType !== undefined) dbUpdates.event_type = updates.eventType;

      const doUpdate = async (useUpdatedAt: boolean) => {
        let q = supabase.from('events').update(dbUpdates).eq('id', id);
        if (useUpdatedAt && expectedUpdatedAt) {
          q = q.eq('updated_at', expectedUpdatedAt);
        }
        const sel = useUpdatedAt ? 'id, venue_id, updated_at' : 'id, venue_id';
        return q.select(sel).maybeSingle();
      };

      let updatedEvent: any = null;
      let error: any = null;

      {
        const res = await doUpdate(true);
        updatedEvent = res.data as any;
        error = res.error as any;
      }

      if (error?.code === '42703' && String(error?.message || '').includes('updated_at')) {
        const res = await doUpdate(false);
        updatedEvent = res.data as any;
        error = res.error as any;
      }

      if (error) throw error;
      if (!updatedEvent?.id) {
        if (expectedUpdatedAt) {
          let retryData: any = null;
          let retryError: any = null;

          {
            const retry = await supabase.from('events').update(dbUpdates).eq('id', id).select('id, venue_id, updated_at').maybeSingle();
            retryData = retry.data as any;
            retryError = retry.error as any;
          }
          if (retryError?.code === '42703' && String(retryError?.message || '').includes('updated_at')) {
            const retry = await supabase.from('events').update(dbUpdates).eq('id', id).select('id, venue_id').maybeSingle();
            retryData = retry.data as any;
            retryError = retry.error as any;
          }
          if (retryError) throw retryError;
          updatedEvent = retryData;
          if (!updatedEvent?.id) {
            throw new Error('Este evento fue modificado por otra sesión. Actualiza y vuelve a intentarlo.');
          }
        } else {
          throw new Error('No se pudo guardar el evento (permisos/RLS).');
        }
      }

      const venueId: string | null = (updatedEvent as any)?.venue_id ?? null;
      const updatedAt: string | null = (updatedEvent as any)?.updated_at ?? null;

      const venueName = (updates.venues?.name ?? updates.location ?? '').toString().trim();
      const venueLat = updates.venues?.latitude;
      const venueLng = updates.venues?.longitude;
      const shouldUpdateVenue =
        !!venueId &&
        (venueName.length > 0 || typeof venueLat === 'number' || typeof venueLng === 'number');

      if (shouldUpdateVenue) {
        const venueUpdates: any = {};
        if (venueName.length > 0) {
          venueUpdates.name = venueName;
          venueUpdates.address = venueName;
        }
        if (typeof venueLat === 'number') venueUpdates.latitude = venueLat;
        if (typeof venueLng === 'number') venueUpdates.longitude = venueLng;

        const { data: updatedVenue, error: venueError } = await supabase
          .from('venues')
          .update(venueUpdates)
          .eq('id', venueId)
          .select('id')
          .maybeSingle();
        if (venueError) throw venueError;
        if (!updatedVenue?.id) throw new Error('No se pudo guardar la ubicación (permisos/RLS).');
      }

      if (Array.isArray(updates.ticketTypes)) {
        const desired = updates.ticketTypes;

        const { data: existingTypes, error: existingErr } = await supabase
          .from('event_ticket_types')
          .select('id, sold')
          .eq('event_id', id);
        if (existingErr) throw existingErr;

        const keepIds = new Set(desired.filter((t) => isUuid(String(t.id))).map((t) => String(t.id)));

        for (const row of existingTypes || []) {
          const rowId = String((row as any).id || '');
          const sold = Number((row as any).sold || 0);
          if (!keepIds.has(rowId) && sold <= 0) {
            const del = await supabase
              .from('event_ticket_types')
              .update({ is_active: false, deleted_at: new Date().toISOString() })
              .eq('id', rowId)
              .eq('event_id', id);
            if (del.error) throw del.error;
          }
        }

        const seen = new Set<string>();
        for (const t of desired) {
          const ticketId = String((t as any).id || '');
          const name = String((t as any).name || '').trim();
          const price = Number((t as any).price || 0);
          const qtyRaw = Number((t as any).quantity || 0);
          const sold = Number((t as any).sold || 0);
          const qty = Math.max(qtyRaw, sold, 0);

          if (!name) continue;

          const key = `${name.toLowerCase()}|${Number.isFinite(price) ? price.toFixed(2) : String(price)}`;
          if (seen.has(key)) {
            throw new Error('No se permiten tipos de entrada duplicados (mismo nombre y precio).');
          }
          seen.add(key);

          if (isUuid(ticketId)) {
            const upsert = await supabase
              .from('event_ticket_types')
              .upsert(
                { id: ticketId, event_id: id, name, price, quantity: qty, is_active: true, deleted_at: null },
                { onConflict: 'id' }
              )
              .select('id')
              .maybeSingle();
            if (upsert.error) throw upsert.error;
            if (!upsert.data?.id) throw new Error('No se pudo guardar un tipo de entrada (permisos/RLS).');
          } else {
            const ins = await supabase
              .from('event_ticket_types')
              .insert({ event_id: id, name, price, quantity: qty, sold: 0, is_active: true })
              .select('id')
              .maybeSingle();
            if (ins.error) throw ins.error;
            if (!ins.data?.id) throw new Error('No se pudo añadir un tipo de entrada (permisos/RLS).');
          }
        }

        const { data: typesAfter, error: typesAfterErr } = await supabase
          .from('event_ticket_types')
          .select('price, quantity, sold, is_active, deleted_at')
          .eq('event_id', id);
        if (typesAfterErr) throw typesAfterErr;

        const activeTypes = (typesAfter || []).filter((t: any) => !t?.deleted_at && (t?.is_active ?? true));
        const totalQty = (activeTypes || []).reduce((acc, t) => acc + (Number((t as any).quantity) || 0), 0);
        const totalSold = (activeTypes || []).reduce((acc, t) => acc + (Number((t as any).sold) || 0), 0);
        const minPrice = (activeTypes || []).length
          ? Math.min(...(activeTypes || []).map((t) => Number((t as any).price) || 0))
          : 0;

        const { error: syncErr } = await supabase
          .from('events')
          .update({
            ticket_price: Number.isFinite(minPrice) ? minPrice : 0,
            sold_tickets: Math.max(totalSold, 0),
            available_tickets: Math.max(totalQty - totalSold, 0),
          })
          .eq('id', id);
        if (syncErr) throw syncErr;
      }

      await fetchEvents();
      try {
        const dispatchResult: any = await invokeEdgeFunctionStrict('dispatch-notifications', {
          limit: 400,
          eventId: id,
          enqueueEventUpdate: true,
        });
        console.log('[dispatch-notifications][event_update]', JSON.stringify(dispatchResult));
      } catch (e) {
        console.warn('dispatch-notifications failed after event update:', e);
      }
      return updatedAt;
    } catch (error) {
      console.error('Error updating event:', error);
      throw error;
    }
  };

  const deleteEvent = async (id: string) => {
    try {
      const { error } = await supabase
        .from('events')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setEvents((prev) => prev.filter((e) => e.id !== id));
      try {
        await invokeEdgeFunctionStrict('dispatch-notifications', { limit: 400 });
      } catch {}
    } catch (error) {
      console.error('Error deleting event:', error);
      throw error;
    }
  };

  const getEventById = (id: string) => {
    return events.find((e) => e.id === id);
  };

  return (
    <EventContext.Provider value={{ events, addEvent, updateEvent, deleteEvent, getEventById, refreshEvents: fetchEvents }}>
      {children}
    </EventContext.Provider>
  );
}
