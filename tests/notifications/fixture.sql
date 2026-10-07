-- Disposable PostgreSQL 17 fixture. Never run this file on a Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$; -- replaced with an explicit cast below
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
grant usage on schema auth to authenticated,anon,service_role;
create table auth.users(id uuid primary key default gen_random_uuid(),email text,email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),not_after timestamptz);
create table public.profiles(id uuid primary key references auth.users(id),role text default 'attendee',is_suspended boolean default false,verification_status text);
create table public.events(id uuid primary key default gen_random_uuid(),title text default 'Fixture event',creator_id uuid,event_date timestamptz,end_datetime timestamptz,venue_id uuid,is_cancelled boolean default false,status text default 'scheduled',access_policy text,access_requirements text,lineup text,dress_code text,age_restriction integer);
create table public.payment_transactions(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),kind text default 'event_ticket',status text default 'created',metadata jsonb default '{}');
create table public.tickets(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),event_id uuid references public.events(id),payment_transaction_id uuid references public.payment_transactions(id),stripe_payment_intent_id text,free_claim_id uuid,total_price numeric default 10,quantity integer default 1,sold_by_worker_id uuid,payment_status text default 'paid',status text default 'valid',ticket_status text default 'active',validation_status text default 'valid',scanned_at timestamptz,entry_deadline timestamptz,purchase_date timestamptz default now());
create table public.workers(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),status text default 'active');
create table public.worker_event_assignments(id uuid primary key default gen_random_uuid(),worker_id uuid references public.workers(id),event_id uuid references public.events(id),status text default 'active');
create table public.notification_settings(user_id uuid primary key references auth.users(id),push_enabled boolean default true,email_enabled boolean default true,purchase_updates boolean default true,event_reminders boolean default true,muted_until timestamptz);
create table public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),role text default 'attendee' check(role in ('attendee','organizer','staff','admin')),type text,title text,body text,message text,data jsonb default '{}',priority text check(priority in ('low','normal','high')),status text default 'pending' check(status in ('pending','sent','failed','blocked','read')),channels text[] default '{push}',read boolean default false,read_at timestamptz,created_at timestamptz default now());
alter table public.notifications enable row level security;
create policy own_notifications on public.notifications for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
grant select,update,delete on public.notifications to authenticated;
create table public.user_push_tokens(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),token text,is_active boolean default true);
create table public.notification_deliveries(id uuid primary key default gen_random_uuid(),notification_id uuid references public.notifications(id),channel text,status text default 'pending',unique(notification_id,channel));
-- Legacy queue deliberately retained, to catch accidental v2 replay/double fanout.
create function public.fixture_legacy_fanout() returns trigger language plpgsql security definer as $$begin
 insert into public.notification_deliveries(notification_id,channel) select new.id,c from unnest(new.channels) c where c in ('push','email'); return new; end$$;
create trigger legacy_delivery after insert on public.notifications for each row execute function public.fixture_legacy_fanout();
grant usage on schema public to authenticated,anon,service_role;
grant all on all tables in schema public to service_role;
