-- A purchase keeps its product identity even after the catalogue is edited.
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS product_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.reservados_vip ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION private.capture_ticket_product()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
 tx public.payment_transactions%ROWTYPE;
 tt public.event_ticket_types%ROWTYPE;
 vip public.reservados_vip%ROWTYPE;
 snap jsonb; m jsonb; cat text; label text; units integer;
BEGIN
 IF TG_OP='UPDATE' AND OLD.product_snapshot <> '{}'::jsonb
    AND NEW.ticket_type_id IS NOT DISTINCT FROM OLD.ticket_type_id
    AND NEW.payment_transaction_id IS NOT DISTINCT FROM OLD.payment_transaction_id
    AND NEW.event_id IS NOT DISTINCT FROM OLD.event_id THEN
   NEW.product_snapshot:=OLD.product_snapshot;
   NEW.ticket_type:=OLD.ticket_type;
   RETURN NEW;
 END IF;
 SELECT * INTO tx FROM public.payment_transactions WHERE id=NEW.payment_transaction_id;
 IF tx.kind='vip_table' THEN
   SELECT * INTO vip FROM public.reservados_vip WHERE id=nullif(tx.metadata->>'vip_reservado_id','')::uuid AND event_id=NEW.event_id;
 ELSIF NEW.ticket_type LIKE 'VIP - %' THEN
   SELECT * INTO vip FROM public.reservados_vip WHERE event_id=NEW.event_id AND name=substring(NEW.ticket_type from 7) ORDER BY id LIMIT 1;
 END IF;
 IF vip.id IS NOT NULL OR tx.kind='vip_table' THEN
   m:=coalesce(vip.metadata,'{}'::jsonb)||jsonb_build_object(
     'vipGroupSize',coalesce(vip.capacity_people,(tx.metadata->>'capacity_people')::int,NEW.quantity),
     'benefits',coalesce(vip.description,''),
     'vipBottles',coalesce(vip.metadata->'vipBottles',CASE WHEN coalesce(vip.included_bottles,0)>0 THEN jsonb_build_array(jsonb_build_object('brand','Botella incluida','quantity',vip.included_bottles)) ELSE '[]'::jsonb END));
   snap:=jsonb_build_object('kind','vip_table','category','vip_table','name',coalesce(nullif(tx.metadata->>'vip_name',''),vip.name,'Reservado de mesa VIP'),'metadata',m);
   NEW.ticket_type:='vip_table';
 ELSE
   SELECT * INTO tt FROM public.event_ticket_types WHERE id=NEW.ticket_type_id AND event_id=NEW.event_id;
   cat:=coalesce(nullif(tt.category,''),nullif(NEW.ticket_type,''),'general');
   label:=coalesce(nullif(tt.name,''),nullif(NEW.ticket_type,''),'Entrada general');
   m:=coalesce(tt.metadata,'{}'::jsonb);
   snap:=jsonb_build_object('kind','admission','category',cat,'name',label,'metadata',m);
   NEW.ticket_type:=cat;
 END IF;
 -- Payment metadata is written exclusively by the server checkout, never by the buyer.
 IF jsonb_typeof(tx.metadata->'product_snapshot')='object' AND tx.metadata->'product_snapshot' <> '{}'::jsonb THEN
   snap:=tx.metadata->'product_snapshot';
   NEW.ticket_type:=snap->>'category';
 END IF;
 NEW.product_snapshot:=snap;
 IF TG_OP='INSERT' AND snap->>'kind'='admission' THEN
   units:=coalesce(nullif(snap#>>'{metadata,admissionsPerUnit}','')::int,1);
   IF units < 1 OR units > 20 THEN RAISE EXCEPTION 'Invalid group size'; END IF;
   NEW.quantity:=NEW.quantity*units;
 END IF;
 IF NEW.entry_deadline IS NULL AND coalesce(nullif(snap#>>'{metadata,entryDeadlineMinutes}','')::int,0)>0 THEN
   SELECT event_date + (snap#>>'{metadata,entryDeadlineMinutes}')::int*interval '1 minute'
   INTO NEW.entry_deadline FROM public.events WHERE id=NEW.event_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.capture_ticket_product() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS capture_ticket_product ON public.tickets;
CREATE TRIGGER capture_ticket_product BEFORE INSERT OR UPDATE OF product_snapshot,ticket_type,ticket_type_id,payment_transaction_id,event_id ON public.tickets
FOR EACH ROW EXECUTE FUNCTION private.capture_ticket_product();
UPDATE public.tickets SET product_snapshot='{}'::jsonb WHERE product_snapshot='{}'::jsonb;

-- Prevent a second, individual VIP product from returning through older app versions.
CREATE OR REPLACE FUNCTION private.guard_admission_offer()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW.is_active AND NEW.deleted_at IS NULL AND (lower(coalesce(NEW.category,'')) IN ('vip','vip_table') OR NEW.name ~* '\\mVIP\\M') THEN
   RAISE EXCEPTION 'VIP solo está disponible como reservado de mesa';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_admission_offer() FROM PUBLIC,anon,authenticated;

-- Archive erroneous individual VIP offers; issued tickets and payment records are preserved.
WITH retired AS (
 UPDATE public.event_ticket_types SET is_active=false,deleted_at=now()
 WHERE lower(coalesce(category,''))='vip' AND is_active AND deleted_at IS NULL
 RETURNING event_id,greatest(quantity-coalesce(sold,0),0) AS remaining
), stock AS (SELECT event_id,sum(remaining) AS remaining FROM retired GROUP BY event_id)
UPDATE public.events e SET available_tickets=greatest(0,e.available_tickets-stock.remaining),updated_at=now()
FROM stock WHERE stock.event_id=e.id;
DROP TRIGGER IF EXISTS guard_admission_offer ON public.event_ticket_types;
CREATE TRIGGER guard_admission_offer BEFORE INSERT OR UPDATE OF category,name,is_active,deleted_at ON public.event_ticket_types
FOR EACH ROW EXECUTE FUNCTION private.guard_admission_offer();
