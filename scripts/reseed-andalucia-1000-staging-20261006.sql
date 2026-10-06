begin;
select pg_advisory_xact_lock(hashtext('eclipse_staging_reseed_20261006'));
do $guard$
begin
  if (select count(*) from public.events) <> 702 then raise exception 'Unexpected event count; stop to inspect'; end if;
  if exists(select 1 from public.events where description not like 'BATCH:ECLIPSE_QA_ANDALUCIA_700_20261002%' and id not in ('5792d6f0-bd9b-4a8c-ba82-01997065e6ff','a9270000-0000-4000-8000-000000000003')) then raise exception 'Non-fixture event found'; end if;
  if (select count(*) from public.tickets) <> 16 then raise exception 'Ticket state changed since backup'; end if;
  if not exists(select 1 from public.profiles where id='6f076642-d53c-47e5-b881-b1a4ca245ce0' and role='organizer' and stripe_account_id='acct_1UMsy1H1THGSkSCf' and stripe_charges_enabled and stripe_onboarding_completed) then raise exception 'Organizer cannot collect payments'; end if;
end $guard$;
-- User-authorized staging reset; full private snapshot retained before this transaction.
-- Remove fixture tickets first so deleting events does not enqueue cancellation notifications.
delete from public.tickets where event_id in (select id from public.events);
delete from public.events;
with ranked_venues as (
 select id, split_part(split_part(description,'Provincia: ',2),' |',1) as province,
 split_part(address,',',1) as city,
 row_number() over(partition by split_part(split_part(description,'Provincia: ',2),' |',1) order by address,name,id) as rn,
 count(*) over(partition by split_part(split_part(description,'Provincia: ',2),' |',1)) as total
 from public.venues where description like 'BATCH:ECLIPSE_QA_ANDALUCIA_700_20261002%'
), fixtures as (
 select v.*, n,
 (array['Órbita Techno','Neón House','Noche Urbana','Disco Cósmico','Ritmo Latino','Electro Eclipse','Indie Afterdark','Bass Ritual'])[((n-1)%8)+1] as concept,
 (array['Techno','House','Reggaeton','Disco','Latino','Electronic','Indie','Drum & Bass'])[((n-1)%8)+1] as music,
 12 + ((n-1)%13)*2 as price,
 (timestamp '2026-10-09 20:00:00' + (((n-1)/10)*7 + ((n-1)%2))*interval '1 day' + ((n-1)%4)*interval '1 hour') at time zone 'Europe/Madrid' as starts_at
 from ranked_venues v cross join generate_series(1,125) n
 where v.rn=((n-1)%v.total)+1
), inserted as (
 insert into public.events
 (venue_id,title,description,event_date,end_datetime,ticket_price,available_tickets,sold_tickets,capacity,creator_id,dress_code,age_restriction,theme,event_type,status,allow_resale,access_policy,access_requirements,lineup)
 select id, '[PRUEBA] '||concept||' · '||city||' · '||province||' #'||lpad(n::text,3,'0'),
 'BATCH:ECLIPSE_QA_ANDALUCIA_1000_20261006 | Provincia: '||province||' | Municipio: '||city||'. Fiesta ficticia para probar Eclipse. No es una convocatoria real; no acudir a esta ubicación. Entradas habilitadas para compras en el entorno de pruebas.',
 starts_at,starts_at+interval '6 hours',price,300,0,324,'6f076642-d53c-47e5-b881-b1a4ca245ce0',
 (array['Casual','Elegante','Creativo'])[((n-1)%3)+1],18,music,'party','scheduled',false,
 'Evento sintético de staging. Acceso no real.','Solo para pruebas de la aplicación.','Eclipse QA — sesión ficticia'
 from fixtures returning id,ticket_price
), types as (
 insert into public.event_ticket_types(event_id,name,price,quantity,sold,is_active,category,metadata)
 select e.id,t.name,e.ticket_price+t.extra,t.stock,0,true,t.category,
 jsonb_build_object('qa_batch','ECLIPSE_QA_ANDALUCIA_1000_20261006','synthetic',true)
 from inserted e cross join (values
 ('General — PRUEBA','general',0,200),
 ('VIP — PRUEBA','vip',35,50),
 ('Backstage — PRUEBA','backstage',60,25),
 ('Fast Lane — PRUEBA','fast_lane',12,25)
 ) t(name,category,extra,stock) returning id
)
insert into public.reservados_vip(event_id,name,description,base_price,capacity_people,included_bottles,extra_bottle_price,quantity_available,is_active)
select id,'Mesa VIP — PRUEBA','Reservado ficticio para probar la compra en Eclipse.',ticket_price*6+90,6,1,60,4,true from inserted;
do $verify$
begin
 if (select count(*) from public.events)<>1000 or (select count(*) from public.event_ticket_types)<>4000 or (select count(*) from public.reservados_vip)<>1000 then raise exception 'Seed count mismatch'; end if;
 if exists(select 1 from public.events where creator_id is distinct from '6f076642-d53c-47e5-b881-b1a4ca245ce0'::uuid or event_date<=now() or ticket_price<=0 or available_tickets<>300) then raise exception 'Invalid purchasable event'; end if;
 if (select count(*) from public.payment_transactions)<>4 then raise exception 'Payment history changed'; end if;
 if (select count(*) from public.notifications)<>7 then raise exception 'Unexpected notification'; end if;
end $verify$;
commit;
select split_part(split_part(description,'Provincia: ',2),' |',1) as province,count(*) as events,min(event_date) as first_event,max(event_date) as last_event from public.events group by 1 order by 1;
