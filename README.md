# Eclipse (Expo + Supabase) — Notificaciones

## Objetivo
Garantizar que:
- Cualquier cambio relevante en un evento notifique al 100% de compradores en < 60s.
- Las compras, recordatorios y cambios críticos lleguen por in-app + push + email + sms (según preferencias).
- Existan trazas/auditoría por usuario, evento, canal, estado y timestamp.
- El usuario pueda activar/desactivar canales y marketing (opt-in).

## Arquitectura (alto nivel)
- **Persistencia**: `public.notifications` (historial) + `public.notification_deliveries` (cola por canal).
- **Entrega**: Edge Functions procesan `notification_deliveries` pendientes:
  - `send-push` (Expo)
  - `send-email-notifications` (Resend)
  - `send-sms-notifications` (Twilio)
- **Despacho unificado**: `dispatch-notifications` invoca push/email/sms en una sola llamada.
- **Trazabilidad**: `public.notification_delivery_events` registra cada transición de delivery (userId, eventId, canal, estado, error, provider).
- **Idioma**:
  - `public.profiles.language` decide el idioma del usuario.
  - `public.notification_template_translations` permite título/cuerpo por idioma.
  - `enqueue_notification_from_template(...)` selecciona traducción y renderiza placeholders `{{...}}`.

## Flujo (diagrama)
```text
[UPDATE events] (organizer/admin)
        |
        v
Trigger: on_event_update -> handle_event_updates_notification()
        |
        v
INSERT notifications (por cada comprador, según tipo de cambio)
        |
        v
Trigger: trg_create_notification_deliveries -> INSERT notification_deliveries (push/email/sms)
        |
        v
dispatch-notifications (edge)  --->  send-push / send-email-notifications / send-sms-notifications
        |
        v
UPDATE notification_deliveries (sent/failed) + trigger log (notification_delivery_events)
```

## Criterio clave: “evento actualizado”
Se envía notificación si cambia cualquier campo del evento **excepto** contadores de stock (`available_tickets`, `sold_tickets`) para evitar spam durante compras.

Tipos emitidos según cambio:
- `event_cancelled`
- `event_time_changed`
- `event_location_changed`
- `event_access_policy_changed`
- `event_capacity_or_price_changed`
- `event_lineup_changed`
- `event_updated` (genérico)

## Preferencias (RGPD / opt-out)
Tabla: `public.notification_settings`
- Canales: `push_enabled`, `email_enabled`, `sms_enabled`
- Marketing: `marketing_opt_in` (solo opt-in para `event_discount` / `event_offer`)

La UI se gestiona desde `app/notification-preferences.tsx`.

## Enlace único de calendario
Edge Function:
- `ticket-calendar`: genera un `.ics` validando `ticket_id` + `qr_token` (token único).

URL (relativa):
`/functions/v1/ticket-calendar?ticket_id=<uuid>&token=<qr_token>`

## APIs nuevas (RPC)
- `join_event_waitlist(p_event_id uuid) -> jsonb`
- `claim_waitlist_offer(p_offer_token uuid) -> jsonb`
- `notify_event_marketing_to_buyers(p_event_id uuid, p_type text, p_title text, p_body text) -> jsonb`

## Plantillas (notification_templates)
Claves principales:
- Compra: `purchase_completed`, `organizer_realtime_sale`, `resale_sold`
- Evento: `event_updated`, `event_time_changed`, `event_location_changed`, `event_access_policy_changed`, `event_capacity_or_price_changed`, `event_lineup_changed`, `event_cancelled`
- Recordatorios: `event_reminder_24h`, `event_reminder_1h`
- Ticket: `ticket_cancelled_or_refunded`, `ticket_upgraded_or_changed`
- Lista espera: `waitlist_ticket_available`
- Marketing (opt-in): `event_discount`, `event_offer`

## Operación (entrega < 60s)
Recomendado:
- Tras actualizar evento, la app llama a `dispatch-notifications` para vaciar la cola de envíos.
- Para 100% automático (sin depender del cliente), configurar un scheduler externo/cron que llame a `dispatch-notifications` cada minuto.

