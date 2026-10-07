-- Operational notifications extend v2 without activating capture, schedules or real recipients.
-- Named by Supabase CLI 2.120.0. Never replay the legacy migration chain.
alter table notification_private.config add column operations_enabled boolean not null default false;
alter table public.notification_preferences_v2 add column sales_mode text not null default 'grouped'
 check(sales_mode in ('grouped','immediate','off'));
alter table public.notification_preferences_v2 add column vip_sales_immediate boolean not null default false;
alter table public.notification_preferences_v2 add column stock_alerts boolean not null default true;

create table notification_private.sale_facts (
 id uuid primary key default gen_random_uuid(), source_key text not null unique, order_key text not null,
 source_kind text not null check(source_kind in ('payment','ticket')), source_id uuid not null,
 organizer_id uuid not null references auth.users(id) on delete cascade, event_id uuid not null,
 product_kind text not null check(product_kind in ('admission','vip_table','invitation','box_office')),
 units integer not null check(units between 1 and 100000), amount_cents bigint check(amount_cents>=0),
 mode text not null check(mode in ('grouped','immediate','off')), due_at timestamptz not null,
 captured_at timestamptz not null default now(), processed_at timestamptz
);
create index notification_sale_facts_ready on notification_private.sale_facts(due_at,organizer_id,event_id,id) where processed_at is null;
alter table notification_private.sale_facts enable row level security;

-- VIP schema stores available tables, not original table capacity. Use honest absolute thresholds.
create table notification_private.stock_state (
 product_kind text not null check(product_kind in ('admission','vip_table')), product_id uuid not null,
 event_id uuid not null, band integer not null, revision bigint not null default 0,
 available integer not null, active boolean not null, updated_at timestamptz not null default now(),
 primary key(product_kind,product_id)
);
alter table notification_private.stock_state enable row level security;

create table notification_private.worker_health (
 singleton boolean primary key default true check(singleton),
 last_started_at timestamptz, last_completed_at timestamptz, last_failed_at timestamptz,
 last_status text not null default 'never' check(last_status in ('never','running','disabled','processed','failed')),
 processed integer not null default 0, receipts integer not null default 0,
 push_configured boolean, email_configured boolean
);
insert into notification_private.worker_health(singleton) values(true);
alter table notification_private.worker_health enable row level security;

create function notification_private.operations_active() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select capture_enabled and operations_enabled from notification_private.config where singleton),false)
$$;
create function notification_private.nonnegative_integer(value text) returns bigint language sql immutable set search_path='' as $$
 select case when value ~ '^[0-9]{1,12}$' then value::bigint else null end
$$;
create function notification_private.stock_band(kind text,remaining integer,total integer) returns integer language sql immutable set search_path='' as $$
 select case when remaining<=0 then 0
 when kind='vip_table' then case when remaining<=2 then remaining else 100 end
 when total>0 and remaining::numeric/total<=0.05 then 5
 when total>0 and remaining::numeric/total<=0.20 then 20 else 100 end
$$;

create function notification_private.record_sale(source text,reference uuid,order_identity text,organizer uuid,ev uuid,kind text,n integer,cents bigint) returns void
language plpgsql security definer set search_path='' as $$
declare preference public.notification_preferences_v2%rowtype; mode text; deadline timestamptz;
begin
 if not notification_private.operations_active() or organizer is null or not notification_private.role_active(organizer,'organizer') then return; end if;
 if not exists(select 1 from public.events e where e.id=ev and e.creator_id=organizer and not coalesce(e.is_cancelled,false) and coalesce(e.status,'') not in ('cancelled','deleted')) then return; end if;
 select * into preference from public.notification_preferences_v2 where user_id=organizer and role='organizer';
 mode:=coalesce(preference.sales_mode,'grouped');
 if mode<>'off' and kind='vip_table' and coalesce(preference.vip_sales_immediate,false) then mode:='immediate'; end if;
 -- Invitations and in-person sales are aggregated, never one interrupting push per free admission.
 if kind in ('invitation','box_office') and mode='immediate' then mode:='grouped'; end if;
 deadline:=case when mode='immediate' then now() else date_bin(interval '15 minutes',now(),timestamptz '2000-01-01 00:00:00+00')+interval '15 minutes' end;
 insert into notification_private.sale_facts(source_key,order_key,source_kind,source_id,organizer_id,event_id,product_kind,units,amount_cents,mode,due_at)
 values(source||':'||reference,order_identity,source,reference,organizer,ev,kind,greatest(1,least(n,100000)),cents,mode,deadline)
 on conflict(source_key) do nothing;
