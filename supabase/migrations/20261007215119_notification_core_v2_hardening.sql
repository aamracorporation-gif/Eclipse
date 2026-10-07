-- Follow-up after checking Eclipse Staging's effective ticket status constraints.
-- No capture/delivery gate changes, no backfill, no tokens or real recipients.
create or replace function notification_private.is_current(o notification_private.outbox) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if not notification_private.role_active(o.user_id,o.role) then return false; end if;
 if o.category='reminder' then
  return exists(select 1 from public.tickets t join public.events e on e.id=t.event_id
   where t.user_id=o.user_id and e.id=notification_private.as_uuid(o.data->>'event_id')
    and e.event_date=(o.data->>'event_date')::timestamptz and not coalesce(e.is_cancelled,false) and e.status not in ('cancelled','deleted')
    and t.status in ('valid','active') and t.ticket_status='active' and t.validation_status='valid' and t.payment_status='paid' and t.scanned_at is null
    and coalesce(e.end_datetime,e.event_date+interval '5 hours')>now()
    and (t.entry_deadline is null or t.entry_deadline>now())
    and (o.kind<>'reminder.entry_deadline' or t.entry_deadline=(o.data->>'deadline')::timestamptz));
 end if;
 if o.kind like 'order.%confirmed' and o.data ? 'transaction_id' then
  return exists(select 1 from public.payment_transactions p join public.tickets t on t.payment_transaction_id=p.id
    where p.id=notification_private.as_uuid(o.data->>'transaction_id') and p.user_id=o.user_id and p.status='fulfilled'
      and t.user_id=o.user_id and t.payment_status='paid' and t.status in ('valid','active','used') and t.ticket_status in ('active','used') and t.validation_status in ('valid','used'));
 end if;
 if o.kind in ('order.free_confirmed','order.box_office_issued') and o.data ? 'ticket_id' then
  return exists(select 1 from public.tickets t where t.id=notification_private.as_uuid(o.data->>'ticket_id') and t.user_id=o.user_id and t.payment_status='paid'
    and t.status in ('valid','active','used') and t.ticket_status in ('active','used') and t.validation_status in ('valid','used'));
 end if;
 if o.kind in ('refund.processing','refund.completed') then
  return exists(select 1 from public.payment_transactions p where p.id=notification_private.as_uuid(o.data->>'transaction_id') and p.user_id=o.user_id
    and p.status=case when o.kind='refund.processing' then 'refund_pending' else 'refunded' end);
 end if;
 if o.kind='ticket.invalidated' then
  return exists(select 1 from public.tickets t where t.id=notification_private.as_uuid(o.data->>'ticket_id') and t.user_id=o.user_id
   and (t.status='cancelled' or t.ticket_status='invalidated' or t.validation_status='revoked'));
 end if;
 if o.kind like 'event.%' and o.kind<>'event.cancelled' then
  return exists(select 1 from public.tickets t where t.event_id=notification_private.as_uuid(o.data->>'event_id') and t.user_id=o.user_id
   and t.payment_status='paid' and t.status in ('valid','active','used') and t.ticket_status in ('active','used') and t.validation_status in ('valid','used'));
 end if;
 if o.kind='worker.event_critical_change' then
  return exists(select 1 from public.worker_event_assignments a join public.workers w on w.id=a.worker_id where a.event_id=notification_private.as_uuid(o.data->>'event_id')
   and a.status='active' and w.user_id=o.user_id and w.status='active');
 end if;
 return true;
end $$;

