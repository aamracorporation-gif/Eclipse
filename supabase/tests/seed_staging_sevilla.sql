-- Run only against Eclipse Staging after a test organizer has completed onboarding.
-- In the same session, set app.qa.project_ref and app.qa.organizer_id explicitly.
-- No accounts are created or promoted; no real customer data or assets are copied.
begin;
do $seed$
declare
  organizer uuid := nullif(current_setting('app.qa.organizer_id', true), '')::uuid;
  venue uuid;
  event_id_new uuid;
  demo record;
begin
  if current_setting('app.qa.project_ref', true) is distinct from 'uhondxttdpvywvkyqlkk' then
    raise exception 'Explicit staging project confirmation required';
  end if;
  if organizer is null or not exists (
    select 1 from public.profiles where id=organizer and role='organizer'
      and stripe_account_id is not null and stripe_onboarding_completed is true
  ) then
    raise exception 'A test organizer with completed sandbox onboarding is required';
  end if;
  for demo in select * from (values
    ('Eclipse QA — Sevilla Centro', 'Sevilla Centro — ubicación ficticia para pruebas', 37.3891, -5.9845, 'Eclipse QA — Noche de prueba', 'party', 12, 7),
    ('Eclipse QA — Triana', 'Triana — ubicación ficticia para pruebas', 37.3830, -6.0030, 'Eclipse QA — Concierto de prueba', 'concert', 18, 14)
  ) as d(venue_name,address,lat,lng,title,event_type,price,days) loop
    select id into venue from public.venues where name=demo.venue_name order by created_at limit 1;
    if venue is null then
      insert into public.venues(name,address,latitude,longitude,description)
      values(demo.venue_name,demo.address,demo.lat,demo.lng,'Datos sintéticos de Eclipse Staging. No es un local real.')
      returning id into venue;
    end if;
    if not exists(select 1 from public.events where title=demo.title and creator_id=organizer and event_date>now()) then
      insert into public.events(venue_id,creator_id,title,description,event_date,end_datetime,ticket_price,
        available_tickets,capacity,age_restriction,event_type,status,allow_resale)
      values(venue,organizer,demo.title,'Evento de prueba: solo pagos simulados. No es una convocatoria real.',
        now()+make_interval(days=>demo.days),now()+make_interval(days=>demo.days)+interval '5 hours',
        demo.price,100,100,18,demo.event_type,'scheduled',false)
      returning id into event_id_new;
      insert into public.event_ticket_types(event_id,name,price,quantity,is_active)
      values(event_id_new,'General — PRUEBA',demo.price,100,true);
    end if;
  end loop;
end;
$seed$;
commit;