end $$;

create function notification_private.capture_sale_payment() returns trigger language plpgsql security definer set search_path='' as $$
declare ev uuid; organizer uuid; n integer; cents bigint;
begin
 if not notification_private.operations_active() or new.status is not distinct from old.status or new.status<>'fulfilled' or new.kind not in ('event_ticket','vip_table') then return new; end if;
 ev:=notification_private.as_uuid(new.metadata->>'event_id');
 select creator_id into organizer from public.events where id=ev;
 n:=case when new.kind='vip_table' then 1 else greatest(1,least(coalesce(notification_private.nonnegative_integer(new.metadata->>'quantity'),1),100000))::integer end;
 -- Product subtotal only: never present service fees or gross revenue as an organizer payout.
 cents:=coalesce(notification_private.nonnegative_integer(new.metadata->>'discounted_total_cents'),notification_private.nonnegative_integer(new.metadata->>'original_total_cents'));
 perform notification_private.record_sale('payment',new.id,'payment:'||new.id,organizer,ev,
  case when new.kind='vip_table' then 'vip_table' else 'admission' end,n,cents);
 return new;
end $$;
create trigger notification_v2_sale_payment after update of status on public.payment_transactions for each row execute function notification_private.capture_sale_payment();

create function notification_private.capture_sale_ticket() returns trigger language plpgsql security definer set search_path='' as $$
declare organizer uuid; kind text; order_identity text; cents bigint;
begin
 if not notification_private.operations_active() or new.payment_transaction_id is not null or new.stripe_payment_intent_id is not null or
 new.payment_status is distinct from 'paid' or new.status not in ('valid','active') or new.ticket_status is distinct from 'active' then return new; end if;
 if new.sold_by_worker_id is not null then kind:='box_office'; order_identity:='ticket:'||new.id;
 elsif new.free_claim_id is not null or new.total_price=0 then kind:='invitation'; order_identity:='free:'||coalesce(new.free_claim_id,new.id);
 else return new; end if;
 select creator_id into organizer from public.events where id=new.event_id;
 cents:=case when new.total_price>=0 and new.total_price<10000000000 then round(new.total_price*100)::bigint else null end;
 perform notification_private.record_sale('ticket',new.id,order_identity,organizer,new.event_id,kind,coalesce(new.quantity,1),cents);
 return new;
end $$;
create trigger notification_v2_sale_ticket after insert on public.tickets for each row execute function notification_private.capture_sale_ticket();

create function notification_private.sale_current(f notification_private.sale_facts) returns boolean language sql stable security definer set search_path='' as $$
 select notification_private.role_active(f.organizer_id,'organizer') and exists(select 1 from public.events e where e.id=f.event_id and e.creator_id=f.organizer_id
  and not coalesce(e.is_cancelled,false) and coalesce(e.status,'') not in ('cancelled','deleted'))
 and case when f.source_kind='payment' then exists(select 1 from public.payment_transactions p where p.id=f.source_id and p.status='fulfilled'
   and notification_private.as_uuid(p.metadata->>'event_id')=f.event_id)
 else exists(select 1 from public.tickets t where t.id=f.source_id and t.event_id=f.event_id and t.payment_status='paid'
   and t.status in ('valid','active','used') and t.ticket_status in ('active','used') and t.validation_status in ('valid','used')) end
$$;