create or replace function notification_private.capture_ticket() returns trigger language plpgsql security definer set search_path='' as $$
declare event_title text; kind text; identity text;
begin
 if new.user_id is null then return new; end if;
 select title into event_title from public.events where id=new.event_id;
 event_title:=coalesce(nullif(event_title,''),'tu evento');
 if tg_op='INSERT' and new.payment_transaction_id is null and new.stripe_payment_intent_id is null and
    new.payment_status='paid' and new.status in ('valid','active') and new.ticket_status='active' then
  if new.sold_by_worker_id is not null then kind:='order.box_office_issued'; identity:=new.id::text;
  elsif new.free_claim_id is not null or new.total_price=0 then kind:='order.free_confirmed'; identity:=coalesce(new.free_claim_id,new.id)::text;
  else return new; end if;
  perform notification_private.emit(new.user_id,'attendee',kind,kind||':'||identity,
    case when kind='order.free_confirmed' then 'Tu invitación está lista' else 'Tu entrada de taquilla está lista' end,
    'Ya puedes consultar tu acceso para '||event_title||' en Mis entradas.',
    jsonb_build_object('ticket_id',new.id,'event_id',new.event_id,'destination','tickets'),'purchase','normal',
    case when kind='order.free_confirmed' then array['push','email'] else array['email'] end);
 elsif tg_op='UPDATE' then
  if new.user_id is distinct from old.user_id then return new; end if;
  if old.scanned_at is null and new.scanned_at is not null then
   perform notification_private.emit(new.user_id,'attendee','ticket.checked_in','ticket:'||new.id||':checked_in','Acceso registrado',
    'Se ha registrado tu acceso a '||event_title||'.',jsonb_build_object('ticket_id',new.id,'destination','tickets'),'purchase','low','{}');
  elsif (new.status='cancelled' or new.ticket_status='invalidated' or new.validation_status='revoked')
    and not coalesce(old.status='cancelled' or old.ticket_status='invalidated' or old.validation_status='revoked',false) then
   perform notification_private.emit(new.user_id,'attendee','ticket.invalidated','ticket:'||new.id||':invalidated','Tu entrada ya no es válida',
    'Revisa en Eclipse el estado de tu entrada para '||event_title||'. Invalidar una entrada no equivale a completar su reembolso.',
    jsonb_build_object('ticket_id',new.id,'event_id',new.event_id,'destination','tickets'),'change','high');
  end if;
 end if;
 return new;
end $$;

create or replace function notification_private.capture_event() returns trigger language plpgsql security definer set search_path='' as $$
declare k text; heading text; message text; rec record; changes text[]:='{}'; ev public.events%rowtype;
begin
 if tg_op='DELETE' then ev:=old; k:='event.cancelled'; heading:='Evento no disponible'; message:='El evento '||old.title||' ya no está disponible. Consulta en Eclipse el estado de tu compra.';
 else
  ev:=new;
  if new.notification_revision=old.notification_revision then return new; end if;
  if (new.is_cancelled or new.status='cancelled') and not(coalesce(old.is_cancelled,false) or coalesce(old.status='cancelled',false)) then
   k:='event.cancelled'; heading:='Evento cancelado'; message:=new.title||' se ha cancelado. Consulta el estado de tu compra; el reembolso se informa por separado.';
  else
   if row(new.event_date,new.end_datetime) is distinct from row(old.event_date,old.end_datetime) then changes:=array_append(changes,'fecha u horario'); k:='event.schedule_changed'; end if;
   if new.venue_id is distinct from old.venue_id then changes:=array_append(changes,'ubicación'); k:=coalesce(k,'event.venue_changed'); end if;
   if row(new.access_policy,new.access_requirements,new.dress_code,new.age_restriction) is distinct from row(old.access_policy,old.access_requirements,old.dress_code,old.age_restriction) then changes:=array_append(changes,'condiciones de acceso'); k:=coalesce(k,'event.access_changed'); end if;
   if new.lineup is distinct from old.lineup then changes:=array_append(changes,'cartel'); k:=coalesce(k,'event.lineup_changed'); end if;
   if k is null then return new; end if;
   heading:='Cambio importante en tu evento'; message:=new.title||': han cambiado '||array_to_string(changes,', ')||'. Revisa los detalles antes de acudir.';
  end if;
 end if;
 -- Bounded by the affected audience; no provider I/O in business transactions.
 for rec in select distinct t.user_id from public.tickets t where t.event_id=ev.id and t.user_id is not null
   and t.payment_status='paid' and t.status in ('valid','active','used') and t.ticket_status in ('active','used') and t.validation_status in ('valid','used') loop
  perform notification_private.emit(rec.user_id,'attendee',k,'event:'||ev.id||':'||ev.notification_revision||':'||tg_op,
   heading,message,jsonb_build_object('event_id',ev.id,'destination','event','changed_fields',changes),'change','high');
 end loop;
 for rec in select distinct w.user_id from public.worker_event_assignments a join public.workers w on w.id=a.worker_id
   where a.event_id=ev.id and a.status='active' and w.status='active' and w.user_id is not null loop
  perform notification_private.emit(rec.user_id,'staff','worker.event_critical_change','staff-event:'||ev.id||':'||ev.notification_revision||':'||tg_op,
   'Cambio en tu evento asignado',message,jsonb_build_object('event_id',ev.id,'destination','worker'),'operation','high',array['push']);
 end loop;
 if tg_op='DELETE' then return old; end if; return new;
