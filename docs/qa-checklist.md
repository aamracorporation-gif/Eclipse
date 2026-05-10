# Checklist QA (ventas, editor, notificaciones, realtime)

## Ventas → balance organizador (≤ 2s)
- Comprar entrada (tarjeta) en un evento del organizador:
  - El organizador ve el cambio en dashboard sin recargar (realtime).
  - Muestra: Ventas bruto | Comisión | Neto.
  - El neto aumenta con la compra (idempotente: una sola vez).

## Panel stats
- Verifica que:
  - Total ventas bruto corresponde a sumatorio de transacciones.
  - Comisión corresponde a la suma de `platform_fee`.
  - Neto corresponde a `destination_amount` (o bruto-fee).
  - Cache TTL ≤ 5 min (si no hay nuevas ventas, la lectura es cached).

## Editor tipos de entrada
- Añadir tipo nuevo:
  - Aparece en lista con badge “NUEVO” durante 5s.
  - Guardar → recargar → sigue existiendo y no se duplica.
- Duplicados:
  - Intentar crear (mismo nombre + mismo precio) → bloquea con error.
- Eliminar:
  - Si `sold > 0`: botón deshabilitado + aviso al intentar.
  - Si `sold = 0`: se elimina y no aparece en cliente.

## VIP editor
- Añadir VIP:
  - Badge “NUEVO” 5s.
  - Guardar → recargar → no se duplica.
- Borrar VIP:
  - Desaparece de lista tras guardar.

## Notificaciones por edición de evento
- Editar evento (título/fecha/ubicación/imagen/descr):
  - Solo usuarios con ticket válido reciben notificación.
  - Payload incluye `changed_fields`, `diff` y `event_url`.
  - No se re-envía si ya se notificó para ese `updated_at` (tickets.event_update_notified_at).
- Admin re-notify:
  - RPC `admin_resend_event_update_notifications(event_id)` fuerza reenvío.

## Realtime cliente
- En pantalla de detalle del evento:
  - Cambiar el evento desde organizador → banner “Actualización en tiempo real”.
  - Se actualiza disponibilidad/precio sin recargar.
