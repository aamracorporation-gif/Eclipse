-- Fix Worker Invitation Logic

-- 1. Function to link existing user to worker
CREATE OR REPLACE FUNCTION public.check_and_link_worker_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Find if user exists with this email
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = NEW.email;

  -- If user exists, link them and activate
  IF v_user_id IS NOT NULL THEN
    NEW.user_id := v_user_id;
    NEW.status := 'active';
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Trigger on workers table
DROP TRIGGER IF EXISTS on_worker_created_check_user ON public.workers;
CREATE TRIGGER on_worker_created_check_user
  BEFORE INSERT OR UPDATE OF email ON public.workers
  FOR EACH ROW
  EXECUTE FUNCTION public.check_and_link_worker_user();

-- 3. Run a one-time update for existing pending workers
DO $$
DECLARE
  w record;
  u_id uuid;
BEGIN
  FOR w IN SELECT * FROM public.workers WHERE status = 'pending' LOOP
    SELECT id INTO u_id FROM auth.users WHERE email = w.email;
    IF u_id IS NOT NULL THEN
      UPDATE public.workers 
      SET user_id = u_id, status = 'active'
      WHERE id = w.id;
    END IF;
  END LOOP;
END;
$$;