end $$;

create or replace function notification_private.schedule_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare r record; due timestamptz; k text; deadline timestamptz; total integer:=0; cutoff timestamptz;
begin
 select cutover_at into cutoff from notification_private.config where singleton and capture_enabled;
 if cutoff is null then return 0; end if;
 -- Five minute tolerance, not retrospective delivery of missed reminders. Bound each scheduler tick.
 for r in
 with eligible as (
  select t.user_id,e.id as event_id,e.title,e.event_date,coalesce(e.end_datetime,e.event_date+interval '5 hours') as event_end,min(t.entry_deadline) as deadline,min(t.purchase_date) as purchased
  from public.tickets t join public.events e on e.id=t.event_id
  where t.user_id is not null and t.status in ('valid','active') and t.ticket_status='active' and t.validation_status='valid'
   and t.payment_status='paid' and t.scanned_at is null and not coalesce(e.is_cancelled,false) and e.status not in ('cancelled','deleted')
   and coalesce(e.end_datetime,e.event_date+interval '5 hours')>now() and (t.entry_deadline is null or t.entry_deadline>now())
   and e.event_date<=now()+interval '24 hours 5 minutes'
  group by t.user_id,e.id,e.title,e.event_date,e.end_datetime
 ), candidates as (
  select e.*,v.kind,v.due,'reminder:'||e.event_id||':'||v.kind||':'||extract(epoch from e.event_date)::text||case when v.kind='reminder.entry_deadline' then ':'||extract(epoch from e.deadline)::text else '' end as identity
  from eligible e cross join lateral (values
   ('reminder.event_24h',e.event_date-interval '24 hours'),
   ('reminder.event_2h',e.event_date-interval '2 hours'),
   ('reminder.entry_deadline',e.deadline-interval '60 minutes')) v(kind,due)
  where v.due>=cutoff and v.due between now()-interval '5 minutes' and now() and e.purchased<=v.due
   and not(v.kind='reminder.event_2h' and e.deadline is not null and abs(extract(epoch from ((e.deadline-interval '60 minutes')-v.due)))<5400)
 ) select c.* from candidates c where not exists(select 1 from notification_private.outbox o where o.user_id=c.user_id and o.role='attendee' and o.event_key=c.identity)
 order by c.due,c.user_id limit 2000 loop
  perform notification_private.emit(r.user_id,'attendee',r.kind,r.identity,
   case r.kind when 'reminder.event_24h' then 'Tu evento es mañana' when 'reminder.event_2h' then 'Tu evento empieza en dos horas' else 'Revisa la hora límite de entrada' end,
   case when r.kind='reminder.entry_deadline' then 'Tu entrada para '||r.title||' tiene una hora límite de acceso. Consúltala antes de salir.' else 'Prepárate para '||r.title||'. Revisa ubicación, condiciones y acceso en Eclipse.' end,
   jsonb_build_object('event_id',r.event_id,'event_date',r.event_date,'deadline',r.deadline,'destination','tickets'),'reminder','normal',array['push'],
   case when r.kind='reminder.entry_deadline' then least(r.due+interval '30 minutes',r.deadline,r.event_end)
    else least(r.due+interval '30 minutes',coalesce(r.deadline,r.event_date),r.event_date) end);
  total:=total+1;
 end loop;
 return total;
end $$;
