"""Multi-session checks against the disposable CI PostgreSQL fixture only."""
import concurrent.futures
import os
import subprocess
import time
if os.environ.get('PGHOST', 'localhost') not in ('localhost', '127.0.0.1'):
    raise SystemExit('This test only runs on the local CI fixture')
COMMAND = ['psql', '-X', '-q', '-t', '-A', '-h', 'localhost', '-U', 'postgres', '-d', 'notifications_test', '-v', 'ON_ERROR_STOP=1']
def sql(text: str) -> str:
    return subprocess.check_output(COMMAND, input=text, text=True, timeout=20).strip()
sql("""
insert into auth.users(id,email,email_confirmed_at) values('c0000000-0000-4000-8000-000000000001','concurrency@example.invalid',now());
insert into public.profiles(id,role) values('c0000000-0000-4000-8000-000000000001','attendee');
update notification_private.config set capture_enabled=true,live_delivery_enabled=true,allowed_recipients=array['c0000000-0000-4000-8000-000000000001'::uuid];
select notification_private.emit('c0000000-0000-4000-8000-000000000001','attendee','operation.fixture','parallel:'||n,'CI fixture','No provider sends','{}','operation','normal',array['email']) from generate_series(1,80) n;
select public.prepare_notifications_v2(100);
create table public.notification_claim_test(id uuid primary key,worker integer);
""")
def claim(worker: int) -> str:
    return sql(f"""begin;
      insert into public.notification_claim_test select id,{worker} from public.claim_notification_deliveries_v2(10,array['email']);
      select pg_sleep(1); commit;""")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    a = pool.submit(claim, 1)
    time.sleep(0.15)
    b = pool.submit(claim, 2)
    a.result(); b.result()
assert sql('select count(*)=20 and count(distinct id)=20 from public.notification_claim_test') == 't'
assert sql('select count(distinct worker)=2 from public.notification_claim_test') == 't'
assert sql("select count(*)=20 from notification_private.deliveries where status='processing' and attempts=1") == 't'
print('PASS: two simultaneous claimers own 20 different leases, exactly one attempt each')
def duplicate() -> str:
    return sql("""begin;
      select notification_private.emit('c0000000-0000-4000-8000-000000000001','attendee','operation.fixture','same-source','CI fixture','No provider sends','{}','operation');
      select pg_sleep(0.3); commit;""")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    list(pool.map(lambda _: duplicate(), range(2)))
assert sql("select count(*)=1 from notification_private.outbox where event_key='same-source'") == 't'
print('PASS: simultaneous capture of the same business identity persists once')
uid = 'c0000000-0000-4000-8000-000000000001'
sql('create table public.notification_page_test(page integer,item jsonb);')
sql(f"""begin; select set_config('request.jwt.claims','{{"sub":"{uid}"}}',true);
 insert into public.notification_page_test select 1,value from jsonb_array_elements(public.notification_inbox_v2()->'items');
 commit;""")
assert sql('select count(*)=50 from public.notification_page_test where page=1') == 't'
sql(f"""begin; select set_config('request.jwt.claims','{{"sub":"{uid}"}}',true);
 insert into public.notification_page_test select 2,value from jsonb_array_elements(public.notification_inbox_v2(p_before=>(select (item->>'created_at')::timestamptz from public.notification_page_test order by item->>'created_at',item->>'id' limit 1), p_before_id=>(select (item->>'id')::uuid from public.notification_page_test order by item->>'created_at',item->>'id' limit 1))->'items');
 do $$ begin if (public.notification_inbox_v2()->>'unread_count')::integer<>80 then raise exception 'Count was truncated to a page'; end if; end $$;
 commit;""")
assert sql("select count(*)=80 and count(distinct item->>'id')=80 from public.notification_page_test") == 't'
print('PASS: two keyset pages preserve 80 distinct notices and authoritative unread count')
