-- QA real-time collaboration sessions
CREATE TABLE IF NOT EXISTS public.qa_sessions (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  code       text        UNIQUE NOT NULL,
  tester     text        NOT NULL DEFAULT 'QA',
  results    jsonb       NOT NULL DEFAULT '{}',
  notes      jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Anyone with the code can read/write (code is the "password")
ALTER TABLE public.qa_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qa_sessions_public_read"  ON public.qa_sessions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "qa_sessions_public_write" ON public.qa_sessions FOR ALL    TO anon, authenticated USING (true) WITH CHECK (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_qa_session()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER qa_session_touch
  BEFORE UPDATE ON public.qa_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_qa_session();

-- Clean up sessions older than 30 days (optional)
CREATE INDEX IF NOT EXISTS idx_qa_sessions_code       ON public.qa_sessions (code);
CREATE INDEX IF NOT EXISTS idx_qa_sessions_updated_at ON public.qa_sessions (updated_at);
