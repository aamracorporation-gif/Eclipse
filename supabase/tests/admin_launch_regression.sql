begin;
do $test$
declare u uuid:='a9270000-0000-4000-8000-000000000001'; e uuid:=gen_random_uuid(); tt uuid:=gen_random_uuid();
 r jsonb; tid uuid; failed boolean; n int;
begin
 update auth.users set email_confirmed_at=now() where id=u;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 failed:=false;
 begin perform public.admin_launch_overview(); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'attendee accessed admin overview'; end if;
 failed:=false;
 begin perform public.admin_invalidate_ticket(gen_random_uuid(),'test reason'); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'attendee invalidated ticket'; end if;
 insert into public.events(id,title,event_date,end_datetime,ticket_price,available_tickets,capacity,creator_id,allow_resale)
 values(e,'QA admin rollback',now()+interval '1 hour',now()+interval '5 hours',0,3,3,u,false);
 insert into public.event_ticket_types(id,event_id,name,price,quantity,sold) values(tt,e,'Gratis QA',0,3,0);
 r:=public.claim_free_tickets(e,tt,2,'QA',gen_random_uuid()); tid:=(r->'ticket_ids'->>0)::uuid;
 -- Role exists only inside this rolled-back fixture; no real account is promoted.
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
 update public.profiles set role='admin' where id=u;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 r:=public.admin_launch_overview();
 if (r->>'ticketsSold30d')::integer<2 then raise exception 'missing purchases in overview'; end if;
 failed:=false;
 begin perform public.admin_invalidate_ticket(tid,''); exception when others then failed:=true; end;
 if not failed then raise exception 'missing reason accepted'; end if;
 perform public.admin_invalidate_ticket(tid,'QA valid reason');
 perform public.admin_invalidate_ticket(tid,'QA retry reason');
 select count(*) into n from public.admin_audit_logs where action='ticket_invalidated' and details->>'ticket_id'=tid::text;
 if n<>1 then raise exception 'wrong audit count %',n; end if;
 if (select ticket_status from public.tickets where id=tid)<>'invalidated' then raise exception 'invalidation not persisted'; end if;
 select id into tid from public.tickets where event_id=e and ticket_status='active' limit 1;
 update public.tickets set scanned_at=now(),ticket_status='used' where id=tid;
 failed:=false;
 begin perform public.admin_invalidate_ticket(tid,'QA already used'); exception when others then failed:=true; end;
 if not failed then raise exception 'used ticket mutated'; end if;
 update public.profiles set is_suspended=true where id=u;
 failed:=false;
 begin perform public.admin_launch_overview(); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'suspended admin accepted'; end if;
 if has_function_privilege('anon','public.admin_launch_overview()','EXECUTE') then raise exception 'anonymous overview grant'; end if;
 if has_function_privilege('anon','public.admin_invalidate_ticket(uuid,text)','EXECUTE') then raise exception 'anonymous mutation grant'; end if;
end $test$;
rollback;
select 'PASS: attendee denial, overview, required reason, invalidation, retry audit, used-ticket protection, suspended admin and anonymous denial; fixtures rolled back' as result;
