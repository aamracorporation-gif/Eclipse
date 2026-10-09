
-- Free tickets use an atomic database claim, never Stripe or monetary wallet.
alter table public.tickets add column if not exists entry_deadline timestamptz;
alter table public.tickets add column if not exists free_claim_id uuid;
create index if not exists tickets_free_claim_lookup on public.tickets(user_id, free_claim_id) where free_claim_id is not null;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.enforce_ticket_entry_deadline()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_minutes text; v_start timestamptz;
begin
  if TG_OP = 'INSERT' then
    select tt.metadata->>'entryDeadlineMinutes', e.event_date into v_minutes, v_start
      from public.event_ticket_types tt join public.events e on e.id=tt.event_id
      where tt.id=NEW.ticket_type_id and tt.event_id=NEW.event_id;
    NEW.entry_deadline := null;
    if v_minutes is not null and v_minutes <> '' then
      if v_minutes !~ '^[0-9]{1,4}$' then raise exception 'Límite de acceso inválido'; end if;
      if v_minutes::integer < 1 or v_minutes::integer > 1440 then raise exception 'Límite de acceso inválido'; end if;
      NEW.entry_deadline := v_start + v_minutes::integer * interval '1 minute';
      if NEW.entry_deadline <= clock_timestamp() then raise exception 'El plazo de acceso de esta entrada ha terminado'; end if;
    end if;
  else
    -- Preserve the condition accepted at purchase even if organizer edits the type.
    NEW.entry_deadline := OLD.entry_deadline;
    if OLD.entry_deadline is not null and clock_timestamp() >= OLD.entry_deadline
       and ((NEW.scanned_at is not null and OLD.scanned_at is null)
         or (NEW.status='used' and OLD.status is distinct from 'used')
         or (NEW.ticket_status='used' and OLD.ticket_status is distinct from 'used')
         or (NEW.validation_status='used' and OLD.validation_status is distinct from 'used')) then
      raise exception 'ENTRADA CADUCADA: ha terminado su horario de acceso';
    end if;
  end if;
  return NEW;
end;
$$;
revoke all on function private.enforce_ticket_entry_deadline() from public, anon, authenticated;
create trigger enforce_ticket_entry_deadline before insert or update on public.tickets
for each row execute function private.enforce_ticket_entry_deadline();

create or replace function private.claim_free_tickets(
 p_event_id uuid, p_ticket_type_id uuid, p_quantity integer, p_buyer_name text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 v_user uuid := auth.uid(); v_event public.events%rowtype; v_type public.event_ticket_types%rowtype;
 v_email text; v_ids uuid[]; v_id uuid; v_qr uuid; v_count integer; i integer;
begin
 if v_user is null then raise exception 'Inicia sesión para obtener entradas' using errcode='42501'; end if;
 if p_request_id is null or p_quantity is null or p_quantity < 1 or p_quantity > 20
   or nullif(btrim(p_buyer_name),'') is null or length(p_buyer_name)>200 then raise exception 'Solicitud inválida'; end if;
 select email into v_email from auth.users where id=v_user and email_confirmed_at is not null;
 if v_email is null then raise exception 'Confirma tu correo antes de obtener entradas' using errcode='42501'; end if;
 -- Serialize retries across events and stock reservations within one event.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || p_request_id::text,0));
 select array_agg(id), count(*) into v_ids,v_count from public.tickets where user_id=v_user and free_claim_id=p_request_id;
 if v_count>0 then
   if v_count<>p_quantity or exists(select 1 from public.tickets where user_id=v_user and free_claim_id=p_request_id
     and (event_id is distinct from p_event_id or ticket_type_id is distinct from p_ticket_type_id or buyer_name is distinct from btrim(p_buyer_name))) then
     raise exception 'La solicitud ya se utilizó con otros datos';
   end if;
   return jsonb_build_object('success',true,'ticket_ids',v_ids,'total',0);
 end if;
 select * into v_event from public.events where id=p_event_id for update;
 if not found or v_event.is_cancelled or v_event.status is distinct from 'scheduled'
    or coalesce(v_event.end_datetime,v_event.event_date+interval '5 hours')<=clock_timestamp() then raise exception 'Evento no disponible'; end if;
 if coalesce(v_event.available_tickets,0)<p_quantity then raise exception 'No quedan suficientes entradas'; end if;
 if p_ticket_type_id is null then
   if exists(select 1 from public.event_ticket_types where event_id=p_event_id and is_active and deleted_at is null) then
     raise exception 'Selecciona un tipo de entrada';
   end if;
   if v_event.ticket_price is distinct from 0 then raise exception 'Esta entrada no es gratuita'; end if;
 else
   select * into v_type from public.event_ticket_types where id=p_ticket_type_id and event_id=p_event_id and is_active and deleted_at is null for update;
   if not found or v_type.price is distinct from 0 then raise exception 'Esta entrada no es gratuita o no está disponible'; end if;
   if v_type.quantity-coalesce(v_type.sold,0)<p_quantity then raise exception 'No quedan suficientes entradas de este tipo'; end if;
 end if;
 select count(*) into v_count from public.tickets where event_id=p_event_id and user_id=v_user and free_claim_id is not null;
 if v_count+p_quantity>20 then raise exception 'Máximo de 20 entradas gratuitas por persona y evento'; end if;
 v_ids:=array[]::uuid[];
 for i in 1..p_quantity loop
   v_qr:=gen_random_uuid();
   insert into public.tickets(event_id,user_id,ticket_type_id,buyer_name,buyer_email,quantity,total_price,price,
     qr_token,qr_code,status,ticket_status,validation_status,payment_status,free_claim_id)
   values(p_event_id,v_user,p_ticket_type_id,btrim(p_buyer_name),v_email,1,0,0,v_qr,v_qr::text,'valid','active','valid','paid',p_request_id)
   returning id into v_id;
   v_ids:=array_append(v_ids,v_id);
 end loop;
 update public.events set available_tickets=available_tickets-p_quantity,sold_tickets=coalesce(sold_tickets,0)+p_quantity where id=p_event_id;
 if p_ticket_type_id is not null then update public.event_ticket_types set sold=coalesce(sold,0)+p_quantity where id=p_ticket_type_id; end if;
 return jsonb_build_object('success',true,'ticket_ids',v_ids,'total',0);
end;
$$;
revoke all on function private.claim_free_tickets(uuid,uuid,integer,text,uuid) from public,anon;
grant execute on function private.claim_free_tickets(uuid,uuid,integer,text,uuid) to authenticated;
create or replace function public.claim_free_tickets(
 p_event_id uuid, p_ticket_type_id uuid, p_quantity integer, p_buyer_name text, p_request_id uuid
) returns jsonb language sql security invoker set search_path = ''
as $$ select private.claim_free_tickets(p_event_id,p_ticket_type_id,p_quantity,p_buyer_name,p_request_id); $$;
revoke all on function public.claim_free_tickets(uuid,uuid,integer,text,uuid) from public,anon;
grant execute on function public.claim_free_tickets(uuid,uuid,integer,text,uuid) to authenticated;