create function notification_private.prepare_sales(p_limit integer default 50) returns integer language plpgsql security definer set search_path='' as $$
declare g record; a record; locked uuid[]; good uuid[]; parts text[]; heading text; message text; identity text; event_title text; emitted integer:=0;
begin
 if not notification_private.operations_active() then return 0; end if;
 for g in select organizer_id,event_id,due_at,mode from notification_private.sale_facts where processed_at is null and due_at<=now()
 group by organizer_id,event_id,due_at,mode order by due_at,organizer_id,event_id limit greatest(1,least(coalesce(p_limit,50),100)) loop
  -- Serialize each aggregation group. Separate groups remain concurrent.
  if not pg_try_advisory_xact_lock(hashtextextended('notification-sales:'||g.organizer_id||':'||g.event_id||':'||extract(epoch from g.due_at)||':'||g.mode,0)) then continue; end if;
  select array_agg(s.id order by s.id) into locked from (select id from notification_private.sale_facts where organizer_id=g.organizer_id and event_id=g.event_id
    and due_at=g.due_at and mode=g.mode and processed_at is null order by id limit 500 for update skip locked) s;
  if coalesce(cardinality(locked),0)=0 then continue; end if;
  select array_agg(f.id order by f.id) into good from notification_private.sale_facts f where f.id=any(locked) and notification_private.sale_current(f)
   and f.captured_at>now()-interval '24 hours';
  if coalesce(cardinality(good),0)>0 then
   select count(distinct order_key) as orders,coalesce(sum(units) filter(where product_kind='admission'),0) as admissions,
    coalesce(sum(units) filter(where product_kind='vip_table'),0) as tables,
    coalesce(sum(units) filter(where product_kind='invitation'),0) as invitations,
    coalesce(sum(units) filter(where product_kind='box_office'),0) as box_office,
    case when count(amount_cents)=count(*) then sum(amount_cents) else null end as cents
   into a from notification_private.sale_facts where id=any(good);
   select title into event_title from public.events where id=g.event_id;
   parts:='{}';
   if a.admissions>0 then parts:=array_append(parts,a.admissions||case when a.admissions=1 then ' unidad de entrada' else ' unidades de entrada' end); end if;
   if a.tables>0 then parts:=array_append(parts,a.tables||case when a.tables=1 then ' mesa VIP' else ' mesas VIP' end); end if;
   if a.invitations>0 then parts:=array_append(parts,a.invitations||case when a.invitations=1 then ' invitación gratuita' else ' invitaciones gratuitas' end); end if;
   if a.box_office>0 then parts:=array_append(parts,a.box_office||case when a.box_office=1 then ' unidad de taquilla' else ' unidades de taquilla' end); end if;
   heading:=case when g.mode='immediate' and a.tables=1 and cardinality(parts)=1 then 'Nueva reserva de mesa VIP' when g.mode='immediate' then 'Nueva venta' else 'Resumen de ventas' end;
   message:=coalesce(event_title,'Tu evento')||': se registraron '||array_to_string(parts,', ')||'.';
   if a.cents is not null then message:=message||' Importe de productos: '||to_char(a.cents/100.0,'FM999999999999990.00')||' €. No es una liquidación ni el saldo disponible.'; end if;
   message:=message||' Consulta el panel para ver cambios y reembolsos posteriores.';
   -- Membership-based identity safely handles late commits without losing sales or double counting.
   identity:='sales:'||md5(array_to_string(good,','));
   perform notification_private.emit(g.organizer_id,'organizer',case when g.mode='immediate' then 'organizer.sales_instant' else 'organizer.sales_digest' end,
    identity,heading,message,jsonb_build_object('event_id',g.event_id,'destination','organizer','orders',a.orders,'ticket_units',a.admissions,
    'vip_tables',a.tables,'invitations',a.invitations,'box_office_units',a.box_office,'product_subtotal_cents',a.cents,'period_end',g.due_at),
    'operation','normal',case when g.mode='off' then '{}'::text[] else array['push'] end,g.due_at+interval '24 hours');
   emitted:=emitted+1;
  end if;
  update notification_private.sale_facts set processed_at=now() where id=any(locked);
 end loop;
 return emitted;
