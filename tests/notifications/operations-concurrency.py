"""Operational aggregation concurrency: disposable localhost PostgreSQL fixture ONLY."""
import concurrent.futures
import os
import subprocess
import time
import uuid
if os.environ.get('PGHOST', 'localhost') not in ('localhost', '127.0.0.1'):
    raise SystemExit('Only the disposable local fixture is allowed')
COMMAND = ['psql', '-X', '-q', '-t', '-A', '-h', 'localhost', '-U', 'postgres', '-d', 'notifications_test', '-v', 'ON_ERROR_STOP=1']
def sql(text):
    return subprocess.check_output(COMMAND, input=text, text=True, timeout=20).strip()
org, buyer, ev = [str(uuid.uuid4()) for _ in range(3)]
sql(f"""
update notification_private.config set capture_enabled=true,operations_enabled=true,live_delivery_enabled=false,cutover_at=now()+interval '10 days';
insert into auth.users(id,email,email_confirmed_at) values('{org}','org-parallel@example.invalid',now()),('{buyer}','buyer-parallel@example.invalid',now());
insert into public.profiles(id,role) values('{org}','organizer'),('{buyer}','attendee');
insert into public.events(id,creator_id,event_date) values('{ev}','{org}',now()+interval '3 days');
insert into public.payment_transactions(user_id,metadata) select '{buyer}',jsonb_build_object('event_id','{ev}','quantity',2,'discounted_total_cents',1000) from generate_series(1,20);
update public.payment_transactions set status='fulfilled' where user_id='{buyer}';
update notification_private.sale_facts set due_at='2000-01-01T00:00:00Z' where organizer_id='{org}';
""")
# The date above intentionally creates an expired bucket; reset to one recent fixed bucket.
bucket=sql("select (now()-interval '1 minute')::text")
sql(f"update notification_private.sale_facts set due_at='{bucket}' where organizer_id='{org}'")
def prepare(_):
    return sql('begin; select notification_private.prepare_sales(); select pg_sleep(0.4); commit;')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    list(pool.map(prepare, range(2)))
assert sql(f"select count(*)=1 and sum((data->>'orders')::int)=20 and sum((data->>'ticket_units')::int)=40 from notification_private.outbox where user_id='{org}' and kind='organizer.sales_digest'")=='t'
assert sql(f"select count(*)=20 and bool_and(processed_at is not null) from notification_private.sale_facts where organizer_id='{org}'")=='t'
print('PASS: parallel aggregation emits one digest and counts twenty orders once')
late=str(uuid.uuid4())
sql(f"""insert into public.payment_transactions(id,user_id,metadata) values('{late}','{buyer}',jsonb_build_object('event_id','{ev}','quantity',1));
update public.payment_transactions set status='fulfilled' where id='{late}';
update notification_private.sale_facts set due_at='{bucket}' where source_id='{late}';
select notification_private.prepare_sales();""")
assert sql(f"select count(*)=2 and sum((data->>'orders')::int)=21 from notification_private.outbox where user_id='{org}' and kind='organizer.sales_digest'")=='t'
print('PASS: late committed order remains visible without recounting the earlier digest')
shared=str(uuid.uuid4())
def duplicate(_):
    return sql(f"""begin; select notification_private.record_sale('payment','{shared}','same-order','{org}','{ev}','admission',1,1000::bigint); select pg_sleep(0.3); commit;""")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    list(pool.map(duplicate,range(2)))
assert sql(f"select count(*)=1 from notification_private.sale_facts where source_id='{shared}'")=='t'
print('PASS: concurrent recording of the same source produces one fact')
assert sql('select not live_delivery_enabled from notification_private.config')=='t'
