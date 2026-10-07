-- Disposable CI fixture only; this script is not a staging seed or migration.
\set ON_ERROR_STOP on
begin;
create temp table hardening_results(label text);
create function pg_temp.check_hardening(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'HARDENING TEST FAILED: %',label; end if;
 insert into hardening_results values(label);
end$$;
insert into auth.users(id,email,email_confirmed_at) values
 ('a0000000-0000-4000-8000-000000000001','hardening@example.invalid',now());
insert into public.profiles(id) values('a0000000-0000-4000-8000-000000000001');
update notification_private.config set capture_enabled=true,cutover_at=now()-interval '1 day';
-- Doors have opened, but a purchased admission cutoff is still in the future.
insert into public.events(id,event_date,end_datetime) values
 ('a1000000-0000-4000-8000-000000000001',now()-interval '1 hour',now()+interval '3 hours');
insert into public.tickets(id,user_id,event_id,entry_deadline,purchase_date) values
 ('a2000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',now()+interval '58 minutes',now()-interval '1 day');
select pg_temp.check_hardening(notification_private.schedule_reminders()=1,'after-start admission reminder is scheduled');
select pg_temp.check_hardening((select expires_at>now() from notification_private.outbox where kind='reminder.entry_deadline'),'admission reminder has not expired at event start');
select public.prepare_notifications_v2();
select pg_temp.check_hardening((select count(*)=1 from public.notifications where type='reminder.entry_deadline'),'after-start admission reminder reaches inbox');
set local timezone='Pacific/Auckland';
select pg_temp.check_hardening(notification_private.schedule_reminders()=0,'scheduler timezone cannot duplicate a reminder');
set local timezone='UTC';
-- Long-running events are bounded by their actual end, not an arbitrary five-hour lookback.
insert into public.events(id,event_date,end_datetime) values
 ('a1000000-0000-4000-8000-000000000002',now()-interval '7 hours',now()+interval '2 hours');
insert into public.tickets(user_id,event_id,entry_deadline,purchase_date) values
 ('a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000002',now()+interval '58 minutes',now()-interval '1 day');
select pg_temp.check_hardening(notification_private.schedule_reminders()=1,'long event admission reminder remains eligible');
-- Altering another ticket's cutoff must not repeat the event's 24-hour reminder.
insert into public.events(id,event_date,end_datetime) values
 ('a1000000-0000-4000-8000-000000000003',now()+interval '23 hours 58 minutes',now()+interval '29 hours');
insert into public.tickets(id,user_id,event_id,entry_deadline,purchase_date) values
 ('a2000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000003',now()+interval '27 hours',now()-interval '1 day');
select pg_temp.check_hardening(notification_private.schedule_reminders()=1,'24-hour reminder is generated once');
update public.tickets set entry_deadline=now()+interval '28 hours' where id='a2000000-0000-4000-8000-000000000003';
select pg_temp.check_hardening(notification_private.schedule_reminders()=0,'24-hour identity does not depend on admission cutoff');
-- A two-hour reminder near the admission reminder is suppressed, not doubled.
insert into public.events(id,event_date,end_datetime) values
 ('a1000000-0000-4000-8000-000000000004',now()+interval '1 hour 58 minutes',now()+interval '8 hours');
insert into public.tickets(user_id,event_id,entry_deadline,purchase_date) values
 ('a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000004',now()+interval '58 minutes',now()-interval '1 day');
select pg_temp.check_hardening(notification_private.schedule_reminders()=1,'colliding reminder pair produces only one notice');
select pg_temp.check_hardening((select count(*)=0 from notification_private.outbox where kind='reminder.event_2h' and data->>'event_id'='a1000000-0000-4000-8000-000000000004'),'deadline reminder replaces overlapping two-hour reminder');
-- Align with real ticket status constraints: invalidated / revoked are separate fields.
insert into public.events(id,event_date,end_datetime) values
 ('a1000000-0000-4000-8000-000000000005',now()+interval '2 days',now()+interval '2 days 5 hours');
insert into public.payment_transactions(id,user_id,metadata) values
 ('a3000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','{"event_id":"a1000000-0000-4000-8000-000000000005"}');
insert into public.tickets(id,user_id,event_id,payment_transaction_id) values
 ('a2000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000005','a3000000-0000-4000-8000-000000000001');
update public.payment_transactions set status='fulfilled' where id='a3000000-0000-4000-8000-000000000001';
select pg_temp.check_hardening((select notification_private.is_current(o) from notification_private.outbox o where kind='order.admission_confirmed'),'valid paid admission is eligible');
update public.tickets set ticket_status='invalidated' where id='a2000000-0000-4000-8000-000000000005';
select pg_temp.check_hardening((select count(*)=1 from notification_private.outbox where kind='ticket.invalidated'),'ticket_status invalidated triggers exactly one notice');
select pg_temp.check_hardening((select not notification_private.is_current(o) from notification_private.outbox o where kind='order.admission_confirmed'),'invalidated ticket cannot receive stale purchase confirmation');
select pg_temp.check_hardening((select notification_private.is_current(o) from notification_private.outbox o where kind='ticket.invalidated'),'current invalidation remains eligible');
update public.events set lineup='Updated' where id='a1000000-0000-4000-8000-000000000005';
select pg_temp.check_hardening((select count(*)=0 from notification_private.outbox where kind='event.lineup_changed'),'invalidated admission excluded from changed-event audience');
update public.tickets set ticket_status='active' where id='a2000000-0000-4000-8000-000000000005';
select pg_temp.check_hardening((select not notification_private.is_current(o) from notification_private.outbox o where kind='ticket.invalidated'),'restored ticket suppresses an unsent invalidation');
update public.tickets set validation_status='revoked' where id='a2000000-0000-4000-8000-000000000005';
select pg_temp.check_hardening((select not notification_private.is_current(o) from notification_private.outbox o where kind='order.admission_confirmed'),'revoked validation suppresses stale purchase confirmation');
insert into public.tickets(id,user_id,event_id) values
 ('a2000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000005');
update public.tickets set validation_status='revoked' where id='a2000000-0000-4000-8000-000000000006';
select pg_temp.check_hardening((select count(*)=1 from notification_private.outbox where kind='ticket.invalidated' and data->>'ticket_id'='a2000000-0000-4000-8000-000000000006'),'validation-only revocation emits invalidation');
update public.tickets set status='used',ticket_status='used',validation_status='used',scanned_at=now() where id='a2000000-0000-4000-8000-000000000005';
select pg_temp.check_hardening((select notification_private.is_current(o) from notification_private.outbox o where kind='order.admission_confirmed'),'used purchased ticket still permits its receipt');
select pg_temp.check_hardening((select not live_delivery_enabled and not allow_all_recipients and cardinality(allowed_recipients)=0 from notification_private.config),'no test enables external recipients or delivery');
select count(*) as passed_hardening_assertions from hardening_results;
rollback;