end $$;

create function notification_private.capture_stock() returns trigger language plpgsql security definer set search_path='' as $$
declare v_kind text; item jsonb; previous jsonb; remaining integer; before_remaining integer; total integer; before_total integer;
 active boolean; before_active boolean; band integer; before_band integer; previous_state notification_private.stock_state%rowtype; next_revision bigint;
 ev uuid; product uuid; organizer uuid; event_title text; label text; heading text; message text; channels text[];
begin
 if not notification_private.operations_active() then if tg_op='DELETE' then return old; else return new; end if; end if;
 v_kind:=case when tg_table_name='reservados_vip' then 'vip_table' else 'admission' end;
 if tg_op='DELETE' then
  update notification_private.stock_state set active=false,revision=stock_state.revision+1,updated_at=now() where product_kind=v_kind and product_id=old.id;
  return old;
 end if;
 item:=to_jsonb(new); previous:=case when tg_op='INSERT' then item else to_jsonb(old) end;
 ev:=notification_private.as_uuid(item->>'event_id'); product:=notification_private.as_uuid(item->>'id');
 remaining:=case when v_kind='vip_table' then coalesce((item->>'quantity_available')::integer,0) else coalesce((item->>'quantity')::integer,0)-coalesce((item->>'sold')::integer,0) end;
 before_remaining:=case when v_kind='vip_table' then coalesce((previous->>'quantity_available')::integer,0) else coalesce((previous->>'quantity')::integer,0)-coalesce((previous->>'sold')::integer,0) end;
 total:=coalesce((item->>'quantity')::integer,0); before_total:=coalesce((previous->>'quantity')::integer,0);
 active:=coalesce((item->>'is_active')::boolean,false) and item->>'deleted_at' is null;
 before_active:=coalesce((previous->>'is_active')::boolean,false) and previous->>'deleted_at' is null;
 band:=notification_private.stock_band(v_kind,remaining,total); before_band:=notification_private.stock_band(v_kind,before_remaining,before_total);
 select * into previous_state from notification_private.stock_state where product_kind=v_kind and product_id=product for update;
 next_revision:=coalesce(previous_state.revision,0)+case when band is distinct from coalesce(previous_state.band,before_band)
  or band is distinct from before_band or active is distinct from coalesce(previous_state.active,before_active) or (previous_state.event_id is not null and previous_state.event_id<>ev) then 1 else 0 end;
 insert into notification_private.stock_state(product_kind,product_id,event_id,band,revision,available,active)
 values(v_kind,product,ev,band,next_revision,greatest(remaining,0),active)
 on conflict(product_kind,product_id) do update set event_id=excluded.event_id,band=excluded.band,revision=excluded.revision,available=excluded.available,active=excluded.active,updated_at=now();
 -- No notification for creating/relabeling an offer or merely increasing/replenishing inventory.
 if tg_op='INSERT' or not active or not before_active or remaining>=before_remaining or band>=before_band or band=100 then return new; end if;
 select e.creator_id,e.title into organizer,event_title from public.events e where e.id=ev and not coalesce(e.is_cancelled,false) and coalesce(e.status,'') not in ('cancelled','deleted')
 and coalesce(e.end_datetime,e.event_date+interval '5 hours')>now();
 if organizer is null or not notification_private.role_active(organizer,'organizer') then return new; end if;
 label:=coalesce(nullif(item->>'name',''),case when v_kind='vip_table' then 'Mesa VIP' else 'Entrada' end);
 heading:=case when band=0 then 'Producto agotado' when v_kind='vip_table' and band=1 then 'Última mesa disponible' when v_kind='vip_table' then 'Últimas mesas disponibles' else 'Quedan pocas entradas' end;
 message:=coalesce(event_title,'Tu evento')||' · '||label||': '||case when band=0 then 'ya no quedan unidades disponibles.'
 when v_kind='vip_table' and band=1 then 'queda una mesa disponible.' when v_kind='vip_table' then 'quedan dos mesas disponibles.'
 else 'queda como máximo el '||band||'% del cupo configurado.' end||' Revisa el inventario actual en tu panel.';
 channels:=array['push'];
 if exists(select 1 from notification_private.outbox o where o.user_id=organizer and o.kind='organizer.stock_alert' and o.data->>'product_id'=product::text
  and o.data->>'product_kind'=v_kind and o.data->>'band'=band::text and o.created_at>now()-interval '1 hour' and 'push'=any(o.channels)) then channels:='{}'; end if;
 perform notification_private.emit(organizer,'organizer','organizer.stock_alert','stock:'||v_kind||':'||product||':'||next_revision,heading,message,
 jsonb_build_object('event_id',ev,'destination','organizer','product_id',product,'product_kind',v_kind,'band',band,'stock_revision',next_revision),'operation',
 case when band=0 then 'high' else 'normal' end,channels,now()+interval '6 hours');
 return new;
