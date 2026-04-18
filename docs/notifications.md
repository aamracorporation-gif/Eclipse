# Sistema de Notificaciones (Supabase + Expo)

## Objetivo
Unificar y endurecer el sistema de notificaciones para que soporte:
- Notificaciones in-app persistentes con historial, filtros y marcado como leído.
- Notificaciones por rol (cliente/organizador/staff/admin).
- Canales: in-app, push (Expo), email (Resend) y base para SMS.
- Priorización (low/normal/high), estados (pending/sent/failed/blocked/read), métricas y anti-spam.
- Templates personalizables con variables dinámicas.

## Esquema (BD)
Tablas principales:
- `public.notifications`: historial y cola de entrega.
- `public.notification_templates`: plantillas por tipo.
- `public.notification_settings`: preferencias por usuario/rol.
- `public.user_push_tokens`: tokens Expo por usuario.

Funciones RPC / helpers:
- `public.mark_all_notifications_read(p_user_id uuid)`: marca como leídas.
- `public.enqueue_notification(...)`: inserta en cola con rate limit.
- `public.enqueue_notification_from_template(...)`: renderiza template + dedupe y encola.
- `public.notify(...)`: wrapper de compatibilidad para triggers/funciones antiguas.

Migraciones relevantes:
- `supabase/migrations/20260401130000_notifications_unify_v1.sql`
- `supabase/migrations/20260401131500_purchase_fulfilled_notifications.sql`

## Plantillas (Templates)
Tabla: `public.notification_templates`
- `key`: tipo de notificación (ej. `purchase_completed`).
- `title_template`, `body_template`: soporta variables `{{var}}` usando `data` (jsonb).
- `default_priority`, `default_channels`: comportamiento por defecto.
- `dedupe_seconds`: evita duplicados por usuario/tipo en una ventana.

## Notificaciones añadidas
Estas son las notificaciones que quedaron añadidas/registradas en el sistema (plantillas + notificaciones directas por rol):

### Plantillas (notification_templates)
- `purchase_completed`
  - Título: `🎉 ¡Compra completada!`
  - Mensaje: `¡Listo, {{name}}! Tu compra para "{{event_title}}" se confirmó. Tienes {{quantity}} entrada(s) lista(s) en Mis Entradas.`
  - Prioridad: `high`
  - Canales: `in_app`, `push`
  - Anti-duplicado: 60s
- `ticket_ready`
  - Título: `🎟️ Tu entrada está lista`
  - Mensaje: `Tu QR para "{{event_title}}" ya está disponible. Muéstralo en la entrada.`
  - Prioridad: `normal`
  - Canales: `in_app`, `push`
  - Anti-duplicado: 120s
- `event_modified`
  - Título: `🔁 Cambios en el evento`
  - Mensaje: `Hubo cambios en "{{event_title}}". Revisa los nuevos detalles antes de ir.`
  - Prioridad: `high`
  - Canales: `in_app`, `push`
  - Anti-duplicado: 300s
- `event_cancelled`
  - Título: `⚠️ Evento cancelado`
  - Mensaje: `"{{event_title}}" ha sido cancelado. Estamos gestionando el reembolso si aplica.`
  - Prioridad: `high`
  - Canales: `in_app`, `push`
  - Anti-duplicado: 300s
- `security_alert`
  - Título: `🚩 Alerta de seguridad`
  - Mensaje: `{{message}}`
  - Prioridad: `high`
  - Canales: `in_app`, `push`
  - Anti-duplicado: 60s

### Notificaciones directas (sin template)
Estas se insertan directamente en `public.notifications` (sin pasar por template), con datos en `data`:
- `organizer_realtime_sale` (rol `organizer`)
  - Título: `💰 Nueva venta`
  - Mensaje: `Se vendieron {quantity} entrada(s) para {event_title}`
  - Prioridad: `normal`
  - Canales: `in_app`, `push`

## Evento que las dispara
- Compra completada (cliente): se encola `purchase_completed` cuando `payment_transactions.status` pasa a `fulfilled` (trigger `trg_payment_fulfilled_notifications`).
- Compra completada (organizador): se encola `organizer_realtime_sale` cuando `payment_transactions.status` pasa a `fulfilled` y existe `events.creator_id`.

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

Email:
- Edge Function: `supabase/functions/send-email-notifications`
- Requiere:
  - `RESEND_API_KEY`
  - `NOTIFICATIONS_FROM_EMAIL` (ej. `Eclipse <no-reply@tudominio.com>`)
- Selecciona notificaciones `status='pending'` con `channels` que incluya `email`.

SMS:
- Se deja preparado a nivel de datos (`channels`), pero requiere proveedor (Twilio u otro).

## Anti-spam / Rate limiting
Dos capas:
- Dedupe por template: `dedupe_seconds`.
- Rate limit general por usuario: si hay >= 5 notificaciones en el último minuto se inserta como `status='blocked'`.

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
