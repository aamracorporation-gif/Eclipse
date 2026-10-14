# Candidato de cobro posterior por cancelación

Base: PR39, commit e5d5be94ce528546511b41946906674a50bcfda3. Decisión comercial vigente: `../REFUND_POLICY_20261014.md`.

## Estado

Código candidato, desactivado por defecto. Ningún despliegue ni movimiento de dinero realizado. Los seis bloqueos de lanzamiento siguen abiertos.

Migración generada con Supabase CLI: `20261014001706_organizer_deferred_cancellation_billing.sql`. Cambios aditivos, tablas con RLS sin permisos para clientes, funciones de aplicación SECURITY INVOKER y helpers internos con search_path fijo. El estado de una cancelación y su pago no puede ser escrito por un cliente. Se preservan los historiales y las FK de PR39.

## Validación local

Resultado final local: **339 pruebas Jest aprobadas y 1 omitida; 130 pruebas del backend aprobadas**. Total: 469 aprobadas. TypeScript, lint de archivos modificados y comprobación de espacios del diff correctos. Este resultado no es CI remota ni aceptación del producto.

- Pruebas de cálculo, consentimiento, propiedad/mode, reintentos después de respuesta perdida, devoluciones parciales, gastos desconocidos, duplicación de evidencias y recuperación de cobro.
- PGlite ejecuta la migración y comprueba permisos reales de anon/authenticated/service_role, atomicidad, cancelación sin autorización, inmutabilidad, expiración de leases, compra tardía y liquidación tras cancelación.
- Regresiones del backend, devoluciones de entrada/mesa/reventa y webhooks. Las siete pruebas HTTP locales necesitaron ejecutarse fuera del aislamiento porque este bloquea 127.0.0.1; no falló una regla funcional.
- TypeScript y lint de las pantallas modificadas aprobados después de regenerar las rutas con el script oficial del proyecto.

No son pruebas de integración con Stripe, del esquema completo de staging, de entregabilidad de avisos ni de dispositivos físicos. No se declara cerrado QA-111, QA-275, QA-279 o el lanzamiento.

## Activación coordinada, solo tras la aceptación pendiente

No activar estas variables en producción ahora. Son la documentación del despliegue futuro:

| Componente | Configuración |
|---|---|
| Backend y Edge de checkout | ORGANIZER_CANCELLATION_BILLING_ENABLED=true; ORGANIZER_BILLING_STRIPE_MODE=test/live coherente con la clave |
| Backend | ORGANIZER_BILLING_PROJECT_REF y SUPABASE_URL exactamente coincidentes; credencial de servicio válida |
| Backend, devoluciones | ORGANIZER_CANCELLATION_WORKER_ENABLED=true |
| Backend, cargos desatendidos | ORGANIZER_CANCELLATION_COLLECTION_ENABLED=true y ORGANIZER_COLLECTION_NOTICE_DELAY_HOURS configurado, mínimo 24 |
| App | EXPO_PUBLIC_ORGANIZER_CANCELLATION_BILLING=true y EXPO_PUBLIC_API_URL del mismo entorno |
| Webhooks Stripe | payment_intent.succeeded, payment_intent.payment_failed, payment_intent.requires_action, setup_intent.succeeded, refund.updated, refund.failed, account.updated |

Mantener la API/SDK Stripe existente evita cambiar simultáneamente la integración de ventas histórica. Antes de activar, validar los parámetros de SetupIntent/PaymentSheet con esa versión y planificar la actualización del SDK por separado. La configuración de métodos debe ofrecer tarjeta para este mandato.

## Conciliación operativa

`backend/scripts/cancellation-accounting.js` es una herramienta interna de operaciones con credencial de servicio, nunca accesible a un organizador:

- `prepare-collection <cancelación> <evidencia.json>`: recibe evidencia revisada de Stripe, exige todas las devoluciones terminadas, calcula comisión + gastos, congela el cargo inicial y crea el aviso. No cobra.
- `collect <cargo>`: cobra/reconcilia el PaymentIntent inicial, exige aviso registrado; no fabrica una entrega. No se ha ejecutado.
- `release <compra>`: consulta elegibilidad y neto. Solo `--execute --event-completion-verified` permite una transferencia, después de la fecha de fin explícita, sin cancelación/ajustes pendientes. No se ha ejecutado.

La evidencia usa `reference` (informe de Stripe revisado), `feesFinalized:true` y `purchases:[{transactionId,costs:[{reference,category,direction,amountCents,currency}]}]`. Categorías: processing/refund/collection; dirección debit/credit. Cada referencia de gasto es única. No incluir la application fee como coste de Stripe. No certificar feesFinalized a partir solo del servicio cobrado al comprador o de un fee inline provisional.

Pendiente para completar la automatización: importación y validación de los informes de gastos, ajustes finales del coste del cobro/abonos, ensayos Stripe y dispositivos, y verificación de alertas/avisos. Los campos de costes residuales quedan pendientes; cambiar su estado sin conciliarlos no es una resolución contable.
