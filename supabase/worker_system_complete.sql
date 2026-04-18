-- Combined Worker System Migration

-- 1. Workers Table
CREATE TABLE IF NOT EXISTS public.workers (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organizer_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  status text CHECK (status IN ('pending', 'active', 'inactive')) DEFAULT 'pending',
  permissions jsonb DEFAULT '["scan"]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workers_organizer ON public.workers(organizer_id);
CREATE INDEX IF NOT EXISTS idx_workers_user ON public.workers(user_id);
CREATE INDEX IF NOT EXISTS idx_workers_email ON public.workers(email);

ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organizers can manage their workers" ON public.workers
  FOR ALL
  USING (organizer_id = auth.uid());

CREATE POLICY "Workers can view own profile" ON public.workers
  FOR SELECT
  USING (user_id = auth.uid());

-- 2. Worker Event Assignments
CREATE TABLE IF NOT EXISTS public.worker_event_assignments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  worker_id uuid REFERENCES public.workers(id) ON DELETE CASCADE NOT NULL,
  event_id uuid REFERENCES public.events(id) ON DELETE CASCADE NOT NULL,
  assigned_at timestamptz DEFAULT now(),
  status text CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
  UNIQUE(worker_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_worker ON public.worker_event_assignments(worker_id);
CREATE INDEX IF NOT EXISTS idx_assignments_event ON public.worker_event_assignments(event_id);

ALTER TABLE public.worker_event_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Organizers can manage assignments" ON public.worker_event_assignments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.events 
      WHERE id = worker_event_assignments.event_id 
      AND creator_id = auth.uid()
    )
  );

CREATE POLICY "Workers can view their assignments" ON public.worker_event_assignments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.workers 
      WHERE id = worker_event_assignments.worker_id 
      AND user_id = auth.uid()
    )
  );

-- 3. Update Tickets Table
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS sold_by_worker_id uuid REFERENCES public.workers(id);
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS scanned_by_worker_id uuid REFERENCES public.workers(id);
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS payment_status text CHECK (payment_status IN ('paid', 'unpaid_worker')) DEFAULT 'paid';

-- 4. Stats RPC
CREATE OR REPLACE FUNCTION public.get_worker_stats(p_worker_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tickets_sold int;
  v_unpaid_amount numeric;
BEGIN
  -- Verify permissions (Organizer of worker OR the worker themselves)
  IF NOT EXISTS (
    SELECT 1 FROM public.workers 
    WHERE id = p_worker_id 
    AND (user_id = auth.uid() OR organizer_id = auth.uid())
  ) THEN
     -- Simplified permission check logic handled by query below if strictness needed
     -- But here we raise exception
     RAISE EXCEPTION 'Permission denied';
  END IF;

  SELECT count(*), coalesce(sum(price), 0)
  INTO v_tickets_sold, v_unpaid_amount
  FROM public.tickets
  WHERE sold_by_worker_id = p_worker_id;
  
  RETURN json_build_object(
    'tickets_sold', v_tickets_sold,
    'unpaid_amount', v_unpaid_amount
  );
END;
$$;

-- 5. Validation RPC
CREATE OR REPLACE FUNCTION validate_ticket_worker(
  p_qr_token text,
  p_worker_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_ticket_id uuid;
  v_event_id uuid;
  v_status text;
  v_scanned_at timestamptz;
  v_metadata jsonb;
  v_attendee_name text;
  v_ticket_type text;
  v_worker_status text;
  v_worker_org_id uuid;
  v_event_org_id uuid;
BEGIN
  -- 1. Check if worker is active
  SELECT status, organizer_id INTO v_worker_status, v_worker_org_id
  FROM public.workers
  WHERE id = p_worker_id;

  IF v_worker_status IS NULL OR v_worker_status != 'active' THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Trabajador no activo');
  END IF;

  -- 2. Find ticket
  SELECT 
    t.id, t.event_id, t.status, t.scanned_at, t.metadata, t.attendee_name, t.ticket_type,
    e.creator_id
  INTO 
    v_ticket_id, v_event_id, v_status, v_scanned_at, v_metadata, v_attendee_name, v_ticket_type,
    v_event_org_id
  FROM public.tickets t
  JOIN public.events e ON t.event_id = e.id
  WHERE t.qr_token = p_qr_token;

  IF v_ticket_id IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Entrada no encontrada');
  END IF;

  -- 3. Check if worker belongs to the event organizer
  IF v_worker_org_id != v_event_org_id THEN
    RETURN jsonb_build_object('valid', false, 'message', 'No tienes permiso para este evento');
  END IF;

  -- 4. Check ticket status
  IF v_status = 'used' THEN
    RETURN jsonb_build_object(
      'valid', false, 
      'message', 'Entrada ya utilizada',
      'scanned_at', v_scanned_at
    );
  END IF;

  IF v_status = 'expired' THEN
    RETURN jsonb_build_object('valid', false, 'message', 'ENTRADA CADUCADA');
  END IF;

  IF v_status != 'valid' THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Entrada no válida (' || v_status || ')');
  END IF;

  -- 5. Mark as used
  UPDATE public.tickets
  SET 
    status = 'used',
    scanned_at = now(),
    scanned_by_worker_id = p_worker_id
  WHERE id = v_ticket_id;

  RETURN jsonb_build_object(
    'valid', true,
    'ticket_id', v_ticket_id,
    'attendee_name', v_attendee_name,
    'ticket_type', v_ticket_type,
    'metadata', v_metadata
  );
END;
$$;

-- 6. Link Worker Trigger
CREATE OR REPLACE FUNCTION public.link_worker_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- If the new user's email matches a pending worker
  UPDATE public.workers
  SET user_id = NEW.id,
      status = 'active',
      updated_at = now()
  WHERE email = NEW.email
  AND (user_id IS NULL OR user_id = NEW.id);
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_link_worker ON auth.users;
CREATE TRIGGER on_auth_user_created_link_worker
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.link_worker_profile();

-- 7. Monthly Commission Stats RPC
CREATE OR REPLACE FUNCTION public.get_worker_monthly_stats(p_worker_id uuid)
RETURNS TABLE (
  month_date text,
  tickets_sold bigint,
  total_sales numeric,
  commission numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workers 
    WHERE id = p_worker_id 
    AND (user_id = auth.uid() OR organizer_id = auth.uid())
  ) THEN
     RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN QUERY
  SELECT 
    to_char(created_at, 'YYYY-MM') as month_date,
    count(*) as tickets_sold,
    sum(price) as total_sales,
    sum(price) * 0.10 as commission -- 10% commission
  FROM public.tickets
  WHERE sold_by_worker_id = p_worker_id
  GROUP BY 1
  ORDER BY 1 DESC;
END;
$$;
