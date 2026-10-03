-- Read actual paid ticket totals, never event-price estimates or truncated lists.
create or replace function private.admin_launch_overview()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin' and not is_suspended)
    then raise insufficient_privilege using message='Solo administradores activos'; end if;
  select jsonb_build_object(
    'users',count(*), 'organizers',count(*) filter(where role='organizer'),
    'pending',count(*) filter(where role='organizer' and verification_status='pending_verification'),
    'needsCorrection',count(*) filter(where role='organizer' and verification_status='needs_correction'),
    'verified',count(*) filter(where role='organizer' and verification_status='verified'),
    'rejected',count(*) filter(where role='organizer' and verification_status='rejected'),
    'suspended',count(*) filter(where is_suspended)
  ) into result from public.profiles;
  result:=result || (select jsonb_build_object('eventsTotal',count(*),
    'upcomingEvents',count(*) filter(where event_date>=now() and coalesce(status,'') not in ('cancelled','postponed'))) from public.events);
  result:=result || (select jsonb_build_object('ticketsSold30d',coalesce(sum(quantity),0),
    'estRevenue30d',coalesce(sum(total_price),0)) from public.tickets
    where purchase_date>=now()-interval '30 days' and purchase_date<=now()
      and payment_status='paid' and coalesce(status,'') not in ('refunded','cancelled')
      and coalesce(ticket_status,'')<>'invalidated');
  return result || jsonb_build_object('activeResales',0,
    'auditActions7d',(select count(*) from public.admin_audit_logs where created_at>=now()-interval '7 days'),
    'reports7d',(select count(*) from public.event_reports where created_at>=now()-interval '7 days'));
end $$;
create or replace function public.admin_launch_overview()
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_launch_overview(); $$;
revoke all on function private.admin_launch_overview() from public, anon;
revoke all on function public.admin_launch_overview() from public, anon;
grant execute on function private.admin_launch_overview() to authenticated;
grant execute on function public.admin_launch_overview() to authenticated;

-- Invalidation is audited; it never deletes purchase history, reactivates used
-- tickets, releases stock or pretends to issue a refund.
create or replace function private.admin_invalidate_ticket(p_ticket_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket public.tickets%rowtype;
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='admin' and not is_suspended)
    then raise insufficient_privilege using message='Solo administradores activos'; end if;
  if length(trim(coalesce(p_reason,'')))<5 or length(p_reason)>500 then
    raise exception 'Indica un motivo de entre 5 y 500 caracteres'; end if;
  select * into ticket from public.tickets where id=p_ticket_id for update;
  if not found then raise exception 'Entrada no encontrada'; end if;
  if ticket.ticket_status='invalidated' then return jsonb_build_object('success',true); end if;
  if ticket.scanned_at is not null or coalesce(ticket.ticket_status,'active') not in ('active')
    or ticket.status in ('cancelled','refunded','used') or ticket.payment_status<>'paid' then
    raise exception 'Solo se pueden invalidar entradas pagadas y sin utilizar'; end if;
  update public.tickets set ticket_status='invalidated',status='cancelled' where id=p_ticket_id;
  insert into public.admin_audit_logs(admin_id,action,target_user_id,details)
    values(auth.uid(),'ticket_invalidated',ticket.user_id,
      jsonb_build_object('ticket_id',p_ticket_id,'reason',trim(p_reason),'previous_status',ticket.status));
  return jsonb_build_object('success',true);
end $$;
create or replace function public.admin_invalidate_ticket(p_ticket_id uuid,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$ select private.admin_invalidate_ticket(p_ticket_id,p_reason); $$;
revoke all on function private.admin_invalidate_ticket(uuid,text) from public, anon;
revoke all on function public.admin_invalidate_ticket(uuid,text) from public, anon;
grant execute on function private.admin_invalidate_ticket(uuid,text) to authenticated;
grant execute on function public.admin_invalidate_ticket(uuid,text) to authenticated;
