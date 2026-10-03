create or replace function private.enforce_ticket_entry_deadline()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_minutes text; v_start timestamptz;
begin
  if TG_OP = 'INSERT' then
    select tt.metadata->>'entryDeadlineMinutes', e.event_date into v_minutes, v_start
      from public.event_ticket_types tt join public.events e on e.id=tt.event_id
      where tt.id=NEW.ticket_type_id and tt.event_id=NEW.event_id and tt.price=0;
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
