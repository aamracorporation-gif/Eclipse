-- Refuse unbacked real-credit debits atomically in the internal card fulfillment core.
DO $migration$
DECLARE
  definition text := pg_get_functiondef('public.fulfill_payment_for_user_legacy_20260920(text,uuid)'::regprocedure);
  needle text := E'        END LOOP;\n      END IF;';
  replacement text := E'        END LOOP;\n        IF v_remaining > 0 THEN\n          RAISE EXCEPTION ''Insufficient credit backing'';\n        END IF;\n      END IF;';
BEGIN
  IF (length(definition)-length(replace(definition,needle,'')))/length(needle) <> 2 THEN
    RAISE EXCEPTION 'Unexpected fulfillment core: expected exactly two reserve loops';
  END IF;
  definition := replace(definition,needle,replacement);
  -- Stable ordering aligns reserve locks with the VIP preflight and resale paths.
  definition := replace(definition,'ORDER BY created_at ASC','ORDER BY created_at ASC, id ASC');
  EXECUTE definition;
END;
$migration$;
