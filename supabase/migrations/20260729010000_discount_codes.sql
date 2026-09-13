-- ============================================================
-- DISCOUNT CODES
-- ============================================================

-- 1. Main table
CREATE TABLE IF NOT EXISTS public.discount_codes (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid        NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  creator_id     uuid        NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  code           text        NOT NULL,
  discount_type  text        NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value numeric     NOT NULL CHECK (discount_value > 0),
  max_uses       integer     DEFAULT NULL CHECK (max_uses IS NULL OR max_uses > 0),
  uses_count     integer     NOT NULL DEFAULT 0,
  min_tickets    integer     NOT NULL DEFAULT 1,
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_until    timestamptz DEFAULT NULL,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, code)
);

ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;

-- 2. Usage log table
CREATE TABLE IF NOT EXISTS public.discount_code_uses (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  discount_code_id uuid        NOT NULL REFERENCES public.discount_codes(id) ON DELETE CASCADE,
  buyer_name       text,
  buyer_email      text,
  applied_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.discount_code_uses ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Organizer: full control over their own codes
DROP POLICY IF EXISTS "Organizer manages own discount codes" ON public.discount_codes;
CREATE POLICY "Organizer manages own discount codes"
  ON public.discount_codes FOR ALL TO authenticated
  USING    (creator_id = auth.uid())
  WITH CHECK (creator_id = auth.uid());

-- Admin: full control over all codes
DROP POLICY IF EXISTS "Admin manages all discount codes" ON public.discount_codes;
CREATE POLICY "Admin manages all discount codes"
  ON public.discount_codes FOR ALL TO authenticated
  USING (
    (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Authenticated users can SELECT active codes (to validate at purchase time)
DROP POLICY IF EXISTS "Users can validate discount codes" ON public.discount_codes;
CREATE POLICY "Users can validate discount codes"
  ON public.discount_codes FOR SELECT TO authenticated
  USING (is_active = true);

-- Organizer can see uses of their own codes
DROP POLICY IF EXISTS "Organizer views uses of own codes" ON public.discount_code_uses;
CREATE POLICY "Organizer views uses of own codes"
  ON public.discount_code_uses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.discount_codes
      WHERE id = discount_code_id
        AND (
          creator_id = auth.uid()
          OR (auth.jwt() ->> 'email' = 'aamracorporation@gmail.com')
          OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
        )
    )
  );

-- Anyone authenticated can insert a use (SECURITY DEFINER RPCs will handle this)
DROP POLICY IF EXISTS "Authenticated can log code use" ON public.discount_code_uses;
CREATE POLICY "Authenticated can log code use"
  ON public.discount_code_uses FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================================
-- RPC: validate_discount_code
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_discount_code(
  p_code     text,
  p_event_id uuid,
  p_quantity integer DEFAULT 1
)
RETURNS public.discount_codes
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_code public.discount_codes;
BEGIN
  SELECT * INTO v_code
  FROM public.discount_codes
  WHERE event_id = p_event_id
    AND lower(code) = lower(p_code)
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Código de descuento no válido o no existe para este evento.';
  END IF;

  IF v_code.valid_until IS NOT NULL AND v_code.valid_until < now() THEN
    RAISE EXCEPTION 'Este código de descuento ha expirado.';
  END IF;

  IF v_code.valid_from > now() THEN
    RAISE EXCEPTION 'Este código todavía no está activo.';
  END IF;

  IF v_code.max_uses IS NOT NULL AND v_code.uses_count >= v_code.max_uses THEN
    RAISE EXCEPTION 'Este código ha alcanzado su límite de usos.';
  END IF;

  IF p_quantity < v_code.min_tickets THEN
    RAISE EXCEPTION 'Este código requiere un mínimo de % entrada(s).', v_code.min_tickets;
  END IF;

  RETURN v_code;
END;
$$;

-- ============================================================
-- RPC: consume_discount_code  (atomic: increment + log)
-- ============================================================
CREATE OR REPLACE FUNCTION public.consume_discount_code(
  p_code_id     uuid,
  p_buyer_name  text DEFAULT NULL,
  p_buyer_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.discount_codes
  SET uses_count = uses_count + 1
  WHERE id = p_code_id
    AND is_active = true
    AND (max_uses IS NULL OR uses_count < max_uses);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El código ya no está disponible.';
  END IF;

  INSERT INTO public.discount_code_uses (discount_code_id, buyer_name, buyer_email)
  VALUES (p_code_id, p_buyer_name, p_buyer_email);
END;
$$;
