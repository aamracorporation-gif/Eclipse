begin;
do $test$
declare u uuid:='a9270000-0000-4000-8000-000000000001'; e uuid:=gen_random_uuid(); tt uuid:=gen_random_uuid();
 k uuid:=gen_random_uuid(); r jsonb; r2 jsonb; tid uuid; d timestamptz; failed boolean; n integer;
begin
 update auth.users set email_confirmed_at=now() where id=u;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 insert into public.events(id,title,event_date,end_datetime,ticket_price,available_tickets,capacity,creator_id,allow_resale)
 values(e,'QA free ticket rollback',now()+interval '1 hour',now()+interval '5 hours',0,3,3,u,false);
 insert into public.event_ticket_types(id,event_id,name,price,quantity,sold,metadata)
 values(tt,e,'Gratis hasta límite',0,3,0,'{"entryDeadlineMinutes":120}');
 r:=public.claim_free_tickets(e,tt,2,'QA',k);
 if (r->>'success')::boolean is distinct from true then raise exception 'claim failed'; end if;
 r2:=public.claim_free_tickets(e,tt,2,'QA',k);
 if r->'ticket_ids' is distinct from r2->'ticket_ids' then raise exception 'retry duplicated tickets'; end if;
 select count(*) into n from public.tickets where event_id=e;
 if n<>2 then raise exception 'wrong ticket count'; end if;
 select available_tickets into n from public.events where id=e;
 if n<>1 then raise exception 'wrong stock'; end if;
 tid:=(r->'ticket_ids'->>0)::uuid;
 select entry_deadline into d from public.tickets where id=tid;
 if d is null then raise exception 'missing deadline'; end if;
 update public.tickets set entry_deadline=null where id=tid;
 if (select entry_deadline from public.tickets where id=tid) is distinct from d then raise exception 'deadline changed'; end if;
 failed:=false;
 begin perform public.claim_free_tickets(e,tt,2,'QA',gen_random_uuid()); exception when others then failed:=true; end;
 if not failed then raise exception 'oversell allowed'; end if;
 update public.event_ticket_types set price=10 where id=tt;
 failed:=false;
 begin perform public.claim_free_tickets(e,tt,1,'QA',gen_random_uuid()); exception when others then failed:=true; end;
 if not failed then raise exception 'paid ticket claimed free'; end if;
 update public.event_ticket_types set price=0 where id=tt;
 failed:=false;
 begin perform public.claim_free_tickets(e,null,1,'QA',gen_random_uuid()); exception when others then failed:=true; end;
 if not failed then raise exception 'type bypass allowed'; end if;
 r2:=public.validate_ticket_qr_v3((select qr_token::text from public.tickets where id=tid),e);
 if (r2->>'valid')::boolean is distinct from true then raise exception 'valid free QR rejected: %',r2; end if;
 r2:=public.validate_ticket_qr_v3((select qr_token::text from public.tickets where id=tid),e);
 if (r2->>'valid')::boolean is distinct from false then raise exception 'QR reused'; end if;
 -- Claim just before a cutoff, then assert the same QR cannot be validated after it.
 update public.events set event_date=clock_timestamp()-interval '59 seconds' where id=e;
 update public.event_ticket_types set metadata='{"entryDeadlineMinutes":1}' where id=tt;
 r2:=public.claim_free_tickets(e,tt,1,'QA',gen_random_uuid());
 tid:=(r2->'ticket_ids'->>0)::uuid;
 perform pg_sleep(2);
 failed:=false;
 begin perform public.validate_ticket_qr_v3((select qr_token::text from public.tickets where id=tid),e);
 exception when others then
   if SQLERRM not like '%ENTRADA CADUCADA%' then raise; end if;
   failed:=true;
 end;
 if not failed then raise exception 'expired QR admitted'; end if;
 if (select scanned_at from public.tickets where id=tid) is not null then raise exception 'expired scan consumed ticket'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 failed:=false;
 begin perform public.claim_free_tickets(e,tt,1,'QA',gen_random_uuid()); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'anonymous claim allowed'; end if;
 if has_function_privilege('anon','public.claim_free_tickets(uuid,uuid,integer,text,uuid)','EXECUTE') then raise exception 'anon grant'; end if;
end;
$test$;
rollback;
select 'PASS: free issue, retry, stock, oversell, paid rejection, type enforcement, deadline snapshot, QR single use, expiry, no consumption on expiry, anonymous rejection; fixtures rolled back' as result;