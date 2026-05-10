# Despliegue y rollback (notificaciones + balance + editor)

## Pre-requisitos
- Backups habilitados en Supabase.
- Secrets configurados en Supabase:
  - Email: `RESEND_API_KEY`, `NOTIFICATIONS_FROM_EMAIL`
  - Push: `EXPO_ACCESS_TOKEN` (si aplica)
  - SMS: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`
- Stripe webhook apuntando al backend `/stripe/webhook`.

## Despliegue
1. Ejecutar migraciones Supabase (ordenadas por timestamp).
2. Deploy de Edge Functions:
   - `dispatch-notifications`
   - `ticket-calendar`
   - (ya existentes) `send-push`, `send-email-notifications`, `send-sms-notifications`
3. Deploy backend (Express):
   - Confirmar que `/stripe/webhook` está activo y usando la key/secret correctos.
4. Publicar app (Expo/EAS) con los cambios de UI:
   - Dashboard organizador (métricas y realtime)
   - Editor de evento/tipos/VIP (UUID + soft delete)

## Rollback (rápido)
1. Frontend:
   - Revertir versión móvil/web (EAS Update / store rollback).
2. Backend:
   - Revertir el deploy del servidor (última release estable).
3. Base de datos:
   - Deshabilitar triggers nuevos si fuese necesario:
     - `trg_organizer_credit_on_payment_fulfilled` en `payment_transactions`
     - `on_event_update` en `events`
   - Mantener tablas nuevas (no destructivo); el rollback operativo es desactivar triggers y dejar de consumirlas.

## Recuperación / Recalcular balances
- Ejecutar la migración de backfill:
  - `20260501175000_backfill_organizer_revenue_from_fulfilled_transactions.sql`
- Validar que `organizer_balances` y `organizer_stats_cache` quedan consistentes.