## Variables de entorno (Supabase Secrets)
- Push:
  - `EXPO_ACCESS_TOKEN` (opcional)
- Email:
  - `RESEND_API_KEY`
  - `NOTIFICATIONS_FROM_EMAIL`
- SMS:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_FROM_NUMBER`

## Tests
`npm test`

Cobertura mínima (notificaciones): 90% (configurada para `lib/notificationSchema.ts`).

## Validación de formularios (eventos)
Implementación principal:
- Reglas + códigos: `lib/eventFormValidation.ts` (`EVT_*`)
- Integración UI (tiempo real, por campo, bloqueo submit): `app/(creator)/create-event.tsx`

Reglas aplicadas (resumen):
- Obligatorios: nombre, ubicación, imagen, fecha y hora; al menos 1 tipo de entrada.
- Numéricos:
  - Edad mínima: entero positivo.
  - Precios: numéricos y mínimo 1,00 €.
  - Cantidades: enteros (mínimo 1); en edición no permite bajar por debajo de lo vendido.
- Texto:
  - Longitud mínima/máxima (nombre, ubicación, etc.).
  - Caracteres permitidos (sin controles; sin saltos de línea en campos cortos).
- Fecha/hora: formato correcto (DD/MM/AAAA, HH:MM) y siempre futuro.
- Duplicados: no permite tipos de entrada duplicados (mismo nombre + precio).

Logs:
- Cuando el formulario falla, se registra `event_form_validation_failed` con `{ field, code, message }` por error.

## Compartición de eventos (enlace persistente + deep link)
Objetivo:
- Compartir un enlace único por evento con formato: `https://weareeclipseoficial.com/evento/<token>`
- Abrir el evento dentro de la app (`eclipse://evento/<token>`) si está instalada.
- Registrar métricas de clics y conversiones.

Backend:
- Migración: `supabase/migrations/20260510093000_event_share_links.sql`
  - `event_share_links` (token persistente)
  - `event_share_clicks` (métricas de clic)
  - `event_share_conversions` (métricas de conversión: open/login)
- Edge Function: `event-share`
  - `POST /functions/v1/event-share` body `{ action: "create", eventId }` (requiere auth) → `{ url, eventId, token }`
  - `GET /functions/v1/event-share/resolve?token=...` (público) → valida estado del evento + registra click
  - `GET /functions/v1/event-share/evento/<token>` (público) → landing HTML que intenta abrir la app y si no, manda a la tienda

App:
- Botón compartir: `app/(tabs)/event/[id].tsx` → llama `event-share` con `{ action: "create" }` y usa el `url` devuelto.
- Deep link handler: `app/evento/[token].tsx`
  - Resuelve el token, guarda `pending_event_share` en AsyncStorage y navega al evento.
  - Tras login/registro, `lib/AuthContext.tsx` reporta conversión llamando `event-share/convert`.

Variables de entorno (Supabase Secrets) para `event-share`:
- `WEB_BASE_URL` (ej: `https://dominio.com`)
- `APP_SCHEME` (ej: `eclipse`)
- `PLAY_STORE_URL` (URL a Google Play)
- `APP_STORE_URL` (URL a App Store)

## Checklist manual pre-producción
- Editar evento y cambiar:
  - título/descripcion/cartel -> llega `event_updated`
  - fecha/hora -> llega `event_time_changed`
  - ubicación -> llega `event_location_changed` (map_url en data)
  - políticas -> llega `event_access_policy_changed`
  - precio -> llega `event_capacity_or_price_changed`
  - cancelar (status/is_cancelled) -> llega `event_cancelled`
- Comprar entrada:
  - llega `purchase_completed` con `calendar_url`
  - llega notificación al organizador (`organizer_realtime_sale`)
- Recordatorios:
  - 24h -> llega `event_reminder_24h` con `ticket_id/qr_token`
  - 1h -> llega `event_reminder_1h` con `ticket_id/qr_token`
- Preferencias:
  - desactivar email -> no se crean deliveries email
  - desactivar sms -> no se crean deliveries sms
  - marketing opt-in off -> no llegan `event_discount/event_offer`
- Auditoría:
  - existe `notification_delivery_events` para cada cambio de estado de delivery
