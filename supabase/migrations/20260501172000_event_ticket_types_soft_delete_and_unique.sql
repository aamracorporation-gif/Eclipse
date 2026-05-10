ALTER TABLE public.event_ticket_types
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_event_ticket_types_event_active
ON public.event_ticket_types(event_id)
WHERE deleted_at IS NULL AND is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_event_ticket_types_event_name_price_active
ON public.event_ticket_types(event_id, lower(name), price)
WHERE deleted_at IS NULL;

UPDATE public.event_ticket_types
SET is_active = true
WHERE is_active IS DISTINCT FROM true AND deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
