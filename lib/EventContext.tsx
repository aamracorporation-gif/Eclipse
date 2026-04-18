import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { supabase, Event } from '@/lib/supabase';
import i18n from '@/lib/i18n';

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
  updateEvent: (id: string, updates: Partial<AppEvent>) => void;
  deleteEvent: (id: string) => void;
  getEventById: (id: string) => AppEvent | undefined;
  refreshEvents: () => Promise<void>;
};

const EventContext = createContext<EventContextType>({
  events: [],
  addEvent: async () => '',
  updateEvent: () => {},
  deleteEvent: () => {},
  getEventById: () => undefined,
  refreshEvents: async () => {},
});

export const useEvents = () => useContext(EventContext);

export function EventProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<AppEvent[]>(INITIAL_EVENTS);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          return {
            id: e.id,
            title: e.title,
            startsAt: e.event_date,
            date: eventDate.toISOString().split('T')[0],
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
            ticketTypes: e.event_ticket_types ? e.event_ticket_types.map((t: any) => ({
              id: t.id,
              name: t.name,
              price: t.price,
              quantity: t.quantity,
              sold: t.sold
            })) : [],
            venues: e.venues ? {
              latitude: e.venues.latitude,
              longitude: e.venues.longitude,
              name: e.venues.name
            } : undefined
          };
        });
        setEvents(mappedEvents);
      }
    } catch (error) {
      console.error('Error fetching events:', error);
    }
  }, [fetchEventsQuery]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => {
      fetchEvents();
    }, 250);
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

  const updateEvent = async (id: string, updates: Partial<AppEvent>) => {
    try {
      // Map updates to DB schema
      const dbUpdates: any = {};
      if (updates.title !== undefined) dbUpdates.title = updates.title;
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.imageUrl !== undefined) dbUpdates.poster_url = updates.imageUrl;
      if (updates.venuePlanUrl !== undefined) dbUpdates.venue_plan_url = updates.venuePlanUrl;
      if (updates.date !== undefined && updates.time !== undefined) {
        dbUpdates.event_date = new Date(`${updates.date}T${updates.time}`).toISOString();
      }
      if (updates.price !== undefined) dbUpdates.ticket_price = parseFloat(updates.price);
      if (updates.capacity !== undefined) dbUpdates.available_tickets = updates.capacity;
      if (updates.dressCode !== undefined) dbUpdates.dress_code = updates.dressCode;
      if (updates.ageRestriction !== undefined) dbUpdates.age_restriction = parseInt(updates.ageRestriction);
      if (updates.theme !== undefined) dbUpdates.theme = updates.theme;
      if (updates.eventType !== undefined) dbUpdates.event_type = updates.eventType;

      const { error } = await supabase
        .from('events')
        .update(dbUpdates)
        .eq('id', id);

      if (error) throw error;

      await fetchEvents();
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
