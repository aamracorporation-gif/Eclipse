-- Additive notification core. No provider calls, historical replay, cron installation or live sends.
-- Activate only after rollout tests. Legacy inbox remains readable; v2 uses a separate delivery queue.
create schema if not exists notification_private;
revoke all on schema notification_private from public, anon, authenticated;
grant usage on schema notification_private to service_role;

create table notification_private.config (
  singleton boolean primary key default true check (singleton),
  capture_enabled boolean not null default false,
  live_delivery_enabled boolean not null default false,
  allow_all_recipients boolean not null default false,
  allowed_recipients uuid[] not null default '{}',
  cutover_at timestamptz not null default clock_timestamp()
);
insert into notification_private.config(singleton) values(true);
alter table notification_private.config enable row level security;

alter table public.notifications add column if not exists delivery_version smallint not null default 1;
alter table public.notifications add column if not exists archived_at timestamptz;
alter table public.notifications add column if not exists dedupe_key text;
alter table public.notifications add column if not exists category text;
alter table public.notifications add column if not exists expires_at timestamptz;
create unique index if not exists notifications_v2_identity on public.notifications(user_id,role,dedupe_key) where delivery_version=2;
create index if not exists notifications_v2_inbox on public.notifications(user_id,created_at desc,id) where archived_at is null;

create table public.notification_preferences_v2 (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check(role in ('attendee','organizer','staff','admin')),
  push_enabled boolean not null default true,
  email_enabled boolean not null default true,
  purchase_updates boolean not null default true,
  event_changes boolean not null default true,
  event_reminders boolean not null default true,
  operations boolean not null default true,
  quiet_enabled boolean not null default true,
  quiet_start integer not null default 0 check(quiet_start between 0 and 1439),
  quiet_end integer not null default 660 check(quiet_end between 0 and 1439),
  timezone text not null default 'Europe/Madrid',
  event_night_override boolean not null default false,
  marketing_opt_in boolean not null default false check(marketing_opt_in=false),
  updated_at timestamptz not null default now(),
  primary key(user_id,role)
);
alter table public.notification_preferences_v2 enable row level security;

create table notification_private.outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check(role in ('attendee','organizer','staff','admin')),
  kind text not null,
  event_key text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}',
  category text not null check(category in ('purchase','change','reminder','operation')),
  priority text not null default 'normal' check(priority in ('low','normal','high')),
  channels text[] not null default '{push,email}',
  created_at timestamptz not null default now(),
  due_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '24 hours',
  processed_at timestamptz,
  disposition text,
  unique(user_id,role,event_key)
);
create index notification_outbox_ready on notification_private.outbox(due_at,id) where processed_at is null;
alter table notification_private.outbox enable row level security;

