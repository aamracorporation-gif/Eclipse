-- Enable Realtime on tables needed for live ticket stock updates
ALTER PUBLICATION supabase_realtime ADD TABLE event_ticket_types;
ALTER PUBLICATION supabase_realtime ADD TABLE events;
