\set ON_ERROR_STOP on
begin;
create temp table results(label text);
create function pg_temp.assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'NOTIFICATION TEST FAILED: %',label; end if;
 insert into results values(label);
end$$;
-- All recipients synthetic; no provider can be invoked by these SQL tests.
insert into auth.users(id,email,email_confirmed_at) values
 ('10000000-0000-4000-8000-000000000001','buyer@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000002','other@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000003','organizer@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000004','worker@example.invalid',now()),
 ('10000000-0000-4000-8000-000000000005','admin@example.invalid',now());
insert into public.profiles(id,role) select id,case right(id::text,1) when '3' then 'organizer' when '5' then 'admin' else 'attendee' end from auth.users;
insert into auth.sessions(id,user_id) values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
insert into public.events(id,event_date,end_datetime) values('30000000-0000-4000-8000-000000000001',now()+interval '3 days',now()+interval '3 days 5 hours');
select pg_temp.assert((select not capture_enabled and not live_delivery_enabled and cardinality(allowed_recipients)=0 from notification_private.config),'rollout gates start closed');
select notification_private.emit('10000000-0000-4000-8000-000000000001','attendee','order.free_confirmed','off','Off','Off','{}','purchase');
select pg_temp.assert((select count(*)=0 from notification_private.outbox),'disabled capture emits nothing');
insert into public.notifications(user_id,type,title,body) values('10000000-0000-4000-8000-000000000001','purchase_confirmed','old','old');
select pg_temp.assert((select count(*)=1 from public.notification_deliveries),'historical delivery retained');
update notification_private.config set capture_enabled=true,cutover_at=now()-interval '1 day';
insert into public.notifications(user_id,type,title,body) values('10000000-0000-4000-8000-000000000001','purchase_confirmed','suppressed','suppressed');
select pg_temp.assert((select count(*)=1 from public.notifications),'legacy replacement suppressed only after cutover');
insert into public.payment_transactions(id,user_id,metadata) values
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','{"event_id":"30000000-0000-4000-8000-000000000001"}'),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','{"event_id":"30000000-0000-4000-8000-000000000001"}');
insert into public.tickets(user_id,event_id,payment_transaction_id) select user_id,'30000000-0000-4000-8000-000000000001',id from public.payment_transactions;
select pg_temp.assert((select count(*)=0 from notification_private.outbox),'card ticket insertion cannot duplicate purchase confirmation');
update public.payment_transactions set status='fulfilled';
select pg_temp.assert((select count(*)=2 from notification_private.outbox),'two purchases in one day produce two notifications');
update public.payment_transactions set status='fulfilled';
select public.prepare_notifications_v2();
select public.prepare_notifications_v2();
select pg_temp.assert((select count(*)=2 from public.notifications where delivery_version=2),'replaying fulfillment/preparation does not duplicate');
select pg_temp.assert((select count(*)=1 from public.notification_deliveries),'new inbox cannot enter legacy queue');
select pg_temp.assert((select count(*)=2 from notification_private.deliveries where channel='email'),'one email per actual purchase');
select pg_temp.assert((select count(*)=0 from public.claim_notification_deliveries_v2()),'delivery remains closed with capture active');
-- Free invitation / box office / VIP wording, no invented guest recipients.
insert into public.tickets(user_id,event_id,total_price,free_claim_id) values('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',0,'50000000-0000-4000-8000-000000000001');
insert into public.tickets(user_id,event_id,sold_by_worker_id) values('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002');
update public.payment_transactions set kind='vip_table',status='created' where id='40000000-0000-4000-8000-000000000002';
-- New independent VIP checkout rather than modifying a historical order.
insert into public.payment_transactions(id,user_id,kind,metadata) values('40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','vip_table','{"event_id":"30000000-0000-4000-8000-000000000001","quantity":6}');
insert into public.tickets(user_id,event_id,payment_transaction_id,quantity) values('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003',6);
update public.payment_transactions set status='fulfilled' where id='40000000-0000-4000-8000-000000000003';
select pg_temp.assert((select count(*)=1 from notification_private.outbox where kind='order.vip_confirmed' and title like '%mesa VIP%'),'one VIP confirmation for the buyer');
select pg_temp.assert((select count(*)=1 from notification_private.outbox where kind='order.free_confirmed'),'free claim confirmation');
select pg_temp.assert((select channels=array['email'] from notification_private.outbox where kind='order.box_office_issued'),'box office no unnecessary push');
update public.payment_transactions set status='refund_pending' where id='40000000-0000-4000-8000-000000000001';
update public.payment_transactions set status='refunded' where id='40000000-0000-4000-8000-000000000001';
select pg_temp.assert((select count(*)=2 from notification_private.outbox where kind in ('refund.processing','refund.completed')),'refund started/completed are distinct');
update public.tickets set scanned_at=now(),status='used' where payment_transaction_id='40000000-0000-4000-8000-000000000001';
select pg_temp.assert((select channels='{}'::text[] from notification_private.outbox where kind='ticket.checked_in'),'scan success is in-app only');
-- Multi-field event edit must create one buyer message, not one per purchased ticket.
update public.events set event_date=event_date+interval '1 hour',venue_id='60000000-0000-4000-8000-000000000001';
select pg_temp.assert((select count(*)=1 from notification_private.outbox where kind like 'event.%'),'grouped event edit and distinct purchaser audience');
select pg_temp.assert((select jsonb_array_length(data->'changed_fields')=2 from notification_private.outbox where kind like 'event.%'),'changed fields retained');
insert into public.workers(id,user_id) values('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004');
insert into public.worker_event_assignments(worker_id,event_id) values('70000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
select pg_temp.assert((select count(*)=1 from notification_private.outbox where role='staff' and kind='worker.assignment_added'),'staff gets only own assignment');
update public.worker_event_assignments set status='inactive';
select pg_temp.assert((select count(*)=1 from notification_private.outbox where kind='worker.assignment_removed'),'assignment removed safely');
update public.profiles set verification_status='verified' where role='organizer';
select pg_temp.assert((select count(*)=1 from notification_private.outbox where role='organizer' and kind='organizer.verification_approved'),'organizer role not attendee for verification');
-- Independent contexts; installer uses authenticated identity and a live session.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","session_id":"20000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select public.notification_preferences_v2_get('attendee');
update public.notification_preferences_v2 set quiet_enabled=false;
select public.register_notification_installation_v2('80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','ExponentPushToken[fixturetokenfixturetoken]','android','90000000-0000-4000-8000-000000000001');
reset role;
select pg_temp.assert((select count(*)=1 from notification_private.installations),'authenticated device registered');
select pg_temp.assert(not has_table_privilege('authenticated','notification_private.installations','SELECT'),'device tokens inaccessible to clients');
select pg_temp.assert(not has_function_privilege('authenticated','public.prepare_notifications_v2(integer)','EXECUTE'),'client cannot run dispatcher');
select pg_temp.assert(not has_function_privilege('anon','public.register_notification_installation_v2(uuid,uuid,text,text,uuid)','EXECUTE'),'anonymous registration denied');
-- Lock/deliver only permitted recipients; outbox notification constructed with no sensitive payload.
select notification_private.emit('10000000-0000-4000-8000-000000000001','attendee','order.free_confirmed','dispatch-fixture','Title','Body','{}','purchase');
select public.prepare_notifications_v2();
update notification_private.config set live_delivery_enabled=true;
select pg_temp.assert((select count(*)=0 from public.claim_notification_deliveries_v2()),'empty pilot allowlist prevents dispatch');
update notification_private.config set allowed_recipients=array['10000000-0000-4000-8000-000000000001'::uuid];
create temp table claimed as select * from public.claim_notification_deliveries_v2(20,array['push']);
select pg_temp.assert((select count(*)>=1 from claimed),'push job claimed');
select pg_temp.assert((select count(*)=0 from public.claim_notification_deliveries_v2(20,array['push'])),'lease excludes other workers');
select pg_temp.assert((select public.authorize_notification_delivery_v2(id,'99999999-0000-4000-8000-000000000001') is null from claimed limit 1),'wrong lease cannot obtain recipient');
select pg_temp.assert((select public.authorize_notification_delivery_v2(id,lease_token)->>'to'='ExponentPushToken[fixturetokenfixturetoken]' from claimed limit 1),'valid lease checks recipient again');
select pg_temp.assert((select public.complete_notification_delivery_v2(id,lease_token,'accepted','EXPO_ACCEPTED','fixture-receipt') from claimed limit 1),'provider ticket persisted');
select pg_temp.assert((select not public.complete_notification_delivery_v2(id,lease_token,'accepted','EXPO_ACCEPTED','fixture-receipt') from claimed limit 1),'completion is idempotent');
select pg_temp.assert((select count(*)=0 from public.notification_receipts_v2()),'receipts not requested immediately');
update notification_private.deliveries set receipt_check_at=now()-interval '1 second' where provider_id='fixture-receipt';
select pg_temp.assert((select count(*)=1 from public.notification_receipts_v2()),'receipt is available after scheduled delay');
select public.complete_notification_receipt_v2((select id from claimed limit 1),'fixture-receipt','unregistered','DeviceNotRegistered');
select pg_temp.assert((select not active from notification_private.installations limit 1),'invalid device token deactivated on receipt');
-- A different session/account reusing the device cannot get old queued messages.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","session_id":"20000000-0000-4000-8000-000000000002"}',true);
set local role authenticated;
select public.register_notification_installation_v2('80000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','ExponentPushToken[fixturetokenfixturetoken]','android','90000000-0000-4000-8000-000000000001');
select public.notification_inbox_v2();
reset role;
select pg_temp.assert((public.notification_inbox_v2()->'items')='[]'::jsonb,'account switch has empty inbox');
-- Expected user must match current auth identity; no arbitrary target accepted.
do $$begin
 begin perform public.register_notification_installation_v2(null,'10000000-0000-4000-8000-000000000001','ExponentPushToken[fixturetokenfixturetoken]','android','90000000-0000-4000-8000-000000000001');raise exception 'accepted stale user';
 exception when insufficient_privilege then null; end;
 perform pg_temp.assert(true,'stale registration cannot bind another user');
end$$;
-- Unread count, safe navigation, mark read does not set delivery state.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","session_id":"20000000-0000-4000-8000-000000000001"}',true);
create temp table before_states as select id,status from notification_private.deliveries;
select public.notification_inbox_action_v2('read');
select pg_temp.assert((public.notification_inbox_v2()->>'unread_count')::integer=0,'mark-all exact unread count');
select pg_temp.assert(not exists(select 1 from before_states b join notification_private.deliveries d using(id) where d.status<>b.status),'reading does not alter transport status');
select public.notification_inbox_action_v2('archive',array[(select id from public.notifications where delivery_version=2 limit 1)]);
select pg_temp.assert(jsonb_array_length(public.notification_inbox_v2(null,true)->'items')=1,'archive retained not deleted');
select pg_temp.assert(public.notification_destination_v2((select id from public.notifications where type='order.free_confirmed' limit 1))='/(tabs)/tickets','destination is server-authorized');
set local role authenticated;
do $$begin
 begin update public.notifications set title='tampered' where delivery_version=2;raise exception 'payload editable';exception when insufficient_privilege then null;end;
 begin perform public.notification_preferences_v2_get('admin');raise exception 'admin role granted';exception when insufficient_privilege then null;end;
 begin update public.notification_preferences_v2 set marketing_opt_in=true;raise exception 'marketing enabled';exception when check_violation then null;end;
end$$;
reset role;
select pg_temp.assert(true,'payload immutable; fake admin role and marketing blocked');
-- Reminder windows: eligible, not retrospective, deduplicated, invalidated on date change.
insert into public.events(id,event_date,end_datetime) values('30000000-0000-4000-8000-000000000002',now()+interval '23 hours 58 minutes',now()+interval '29 hours');
insert into public.tickets(user_id,event_id,purchase_date) values('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002',now()-interval '2 days');
select notification_private.schedule_reminders();
select notification_private.schedule_reminders();
select pg_temp.assert((select count(*)=1 from notification_private.outbox where kind='reminder.event_24h'),'24h reminder emitted once in due window');
update public.events set event_date=event_date+interval '1 day' where id='30000000-0000-4000-8000-000000000002';
select pg_temp.assert((select not notification_private.is_current(o) from notification_private.outbox o where kind='reminder.event_24h'),'reprogrammed event suppresses old reminder');
select public.prepare_notifications_v2();
select pg_temp.assert((select count(*)=0 from public.notifications where type='reminder.event_24h'),'stale reminder not inserted into inbox');
select pg_temp.assert(not exists(select 1 from notification_private.outbox where kind like 'marketing.%' or kind like 'resale.%'),'no marketing or resale emitters');
select count(*) as passed_notification_sql_assertions from results;
rollback;