end $$;
create trigger notification_v2_stock_admission after insert or update or delete on public.event_ticket_types for each row execute function notification_private.capture_stock();
create trigger notification_v2_stock_vip after insert or update or delete on public.reservados_vip for each row execute function notification_private.capture_stock();

create or replace function notification_private.is_current(o notification_private.outbox) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if not notification_private.role_active(o.user_id,o.role) then return false; end if;
 if o.kind in ('organizer.sales_digest','organizer.sales_instant','organizer.stock_alert') then
  if not notification_private.operations_active() or o.role<>'organizer' or not exists(select 1 from public.events e where e.id=notification_private.as_uuid(o.data->>'event_id')
   and e.creator_id=o.user_id and not coalesce(e.is_cancelled,false) and coalesce(e.status,'') not in ('cancelled','deleted')) then return false; end if;
  if o.kind='organizer.stock_alert' then
   return exists(select 1 from notification_private.stock_state s join public.events e on e.id=s.event_id
    where s.product_kind=o.data->>'product_kind' and s.product_id=notification_private.as_uuid(o.data->>'product_id') and s.active
     and s.revision=notification_private.nonnegative_integer(o.data->>'stock_revision') and s.band::text=o.data->>'band'
     and coalesce(e.end_datetime,e.event_date+interval '5 hours')>now());
  end if;
  return true;
 end if;
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

create or replace function notification_private.channel_allowed(o notification_private.outbox, ch text) returns boolean
language sql stable security definer set search_path='' as $$
 select case when ch='push' then coalesce(p.push_enabled,l.push_enabled,true) else coalesce(p.email_enabled,l.email_enabled,true) end
 and case o.category when 'purchase' then coalesce(p.purchase_updates,l.purchase_updates,true)
 when 'reminder' then coalesce(p.event_reminders,l.event_reminders,true)
 when 'change' then coalesce(p.event_changes,true) else coalesce(p.operations,true) end
 and case when o.kind like 'organizer.sales_%' then coalesce(p.sales_mode,'grouped')<>'off'
 when o.kind='organizer.stock_alert' then coalesce(p.stock_alerts,true) else true end
 and (ch<>'push' or l.muted_until is null or l.muted_until<=now())
 from (select 1) x left join public.notification_preferences_v2 p on p.user_id=o.user_id and p.role=o.role
 left join public.notification_settings l on l.user_id=o.user_id
$$;

create or replace function notification_private.suppress_legacy() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.delivery_version<>2 and notification_private.operations_active() and new.type in ('organizer_new_sale','organizer_realtime_sale','stock_low','stock_sold_out') then return null; end if;
 if new.delivery_version<>2 and (select capture_enabled from notification_private.config where singleton) and
 new.type in ('purchase_confirmed','purchase_completed','purchase_fulfilled','PURCHASE_SUCCESS','event_cancelled','event_date_changed','event_venue_changed','event_updated',
 'ticket_validated','organizer_verified','organizer_rejected','event_reminder_24h','event_reminder_1h') then return null; end if;
 return new;
end $$;

