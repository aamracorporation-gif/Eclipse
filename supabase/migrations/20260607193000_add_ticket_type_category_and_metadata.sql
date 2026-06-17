ALTER TABLE public.event_ticket_types
ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.event_ticket_types
ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.event_ticket_types
SET metadata = COALESCE(metadata, '{}'::jsonb)
WHERE metadata IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_ticket_types_category
ON public.event_ticket_types(category);

