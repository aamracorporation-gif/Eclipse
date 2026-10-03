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
    or ticket.status in ('cancelled','refunded','used') or ticket.payment_status is distinct from 'paid' then
    raise exception 'Solo se pueden invalidar entradas pagadas y sin utilizar'; end if;
  update public.tickets set ticket_status='invalidated',status='cancelled' where id=p_ticket_id;
  insert into public.admin_audit_logs(admin_id,action,target_user_id,details)
    values(auth.uid(),'ticket_invalidated',ticket.user_id,
      jsonb_build_object('ticket_id',p_ticket_id,'reason',trim(p_reason),'previous_status',ticket.status));
  return jsonb_build_object('success',true);
end $$;
