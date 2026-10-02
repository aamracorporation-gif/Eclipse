-- Staging parity: configuration only, no copied users, tickets or payments.
-- Preserve existing rows and keep monetary wallet/resale disabled.
insert into storage.buckets (id, name, public) values
  ('events', 'events', true),
  ('night_mode', 'night_mode', true),
  ('organizer_verification', 'organizer_verification', false)
on conflict (id) do nothing;

create policy "eclipse_events_public_read" on storage.objects
for select to public using (bucket_id = 'events');
create policy "eclipse_events_owner_insert" on storage.objects
for insert to authenticated with check (bucket_id = 'events' and owner = (select auth.uid()));
create policy "eclipse_events_owner_update" on storage.objects
for update to authenticated
using (bucket_id = 'events' and owner = (select auth.uid()))
with check (bucket_id = 'events' and owner = (select auth.uid()));
create policy "eclipse_events_owner_delete" on storage.objects
for delete to authenticated using (bucket_id = 'events' and owner = (select auth.uid()));
-- organizer_verification deliberately has no client policies; the authenticated
-- upload function authorizes ownership and uses the service role.

insert into public.notification_templates
  (key, title_template, body_template, default_priority, default_channels, dedupe_seconds, enabled)
select key, title_template, body_template, default_priority, default_channels, dedupe_seconds, enabled
from jsonb_to_recordset('[{"key":"purchase_confirmed","enabled":true,"body_template":"Tu entrada para \"{{event_title}}\" está lista. Ve a Mis Entradas para ver el QR.","dedupe_seconds":43200,"title_template":"🎟️ Compra confirmada","default_channels":["in_app","push"],"default_priority":"high"},{"key":"resale_purchased","enabled":false,"body_template":"Tu entrada de reventa para \"{{event_title}}\" está lista. Ve a Mis Entradas para ver el QR.","dedupe_seconds":43200,"title_template":"🎟️ Reventa confirmada","default_channels":["in_app","push"],"default_priority":"high"},{"key":"resale_sold","enabled":false,"body_template":"Vendiste tu entrada para \"{{event_title}}\". El pago está en camino a tu monedero.","dedupe_seconds":43200,"title_template":"💸 ¡Entrada vendida!","default_channels":["in_app","push"],"default_priority":"high"},{"key":"event_date_changed","enabled":true,"body_template":"\"{{event_title}}\" cambió de fecha/hora. Revisa los detalles antes de ir.","dedupe_seconds":0,"title_template":"⏰ Cambio de fecha","default_channels":["in_app","push"],"default_priority":"high"},{"key":"event_venue_changed","enabled":true,"body_template":"\"{{event_title}}\" cambió de lugar. Abre el mapa para ver el nuevo sitio.","dedupe_seconds":0,"title_template":"📍 Cambio de ubicación","default_channels":["in_app","push"],"default_priority":"high"},{"key":"event_cancelled","enabled":true,"body_template":"\"{{event_title}}\" ha sido cancelado. Recibirás información sobre el reembolso.","dedupe_seconds":0,"title_template":"❌ Evento cancelado","default_channels":["in_app","push"],"default_priority":"high"},{"key":"event_updated","enabled":true,"body_template":"\"{{event_title}}\" ha sido actualizado. Revisa los nuevos detalles.","dedupe_seconds":300,"title_template":"🔁 Cambios en el evento","default_channels":["in_app","push"],"default_priority":"normal"},{"key":"event_reminder_24h","enabled":true,"body_template":"\"{{event_title}}\" es mañana. Ten el QR listo y revisa el lugar.","dedupe_seconds":3600,"title_template":"🌙 Tu evento es mañana","default_channels":["in_app","push"],"default_priority":"high"},{"key":"event_reminder_1h","enabled":true,"body_template":"\"{{event_title}}\" empieza en 1 hora. ¡Es hora de ir!","dedupe_seconds":1800,"title_template":"⏰ ¡Tu evento empieza en 1 hora!","default_channels":["in_app","push"],"default_priority":"high"},{"key":"ticket_validated","enabled":true,"body_template":"Tu entrada para \"{{event_title}}\" fue escaneada correctamente. ¡Disfruta!","dedupe_seconds":10,"title_template":"✅ Entrada validada","default_channels":["in_app"],"default_priority":"normal"},{"key":"organizer_new_sale","enabled":true,"body_template":"Se {{quantity}} entrada(s) de \"{{event_title}}\". Revisa el dashboard.","dedupe_seconds":60,"title_template":"💰 Nueva venta","default_channels":["in_app","push"],"default_priority":"high"},{"key":"organizer_verified","enabled":true,"body_template":"Tu perfil de organizador ha sido verificado. Ya puedes crear eventos.","dedupe_seconds":0,"title_template":"✅ Perfil verificado","default_channels":["in_app","push"],"default_priority":"high"},{"key":"organizer_rejected","enabled":true,"body_template":"Tu perfil necesita correcciones: {{reason}}. Actualiza la información e inténtalo de nuevo.","dedupe_seconds":0,"title_template":"❗Verificación rechazada","default_channels":["in_app","push"],"default_priority":"high"}]'::jsonb)
as t(key text, title_template text, body_template text, default_priority text,
     default_channels text[], dedupe_seconds integer, enabled boolean)
on conflict (key) do nothing;