-- New bindings are not inferred from old tokens. Re-registration requires a new app build.
create table notification_private.installations (
  installation_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  token text not null unique,
  platform text not null check(platform in ('ios','android')),
  project_id uuid not null,
  binding_id uuid not null default gen_random_uuid(),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table notification_private.installations enable row level security;

create table notification_private.deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  outbox_id uuid not null references notification_private.outbox(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check(channel in ('push','email')),
  target_key text not null,
  installation_id uuid references notification_private.installations(installation_id) on delete set null,
  binding_id uuid,
  email text,
  status text not null default 'pending' check(status in ('pending','processing','accepted','confirmed','failed','cancelled','expired','unknown')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  provider_id text,
  accepted_at timestamptz,
  receipt_check_at timestamptz,
  last_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(notification_id,channel,target_key)
);
create index notification_deliveries_ready_v2 on notification_private.deliveries(next_attempt_at,id) where status in ('pending','processing');
create index notification_receipts_ready_v2 on notification_private.deliveries(receipt_check_at,id) where channel='push' and status='accepted';
alter table notification_private.deliveries enable row level security;

create table notification_private.delivery_audit (
  id bigint generated always as identity primary key,
  delivery_id uuid not null references notification_private.deliveries(id) on delete cascade,
  status text not null,
  code text,
  occurred_at timestamptz not null default now()
);
alter table notification_private.delivery_audit enable row level security;

create function notification_private.as_uuid(value text) returns uuid language sql immutable set search_path='' as $$
 select case when value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then value::uuid else null end
$$;
create function notification_private.role_active(uid uuid, expected_role text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=uid and not coalesce(p.is_suspended,false) and
   (expected_role='attendee' or (expected_role='organizer' and p.role='organizer') or
    (expected_role='admin' and p.role='admin') or
    (expected_role='staff' and exists(select 1 from public.workers w where w.user_id=uid and w.status='active'))))
$$;
create function notification_private.own_role(uid uuid, expected_role text) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and uid=auth.uid() and notification_private.role_active(uid,expected_role)
$$;
create policy notification_v2_role_read on public.notifications as restrictive for select to authenticated
 using(delivery_version<>2 or notification_private.own_role(user_id,role));
create policy notification_preferences_owner on public.notification_preferences_v2 for all to authenticated
 using(notification_private.own_role(user_id,role)) with check(notification_private.own_role(user_id,role));
grant select,insert,update on public.notification_preferences_v2 to authenticated;
grant all on public.notification_preferences_v2 to service_role;

create function notification_private.validate_preferences() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then raise exception 'Invalid timezone' using errcode='22023'; end if;
 new.updated_at:=now(); return new;
end $$;
create trigger validate_notification_preferences_v2 before insert or update on public.notification_preferences_v2
 for each row execute function notification_private.validate_preferences();

-- Compatibility: old clients can mark read, but cannot change message content or transport state.
create function notification_private.protect_inbox() returns trigger language plpgsql set search_path='' as $$
begin
 if current_user in ('authenticated','anon') and old.delivery_version=2 then
  if tg_op='DELETE' then raise exception 'Archive notifications instead' using errcode='42501'; end if;
  if (to_jsonb(new)-array['read','read_at','archived_at','status']) is distinct from
     (to_jsonb(old)-array['read','read_at','archived_at','status']) then raise exception 'Forbidden' using errcode='42501'; end if;
  new.status:=old.status;
  if new.read then new.read_at:=coalesce(old.read_at,now()); else new.read_at:=null; end if;
  if new.archived_at is not null then new.archived_at:=coalesce(old.archived_at,now()); end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
create trigger protect_notification_inbox_v2 before update or delete on public.notifications for each row execute function notification_private.protect_inbox();

-- Only suppress producers replaced by this migration, and only after explicitly enabling capture.
create function notification_private.suppress_legacy() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.delivery_version<>2 and (select capture_enabled from notification_private.config where singleton) and
 new.type in ('purchase_confirmed','purchase_completed','purchase_fulfilled','PURCHASE_SUCCESS','event_cancelled','event_date_changed','event_venue_changed','event_updated',
 'ticket_validated','organizer_verified','organizer_rejected','event_reminder_24h','event_reminder_1h') then return null; end if;
 return new;
end $$;
create trigger a_notification_v2_cutover before insert on public.notifications for each row execute function notification_private.suppress_legacy();

create function notification_private.emit(uid uuid,r text,k text,identity text,heading text,message text,payload jsonb,
 family text,importance text default 'normal',send_channels text[] default '{push,email}',expiry timestamptz default now()+interval '24 hours') returns void
language plpgsql security definer set search_path='' as $$
begin
 if uid is null or not (select capture_enabled from notification_private.config where singleton) then return; end if;
 insert into notification_private.outbox(user_id,role,kind,event_key,title,body,data,category,priority,channels,expires_at)
 values(uid,r,k,identity,left(heading,160),left(message,2000),payload,family,importance,send_channels,expiry)
 on conflict(user_id,role,event_key) do nothing;
end $$;

create function notification_private.capture_payment() returns trigger language plpgsql security definer set search_path='' as $$
declare ev uuid; event_title text; kind text; heading text; details text; n integer;
begin
 if new.status is not distinct from old.status or new.kind not in ('event_ticket','vip_table') then return new; end if;
 ev:=notification_private.as_uuid(new.metadata->>'event_id');
 select title into event_title from public.events where id=ev;
 event_title:=coalesce(nullif(event_title,''),'tu evento');
 if new.status='fulfilled' then
  kind:=case when new.kind='vip_table' then 'order.vip_confirmed' else 'order.admission_confirmed' end;
  heading:=case when new.kind='vip_table' then 'Tu mesa VIP está confirmada' else 'Tus entradas están confirmadas' end;
  details:=case when new.kind='vip_table' then 'Tu reserva para '||event_title||' está lista. Consulta el acceso de tu grupo y lo incluido en Mis entradas.'
   else 'Tu compra para '||event_title||' está confirmada. Consulta tus entradas y condiciones de acceso en Eclipse.' end;
 elsif new.status='refund_pending' then kind:='refund.processing'; heading:='Reembolso en proceso';
  details:='Estamos tramitando el reembolso de tu compra para '||event_title||'. Todavía no está completado.';
 elsif new.status='refunded' then kind:='refund.completed'; heading:='Reembolso tramitado';
  details:='Se ha tramitado el reembolso de tu compra para '||event_title||'. El abono depende de tu entidad de pago.';
 else return new; end if;
 perform notification_private.emit(new.user_id,'attendee',kind,'payment:'||new.id||':'||new.status,heading,details,
  jsonb_build_object('event_id',ev,'transaction_id',new.id,'destination','tickets'),'purchase',
  case when new.status='fulfilled' then 'normal' else 'high' end,
  case when new.status='refund_pending' then array['email'] else array['push','email'] end);
 -- Sales aggregation is a later phase: record no ungrouped organizer spam here.
 return new;
end $$;
create trigger notification_v2_payment after update of status on public.payment_transactions for each row execute function notification_private.capture_payment();

create function notification_private.capture_ticket() returns trigger language plpgsql security definer set search_path='' as $$
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
  elsif new.status in ('invalid','cancelled','revoked') and new.status is distinct from old.status then
   perform notification_private.emit(new.user_id,'attendee','ticket.invalidated','ticket:'||new.id||':invalidated','Tu entrada ya no es válida',
    'Revisa en Eclipse el estado de tu entrada para '||event_title||'. Invalidar una entrada no equivale a completar su reembolso.',
    jsonb_build_object('ticket_id',new.id,'event_id',new.event_id,'destination','tickets'),'change','high');
  end if;
 end if;
 return new;
end $$;
create trigger notification_v2_ticket after insert or update on public.tickets for each row execute function notification_private.capture_ticket();

alter table public.events add column if not exists notification_revision bigint not null default 0;
create function notification_private.revise_event() returns trigger language plpgsql set search_path='' as $$
begin
 new.notification_revision:=old.notification_revision;
 if row(new.event_date,new.end_datetime,new.venue_id,new.is_cancelled,new.status,new.access_policy,new.access_requirements,new.lineup,new.dress_code,new.age_restriction)
 is distinct from row(old.event_date,old.end_datetime,old.venue_id,old.is_cancelled,old.status,old.access_policy,old.access_requirements,old.lineup,old.dress_code,old.age_restriction)
 then new.notification_revision:=old.notification_revision+1; end if;
 return new;
end $$;
create trigger notification_v2_event_revision before update on public.events for each row execute function notification_private.revise_event();
create function notification_private.capture_event() returns trigger language plpgsql security definer set search_path='' as $$
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
   and t.payment_status='paid' and t.status in ('valid','active','used') and t.ticket_status not in ('cancelled','refunded','invalid') loop
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
create trigger notification_v2_event after update on public.events for each row execute function notification_private.capture_event();
create trigger notification_v2_event_delete before delete on public.events for each row execute function notification_private.capture_event();

create function notification_private.capture_assignment() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.worker_event_assignments%rowtype; uid uuid; k text;
begin
 if tg_op='DELETE' then a:=old; k:='worker.assignment_removed';
 else a:=new;
  if tg_op='UPDATE' and new.status is not distinct from old.status then return new; end if;
  k:=case when new.status='active' then 'worker.assignment_added' else 'worker.assignment_removed' end;
 end if;
 select user_id into uid from public.workers where id=a.worker_id and status='active';
 perform notification_private.emit(uid,'staff',k,'assignment:'||a.id||':'||k||':'||txid_current(),
  case when k='worker.assignment_added' then 'Tienes un evento asignado' else 'Asignación retirada' end,
  'Consulta tus asignaciones actuales en Eclipse.',jsonb_build_object('destination','worker'),'operation','normal',array['push']);
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger notification_v2_assignment after insert or update or delete on public.worker_event_assignments for each row execute function notification_private.capture_assignment();

create function notification_private.capture_verification() returns trigger language plpgsql security definer set search_path='' as $$
declare k text; heading text;
begin
 if new.role<>'organizer' or new.verification_status is not distinct from old.verification_status then return new; end if;
 if new.verification_status='verified' then k:='organizer.verification_approved'; heading:='Tu perfil está verificado';
 elsif new.verification_status in ('rejected','needs_correction') then k:='organizer.verification_changes'; heading:='Revisa tu verificación';
 elsif new.verification_status='pending_verification' then k:='organizer.verification_received'; heading:='Verificación recibida';
 else return new; end if;
 perform notification_private.emit(new.id,'organizer',k,'verification:'||new.id||':'||txid_current(),heading,
  'Consulta el estado y los siguientes pasos en tu perfil de organizador.',jsonb_build_object('destination','organizer'),'operation','normal');
 return new;
end $$;
create trigger notification_v2_verification after update of verification_status on public.profiles for each row execute function notification_private.capture_verification();

create function notification_private.is_current(o notification_private.outbox) returns boolean
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
      and t.user_id=o.user_id and t.payment_status='paid' and t.status in ('valid','active','used') and t.ticket_status not in ('cancelled','refunded','invalid'));
 end if;
 if o.kind in ('order.free_confirmed','order.box_office_issued') and o.data ? 'ticket_id' then
  return exists(select 1 from public.tickets t where t.id=notification_private.as_uuid(o.data->>'ticket_id') and t.user_id=o.user_id and t.payment_status='paid'
    and t.status in ('valid','active','used') and t.ticket_status not in ('cancelled','refunded','invalid'));
 end if;
 if o.kind in ('refund.processing','refund.completed') then
  return exists(select 1 from public.payment_transactions p where p.id=notification_private.as_uuid(o.data->>'transaction_id') and p.user_id=o.user_id
    and p.status=case when o.kind='refund.processing' then 'refund_pending' else 'refunded' end);
 end if;
 if o.kind like 'event.%' and o.kind<>'event.cancelled' then
  return exists(select 1 from public.tickets t where t.event_id=notification_private.as_uuid(o.data->>'event_id') and t.user_id=o.user_id
   and t.payment_status='paid' and t.status in ('valid','active','used') and t.ticket_status not in ('cancelled','refunded','invalid'));
 end if;
 if o.kind='worker.event_critical_change' then
  return exists(select 1 from public.worker_event_assignments a join public.workers w on w.id=a.worker_id where a.event_id=notification_private.as_uuid(o.data->>'event_id')
   and a.status='active' and w.user_id=o.user_id and w.status='active');
 end if;
 return true;
end $$;

create function notification_private.channel_allowed(o notification_private.outbox, ch text) returns boolean
language sql stable security definer set search_path='' as $$
 select case when ch='push' then coalesce(p.push_enabled,l.push_enabled,true) else coalesce(p.email_enabled,l.email_enabled,true) end
 and case o.category when 'purchase' then coalesce(p.purchase_updates,l.purchase_updates,true)
 when 'reminder' then coalesce(p.event_reminders,l.event_reminders,true)
 when 'change' then coalesce(p.event_changes,true) else coalesce(p.operations,true) end
 and (ch<>'push' or l.muted_until is null or l.muted_until<=now())
 from (select 1) x left join public.notification_preferences_v2 p on p.user_id=o.user_id and p.role=o.role
 left join public.notification_settings l on l.user_id=o.user_id
$$;

create function notification_private.quiet_until(o notification_private.outbox) returns timestamptz
language plpgsql stable security definer set search_path='' as $$
declare prefs public.notification_preferences_v2%rowtype; local_now timestamp; minute_now integer; quiet boolean; result timestamp;
begin
 -- User-initiated confirmation is immediate. Optional event-night override is NOT enabled by default.
 if o.kind like 'order.%' then return now(); end if;
 select * into prefs from public.notification_preferences_v2 where user_id=o.user_id and role=o.role;
 if found and not prefs.quiet_enabled then return now(); end if;
 prefs.timezone:=coalesce(prefs.timezone,'Europe/Madrid'); prefs.quiet_start:=coalesce(prefs.quiet_start,0); prefs.quiet_end:=coalesce(prefs.quiet_end,660);
 local_now:=now() at time zone prefs.timezone; minute_now:=extract(hour from local_now)::integer*60+extract(minute from local_now)::integer;
 if prefs.quiet_start=prefs.quiet_end then return now(); end if;
 quiet:=case when prefs.quiet_start<prefs.quiet_end then minute_now>=prefs.quiet_start and minute_now<prefs.quiet_end else minute_now>=prefs.quiet_start or minute_now<prefs.quiet_end end;
 if not quiet then return now(); end if;
 if coalesce(prefs.event_night_override,false) and o.category in ('change','reminder','operation') and exists(
  select 1 from public.events e where e.id=notification_private.as_uuid(o.data->>'event_id') and now() between e.event_date-interval '4 hours' and coalesce(e.end_datetime,e.event_date+interval '5 hours')
   and (exists(select 1 from public.tickets t where t.event_id=e.id and t.user_id=o.user_id and t.payment_status='paid') or exists(select 1 from public.workers w join public.worker_event_assignments a on a.worker_id=w.id where a.event_id=e.id and a.status='active' and w.user_id=o.user_id and w.status='active'))
 ) then return now(); end if;
 result:=date_trunc('day',local_now)+make_interval(mins=>prefs.quiet_end);
 if result<=local_now then result:=result+interval '1 day'; end if;
 return result at time zone prefs.timezone;
end $$;

create function notification_private.schedule_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare r record; due timestamptz; k text; deadline timestamptz; total integer:=0; cutoff timestamptz;
begin
 select cutover_at into cutoff from notification_private.config where singleton and capture_enabled;
 if cutoff is null then return 0; end if;
 -- Five minute tolerance, not retrospective delivery of missed reminders. Bound each scheduler tick.
 for r in
 with eligible as (
  select t.user_id,e.id as event_id,e.title,e.event_date,min(t.entry_deadline) as deadline,min(t.purchase_date) as purchased
  from public.tickets t join public.events e on e.id=t.event_id
  where t.user_id is not null and t.status in ('valid','active') and t.ticket_status='active' and t.validation_status='valid'
   and t.payment_status='paid' and t.scanned_at is null and not coalesce(e.is_cancelled,false) and e.status not in ('cancelled','deleted')
   and coalesce(e.end_datetime,e.event_date+interval '5 hours')>now() and (t.entry_deadline is null or t.entry_deadline>now())
   and (e.event_date between now()-interval '5 hours' and now()+interval '24 hours 5 minutes')
  group by t.user_id,e.id,e.title,e.event_date
 ), candidates as (
  select e.*,v.kind,v.due,'reminder:'||e.event_id||':'||v.kind||':'||e.event_date::text||coalesce(e.deadline::text,'') as identity
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
   least(r.due+interval '30 minutes',coalesce(r.deadline,r.event_date),r.event_date));
  total:=total+1;
 end loop;
 return total;
end $$;

create function public.prepare_notifications_v2(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o notification_private.outbox%rowtype; nid uuid; n integer:=0; reminders integer;
begin
 if not(select capture_enabled from notification_private.config where singleton) then return jsonb_build_object('prepared',0); end if;
 reminders:=notification_private.schedule_reminders();
 for o in select * from notification_private.outbox where processed_at is null and due_at<=now()
  order by due_at,id for update skip locked limit greatest(1,least(coalesce(p_limit,100),200)) loop
  if (o.category='reminder' and o.expires_at<=now()) or not notification_private.is_current(o) then
   update notification_private.outbox set processed_at=now(),disposition='expired_or_ineligible' where id=o.id; continue;
  end if;
  -- Old dispatcher cannot see v2 deliveries: inbox channels intentionally stay in_app only.
  insert into public.notifications(user_id,role,type,title,body,message,data,priority,status,channels,delivery_version,dedupe_key,category,expires_at)
   values(o.user_id,o.role,o.kind,o.title,o.body,o.body,o.data||jsonb_build_object('type',o.kind,'schema_version',2),o.priority,'sent',array['in_app'],2,o.event_key,o.category,o.expires_at)
   on conflict(user_id,role,dedupe_key) where delivery_version=2 do update set dedupe_key=excluded.dedupe_key returning id into nid;
  if o.expires_at>now() and 'push'=any(o.channels) and notification_private.channel_allowed(o,'push') then
   insert into notification_private.deliveries(notification_id,outbox_id,user_id,channel,target_key,installation_id,binding_id,next_attempt_at)
   select nid,o.id,o.user_id,'push',i.binding_id::text,i.installation_id,i.binding_id,notification_private.quiet_until(o)
    from notification_private.installations i join auth.sessions s on s.id=i.session_id and s.user_id=i.user_id
    where i.user_id=o.user_id and i.active and (s.not_after is null or s.not_after>now())
   on conflict(notification_id,channel,target_key) do nothing;
  end if;
  if o.expires_at>now() and 'email'=any(o.channels) and notification_private.channel_allowed(o,'email') then
   insert into notification_private.deliveries(notification_id,outbox_id,user_id,channel,target_key,email)
    select nid,o.id,o.user_id,'email','email',u.email from auth.users u where u.id=o.user_id and u.email_confirmed_at is not null and u.email is not null
   on conflict(notification_id,channel,target_key) do nothing;
  end if;
  update notification_private.outbox set processed_at=now(),disposition='prepared' where id=o.id; n:=n+1;
 end loop;
 return jsonb_build_object('prepared',n,'reminder_candidates',reminders);
end $$;

create function public.notification_preferences_v2_get(p_role text) returns public.notification_preferences_v2
language plpgsql security definer set search_path='' as $$
declare result public.notification_preferences_v2%rowtype;
begin
 if notification_private.own_role(auth.uid(),p_role) is not true then raise exception 'Forbidden' using errcode='42501'; end if;
 insert into public.notification_preferences_v2(user_id,role,push_enabled,email_enabled,purchase_updates,event_reminders)
 select auth.uid(),p_role,coalesce(l.push_enabled,true),coalesce(l.email_enabled,true),coalesce(l.purchase_updates,true),coalesce(l.event_reminders,true)
 from (select 1) x left join public.notification_settings l on l.user_id=auth.uid() on conflict(user_id,role) do nothing;
 select * into result from public.notification_preferences_v2 where user_id=auth.uid() and role=p_role; return result;
end $$;

create function public.notification_inbox_action_v2(p_action text,p_ids uuid[] default null,p_role text default null,p_expected_user uuid default auth.uid()) returns integer
language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
 if auth.uid() is null or p_expected_user is distinct from auth.uid() or p_action is null or p_action not in ('read','unread','archive','unarchive') or coalesce(cardinality(p_ids),0)>200 then raise exception 'Invalid request' using errcode='42501'; end if;
 if p_role is not null and not notification_private.own_role(auth.uid(),p_role) then raise exception 'Forbidden' using errcode='42501'; end if;
 update public.notifications n set
  status=case when n.delivery_version=1 and p_action='unread' and n.status='read' then 'sent' else n.status end,
  read=case p_action when 'read' then true when 'unread' then false else n.read end,
  read_at=case p_action when 'read' then coalesce(n.read_at,now()) when 'unread' then null else n.read_at end,
  archived_at=case p_action when 'archive' then coalesce(n.archived_at,now()) when 'unarchive' then null else n.archived_at end
 where n.user_id=auth.uid() and notification_private.own_role(n.user_id,n.role)
   and (p_ids is null or n.id=any(p_ids)) and (p_role is null or n.role=p_role);
 get diagnostics affected=row_count; return affected;
end $$;

create function public.register_notification_installation_v2(p_installation_id uuid,p_expected_user uuid,p_token text,p_platform text,p_project_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare sid uuid; known_installation uuid;
begin
 p_installation_id:=coalesce(p_installation_id,gen_random_uuid());
 sid:=notification_private.as_uuid(auth.jwt()->>'session_id');
 if auth.uid() is null or p_expected_user is distinct from auth.uid() or sid is null or not exists(select 1 from auth.sessions where id=sid and user_id=auth.uid() and (not_after is null or not_after>now()))
 then raise exception 'Invalid session' using errcode='42501'; end if;
 if p_installation_id is null or p_project_id is null or p_platform is null or p_platform not in ('ios','android') or p_token is null or p_token !~ '^(ExpoPushToken|ExponentPushToken)\[[A-Za-z0-9_-]{10,200}\]$'
 then raise exception 'Invalid installation' using errcode='22023'; end if;
 -- Serialize re-registration of the same token without leaking its identity.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_token,0));
 select installation_id into known_installation from notification_private.installations where token=p_token;
 if known_installation is not null then p_installation_id:=known_installation;
 elsif exists(select 1 from notification_private.installations where installation_id=p_installation_id and user_id<>auth.uid()) then
  p_installation_id:=gen_random_uuid();
 end if;
 update public.user_push_tokens set is_active=false where token=p_token;
 -- Keep binding stable on same session; rotate on account/session/token change.
 insert into notification_private.installations(installation_id,user_id,session_id,token,platform,project_id)
 values(p_installation_id,auth.uid(),sid,p_token,p_platform,p_project_id)
 on conflict(installation_id) do update set user_id=excluded.user_id,session_id=excluded.session_id,token=excluded.token,platform=excluded.platform,project_id=excluded.project_id,
 binding_id=case when row(notification_private.installations.user_id,notification_private.installations.session_id,notification_private.installations.token) is distinct from row(excluded.user_id,excluded.session_id,excluded.token)
  then gen_random_uuid() else notification_private.installations.binding_id end,active=true,updated_at=now();
 return p_installation_id;
end $$;
create function public.unregister_notification_installation_v2(p_installation_id uuid,p_expected_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_expected_user is distinct from auth.uid() then raise exception 'Not authenticated' using errcode='42501'; end if;
 update notification_private.installations set active=false,binding_id=gen_random_uuid(),updated_at=now() where installation_id=p_installation_id and user_id=auth.uid();
end $$;

create function public.claim_notification_deliveries_v2(p_limit integer default 10,p_channels text[] default '{push,email}') returns table(id uuid,lease_token uuid)
language plpgsql security definer set search_path='' as $$
begin
 if not(select capture_enabled and live_delivery_enabled from notification_private.config where singleton) then return; end if;
 -- An abandoned request is ambiguous: do not blindly resend push. Email can use provider idempotency.
 update notification_private.deliveries set status=case when channel='push' then 'unknown' when attempts>=5 then 'failed' else 'pending' end,last_code='LEASE_EXPIRED',lease_token=null,lease_until=null
  where status='processing' and lease_until<now();
 return query with chosen as(select d.id from notification_private.deliveries d cross join notification_private.config c
  where d.status='pending' and d.channel=any(p_channels) and d.next_attempt_at<=now() and d.attempts<5 and (c.allow_all_recipients or d.user_id=any(c.allowed_recipients))
  order by d.next_attempt_at,d.id for update of d skip locked limit greatest(1,least(coalesce(p_limit,10),20)))
 update notification_private.deliveries d set status='processing',attempts=d.attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '3 minutes',updated_at=now()
 from chosen where d.id=chosen.id returning d.id,d.lease_token;
end $$;

create function public.authorize_notification_delivery_v2(p_id uuid,p_lease uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d notification_private.deliveries%rowtype; o notification_private.outbox%rowtype; device notification_private.installations%rowtype; until_time timestamptz;
begin
 select * into d from notification_private.deliveries where id=p_id and lease_token=p_lease and status='processing' and lease_until>now() for update;
 if not found then return null; end if;
 select * into o from notification_private.outbox where id=d.outbox_id;
 if not(select capture_enabled and live_delivery_enabled and (allow_all_recipients or d.user_id=any(allowed_recipients)) from notification_private.config where singleton)
    or not notification_private.is_current(o) or not notification_private.channel_allowed(o,d.channel) then
  update notification_private.deliveries set status='cancelled',last_code='SUPPRESSED',updated_at=now() where id=d.id; return null;
 end if;
 if o.expires_at<=now() then update notification_private.deliveries set status='expired',last_code='EXPIRED',updated_at=now() where id=d.id; return null; end if;
 if d.channel='push' then
  until_time:=notification_private.quiet_until(o);
  if until_time>now() then update notification_private.deliveries set status=case when until_time>=o.expires_at then 'expired' else 'pending' end,next_attempt_at=until_time,attempts=greatest(attempts-1,0),lease_token=null,lease_until=null,last_code='QUIET_HOURS' where id=d.id; return null; end if;
  select i.* into device from notification_private.installations i join auth.sessions s on s.id=i.session_id and s.user_id=i.user_id
   where i.installation_id=d.installation_id and i.binding_id=d.binding_id and i.user_id=d.user_id and i.active and (s.not_after is null or s.not_after>now());
  if not found then update notification_private.deliveries set status='cancelled',last_code='BINDING_REVOKED',updated_at=now() where id=d.id; return null; end if;
 else
  if not exists(select 1 from auth.users u where u.id=d.user_id and u.email=d.email and u.email_confirmed_at is not null) then
   update notification_private.deliveries set status='cancelled',last_code='EMAIL_CHANGED',updated_at=now() where id=d.id; return null;
  end if;
 end if;
 return jsonb_build_object('id',d.id,'notification_id',d.notification_id,'channel',d.channel,'to',case when d.channel='push' then device.token else d.email end,
   'project_id',device.project_id,'title',o.title,'body',o.body,'category',o.category,'priority',o.priority,'expires_at',o.expires_at,'attempts',d.attempts);
end $$;

create function public.complete_notification_delivery_v2(p_id uuid,p_lease uuid,p_outcome text,p_code text default null,p_provider_id text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare d notification_private.deliveries%rowtype; next_status text;
begin
 if p_outcome is null or p_outcome not in ('accepted','retry','failed','unknown','unregistered') or length(coalesce(p_provider_id,''))>200 or coalesce(p_code,'')!~ '^[A-Za-z0-9_:-]{0,80}$' then raise exception 'Invalid result'; end if;
 select * into d from notification_private.deliveries where id=p_id and lease_token=p_lease and status='processing' and lease_until>now() for update;
 if not found then return false; end if;
 next_status:=case when p_outcome='retry' and d.attempts<5 then 'pending' when p_outcome in ('retry','unregistered') then 'failed' else p_outcome end;
 if p_outcome='accepted' and nullif(p_provider_id,'') is null then raise exception 'Missing provider ID'; end if;
 if p_outcome='unregistered' then update notification_private.installations set active=false,updated_at=now() where installation_id=d.installation_id and binding_id=d.binding_id; end if;
 update notification_private.deliveries set status=next_status,provider_id=p_provider_id,last_code=p_code,
  next_attempt_at=now()+make_interval(secs=>least(900,(30*power(2,d.attempts))::integer)),
  accepted_at=case when next_status='accepted' then now() else accepted_at end,
  receipt_check_at=case when next_status='accepted' and channel='push' then now()+interval '15 minutes' else null end,
  lease_token=null,lease_until=null,updated_at=now() where id=d.id;
 insert into notification_private.delivery_audit(delivery_id,status,code) values(d.id,next_status,p_code);
 return true;
end $$;

create function public.notification_receipts_v2(p_limit integer default 100) returns table(id uuid,provider_id text,accepted_at timestamptz)
language sql security definer set search_path='' as $$
 select d.id,d.provider_id,d.accepted_at from notification_private.deliveries d where d.channel='push' and d.status='accepted' and d.receipt_check_at<=now()
 order by d.receipt_check_at limit greatest(1,least(coalesce(p_limit,100),100))
$$;
create function public.complete_notification_receipt_v2(p_id uuid,p_provider_id text,p_outcome text,p_code text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare d notification_private.deliveries%rowtype; next_status text;
begin
 if p_outcome is null or p_outcome not in ('confirmed','failed','missing','unregistered') or coalesce(p_code,'')!~ '^[A-Za-z0-9_:-]{0,80}$' then raise exception 'Invalid receipt'; end if;
 select * into d from notification_private.deliveries where id=p_id and provider_id=p_provider_id and status='accepted' and channel='push' for update;
 if not found then return false; end if;
 next_status:=case when p_outcome='missing' and d.accepted_at>now()-interval '23 hours' then 'accepted' when p_outcome='missing' then 'unknown' when p_outcome='unregistered' then 'failed' else p_outcome end;
 if p_outcome='unregistered' then update notification_private.installations set active=false,updated_at=now() where installation_id=d.installation_id and binding_id=d.binding_id; end if;
 update notification_private.deliveries set status=next_status,last_code=p_code,receipt_check_at=now()+interval '15 minutes',updated_at=now() where id=d.id;
 if next_status<>'accepted' then insert into notification_private.delivery_audit(delivery_id,status,code) values(d.id,next_status,p_code); end if;
 return true;
end $$;

create function public.notification_health_v2() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not notification_private.own_role(auth.uid(),'admin') then raise exception 'Forbidden' using errcode='42501'; end if;
 return jsonb_build_object('capture_enabled',(select capture_enabled from notification_private.config where singleton),
 'live_delivery_enabled',(select live_delivery_enabled from notification_private.config where singleton),
 'outbox_pending',(select count(*) from notification_private.outbox where processed_at is null),
 'deliveries',(select jsonb_object_agg(status,n) from(select status,count(*) n from notification_private.deliveries group by status) s));
end $$;


-- Keyset pagination and counts are authoritative and user-scoped, not calculated from one loaded page.
create function public.notification_inbox_v2(p_role text default null,p_archived boolean default false,p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50,p_filter text default 'all') returns jsonb
language plpgsql security definer set search_path='' as $$
declare records jsonb; unread bigint; roles jsonb;
begin
 if auth.uid() is null or (p_role is not null and not notification_private.own_role(auth.uid(),p_role)) then raise exception 'Forbidden' using errcode='42501'; end if;
 if p_filter is null or p_filter not in ('all','unread','important') then raise exception 'Invalid filter'; end if;
 if (p_before is null) is distinct from (p_before_id is null) then raise exception 'Invalid cursor'; end if;
 select jsonb_agg(r) into roles from (values ('attendee'),('organizer'),('staff'),('admin')) all_roles(r) where notification_private.own_role(auth.uid(),r);
 select count(*) into unread from public.notifications n where n.user_id=auth.uid() and notification_private.own_role(n.user_id,n.role)
   and (p_role is null or n.role=p_role) and n.archived_at is null and not n.read and n.read_at is null and n.status<>'read';
 select coalesce(jsonb_agg(row_data order by row_data->>'created_at' desc,row_data->>'id' desc),'[]'::jsonb) into records from (
  select to_jsonb(n) as row_data from public.notifications n where n.user_id=auth.uid() and notification_private.own_role(n.user_id,n.role)
    and (p_role is null or n.role=p_role) and (n.archived_at is not null)=p_archived
    and (p_filter='all' or (p_filter='important' and n.priority='high') or (p_filter='unread' and not n.read and n.read_at is null and n.status<>'read'))
    and (p_before is null or (n.created_at,n.id)<(p_before,p_before_id))
  order by n.created_at desc,n.id desc limit greatest(1,least(coalesce(p_limit,50),50))
 ) page;
 return jsonb_build_object('items',records,'unread_count',unread,'roles',coalesce(roles,'[]'::jsonb));
end $$;
create function public.notification_detail_v2(p_id uuid) returns jsonb
language sql security definer set search_path='' as $$
 select to_jsonb(n) from public.notifications n where n.id=p_id and n.user_id=auth.uid() and notification_private.own_role(n.user_id,n.role)
$$;
create function public.notification_destination_v2(p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare n public.notifications%rowtype; ev uuid;
begin
 select * into n from public.notifications where id=p_id and user_id=auth.uid() and notification_private.own_role(user_id,role);
 if not found then return null; end if;
 if n.role='organizer' then return '/(creator)/'; end if;
 if n.role='staff' then return '/(worker)/'; end if;
 if n.role='admin' then return '/(creator)/admin-profile'; end if;
 if n.data->>'destination'='tickets' or n.type like 'order.%' or n.type like 'refund.%' or n.type like 'reminder.%' then return '/(tabs)/tickets'; end if;
 ev:=notification_private.as_uuid(n.data->>'event_id');
 if ev is not null and exists(select 1 from public.events e join public.tickets t on t.event_id=e.id where e.id=ev and t.user_id=auth.uid()) then return '/(tabs)/event/'||ev; end if;
 return '/notifications';
end $$;

-- Every internal entry point is denied to clients, including defaults inherited from PUBLIC.
revoke all on all tables in schema notification_private from public,anon,authenticated;
revoke all on all functions in schema notification_private from public,anon,authenticated;
grant all on all tables in schema notification_private to service_role;
grant usage,select on all sequences in schema notification_private to service_role;
grant execute on all functions in schema notification_private to service_role;
grant usage on schema notification_private to authenticated;
grant execute on function notification_private.own_role(uuid,text) to authenticated;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (
 'notification_inbox_v2','notification_detail_v2','notification_destination_v2','prepare_notifications_v2','notification_preferences_v2_get','notification_inbox_action_v2','register_notification_installation_v2','unregister_notification_installation_v2',
 'claim_notification_deliveries_v2','authorize_notification_delivery_v2','complete_notification_delivery_v2','notification_receipts_v2','complete_notification_receipt_v2','notification_health_v2') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
  if f.proname in ('notification_inbox_v2','notification_detail_v2','notification_destination_v2','notification_preferences_v2_get','notification_inbox_action_v2','register_notification_installation_v2','unregister_notification_installation_v2','notification_health_v2') then
   execute format('grant execute on function %s to authenticated',f.signature);
  end if;
 end loop;
end $$;
