# Sistema de Notificaciones (Supabase + Expo)

## Vista previa push y filtros (9 de octubre de 2026)

El transporte v2 muestra el título autorizado del aviso (hasta 80 caracteres) y un resumen de su cuerpo (hasta 160), en lugar de sustituir todos los mensajes por una frase genérica. Conserva el significado de cada aviso: compra confirmada, cambio de evento, asignación o recordatorio. Normaliza espacios y termina los textos largos con puntos suspensivos; el detalle completo sigue en el buzón. Los datos de navegación contienen únicamente los identificadores y la versión del esquema; la autorización de sesión y las preferencias se comprueban antes del envío. La vista previa puede mostrar el nombre del evento en la pantalla bloqueada, según los ajustes del sistema del usuario.

La fila de perfiles tiene altura natural, no se comprime contra la lista y permite desplazamiento horizontal. Sus etiquetas se leen antes de seleccionarlas. Los filtros secundarios se distribuyen en varias líneas cuando hace falta, y el encabezado reserva una fila para los ajustes. La revisión visual utiliza la pantalla real con datos ficticios: `ECLIPSE_REVIEW_TOOLS=<tooling>/node_modules node scripts/qa/capture-responsive.cjs --notifications`. Resultados y capturas: `docs/qa/notification-review/`. No sustituye una comprobación visual nativa.

## Objetivo
Unificar y endurecer el sistema de notificaciones para que soporte:
- Notificaciones in-app persistentes con historial, filtros y marcado como leído.
- Notificaciones por rol (cliente/organizador/staff/admin).
- Canales: in-app, push (Expo), email (Resend) y base para SMS.
- Priorización (low/normal/high), estados (pending/sent/failed/blocked/read), métricas y anti-spam.
- Templates personalizables con variables dinámicas.

## Esquema (BD)
Tablas principales:
- `public.notifications`: historial in-app (y fuente para generar entregas por canal).
- `public.notification_deliveries`: cola por canal (`push|email|sms|in_app`), con reintentos.
- `public.notification_delivery_events`: auditoría de cada transición de delivery (canal/estado/error/provider).
- `public.notification_templates`: plantillas por tipo.
- `public.notification_template_translations`: traducciones por idioma.
- `public.notification_settings`: preferencias por usuario/rol y opt-out por canal + marketing opt-in.
- `public.user_push_tokens`: tokens Expo por usuario (con `is_active`).

Funciones RPC / helpers:
- `public.mark_all_notifications_read(p_user_id uuid)`: marca como leídas.
- `public.enqueue_notification(...)`: inserta en cola con rate limit.
- `public.enqueue_notification_from_template(...)`: selecciona idioma, renderiza template + dedupe y encola.
- `public.notify(...)`: wrapper de compatibilidad para triggers/funciones antiguas.
Triggers / jobs:
- `on_event_update` (events): dispara notificaciones a compradores con diff.
- `trg_create_notification_deliveries` (notifications): genera filas en `notification_deliveries` según `channels`.

Migraciones relevantes:
- `supabase/migrations/20260401130000_notifications_unify_v1.sql`
- `supabase/migrations/20260501123000_notification_i18n_prefs_and_logs.sql`
- `supabase/migrations/20260501174000_event_update_notifier_v3_with_ticket_notified_at.sql`

## Plantillas (Templates)
Tabla: `public.notification_templates`
- `key`: tipo de notificación (ej. `purchase_completed`).
- `title_template`, `body_template`: soporta variables `{{var}}` usando `data` (jsonb).
- `default_priority`, `default_channels`: comportamiento por defecto.
- `dedupe_seconds`: evita duplicados por usuario/tipo en una ventana.

## Tipos cubiertos (resumen)
Compra:
- `purchase_completed` (cliente)
- `organizer_realtime_sale` (organizador)
- `resale_sold` (vendedor reventa)

Edición de evento (compradores):
- `event_updated` (genérico)
- `event_time_changed`
- `event_location_changed`
- `event_access_policy_changed`
- `event_capacity_or_price_changed`
- `event_lineup_changed`
- `event_cancelled`

Recordatorios / otros:
- `event_reminder_24h`, `event_reminder_1h`
- `ticket_cancelled_or_refunded`
- `ticket_upgraded_or_changed`
- `waitlist_ticket_available`
- Marketing (opt-in): `event_discount`, `event_offer`

## Disparadores principales
- Compra (tarjeta): `payment_intent.succeeded` → backend llama RPC `fulfill_payment_for_user(...)` → `payment_transactions.status='fulfilled'` → notificaciones de compra.
- Compra (crédito): RPCs de compra generan notificación directamente.
- Evento editado: trigger `on_event_update` llama `send_event_update_notifications(...)`:
  - identifica compradores (`tickets.status='valid'`)
  - genera `diff` + `changed_fields`
  - encola notificación por tipo
  - actualiza `tickets.event_update_notified_at` para evitar reenvíos

Ejemplo de variables en `data`:
```json
{
  "name": "Achraf",
  "event_title": "Eclipse Night",
  "quantity": "2"
}
```

## Canales (Dispatch)
Push:
- Edge Function: `supabase/functions/send-push`
- Selecciona notificaciones `status='pending'` y actualiza a `sent/failed`.
 - Desactiva tokens inválidos (`DeviceNotRegistered`) marcando `user_push_tokens.is_active=false`.

Email:
- Edge Function: `supabase/functions/send-email-notifications`
- Requiere:
  - `RESEND_API_KEY`
  - `NOTIFICATIONS_FROM_EMAIL` (ej. `Eclipse <no-reply@tudominio.com>`)
- Selecciona notificaciones `status='pending'` con `channels` que incluya `email`.

SMS:
- Se deja preparado a nivel de datos (`channels`), pero requiere proveedor (Twilio u otro).

Dispatcher:
- Edge Function: `supabase/functions/dispatch-notifications`
- Ejecuta push/email/sms en una sola llamada (útil para garantizar entrega < 60s).

## Anti-spam / Rate limiting
Dos capas:
- Dedupe por template: `dedupe_seconds`.
- Rate limit general por usuario: si hay >= 5 notificaciones en el último minuto se inserta como `status='blocked'`.

## Auditoría
- `notification_deliveries`: estado por canal con `attempts/max_attempts`.
- `notification_delivery_events`: traza por cada cambio de estado (incluye `event_id` si existe en data).

## Frontend (Expo)
Pantallas:
- Centro in-app: `app/notifications.tsx`
  - Filtros: todas / no leídas / urgentes.
  - Mark as read + mark all as read.
- Preferencias: `app/notification-preferences.tsx`
  - Persistencia en `notification_settings`.

Contexto:
- `lib/NotificationContext.tsx` normaliza campos (`title/body/message`, `read/read_at/status`).

## Roles recomendados
- Cliente (attendee): compras, tickets listos, cambios de evento.
- Organizador (organizer): ventas, stock, moderación, payouts.
- Staff: asignación de eventos, incidencias de validación.
- Admin: auditoría, bloqueos, alertas críticas.