create or replace function public.prepare_notifications_v2(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o notification_private.outbox%rowtype; nid uuid; n integer:=0; reminders integer;
begin
 if not(select capture_enabled from notification_private.config where singleton) then return jsonb_build_object('prepared',0); end if;
 perform notification_private.prepare_sales(50);
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

-- Service-only heartbeat. Data is presence/status metadata, never secret values or recipients.
create function public.record_notification_worker_tick_v2(p_status text,p_processed integer default 0,p_receipts integer default 0,p_push_configured boolean default false,p_email_configured boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_status is null or p_status not in ('running','disabled','processed','failed') or p_processed is null or p_receipts is null or p_processed<0 or p_receipts<0 then raise exception 'Invalid worker tick'; end if;
 update notification_private.worker_health set last_status=p_status,
 last_started_at=case when p_status='running' then clock_timestamp() else last_started_at end,
 last_completed_at=case when p_status in ('disabled','processed') then clock_timestamp() else last_completed_at end,
 last_failed_at=case when p_status='failed' then clock_timestamp() else last_failed_at end,
 processed=least(p_processed,100000),receipts=least(p_receipts,100000),push_configured=p_push_configured,email_configured=p_email_configured where singleton;
end $$;

create or replace function public.notification_health_v2() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if notification_private.own_role(auth.uid(),'admin') is not true then raise exception 'Forbidden' using errcode='42501'; end if;
 return jsonb_build_object('checked_at',clock_timestamp(),
 'capture_enabled',(select capture_enabled from notification_private.config where singleton),
 'operations_enabled',(select operations_enabled from notification_private.config where singleton),
 'live_delivery_enabled',(select live_delivery_enabled from notification_private.config where singleton),
 'allow_all_recipients',(select allow_all_recipients from notification_private.config where singleton),
 'pilot_recipient_count',(select cardinality(allowed_recipients) from notification_private.config where singleton),
 'outbox_pending',(select count(*) from notification_private.outbox where processed_at is null),
 'sales_pending',(select count(*) from notification_private.sale_facts where processed_at is null),
 'active_installations',(select count(*) from notification_private.installations i join auth.sessions s on s.id=i.session_id and s.user_id=i.user_id where i.active and (s.not_after is null or s.not_after>now())),
 'worker',(select to_jsonb(w)-'singleton' from notification_private.worker_health w where singleton),
 'oldest_due_seconds',(select greatest(0,extract(epoch from now()-min(d.next_attempt_at)))::bigint from notification_private.deliveries d where d.status='pending' and d.next_attempt_at<=now()),
 'expired_leases',(select count(*) from notification_private.deliveries where status='processing' and lease_until<now()),
 'delayed_receipts',(select count(*) from notification_private.deliveries where channel='push' and status='accepted' and receipt_check_at<now()-interval '15 minutes'),
 'deliveries',coalesce((select jsonb_object_agg(status,n) from(select status,count(*) n from notification_private.deliveries group by status) s),'{}'::jsonb),
 'by_channel',coalesce((select jsonb_agg(s) from(select channel,status,count(*) total from notification_private.deliveries group by channel,status order by channel,status) s),'[]'::jsonb),
 'errors_24h',coalesce((select jsonb_agg(s) from(select last_code as code,count(*) total from notification_private.deliveries
   where status in ('failed','unknown') and updated_at>now()-interval '24 hours' group by last_code order by count(*) desc limit 8) s),'[]'::jsonb));
end $$;

revoke all on notification_private.sale_facts,notification_private.stock_state,notification_private.worker_health from public,anon,authenticated;
grant all on notification_private.sale_facts,notification_private.stock_state,notification_private.worker_health to service_role;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='notification_private'
 and p.proname in ('operations_active','nonnegative_integer','stock_band','record_sale','capture_sale_payment','capture_sale_ticket','sale_current','prepare_sales','capture_stock') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
revoke all on function public.record_notification_worker_tick_v2(text,integer,integer,boolean,boolean) from public,anon,authenticated;
grant execute on function public.record_notification_worker_tick_v2(text,integer,integer,boolean,boolean) to service_role;
-- notification_health_v2 retains its existing admin-checked authenticated grant.
