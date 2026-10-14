# Candidato de devoluciones y cobro posterior

PR40 sobre PR39, política [vigente](../REFUND_POLICY_20261014.md), consentimiento v2. Desactivado por defecto. No se ha movido dinero real ni activado producción.

## Comprobaciones ejecutadas el 14 de octubre

- **339 Jest aprobadas y 1 omitida**, TypeScript correcto. Backend: **143 aprobadas**. Incluyen permisos SQL efectivos, concurrencia de cancelación/liquidación, compras tardías, informes duplicados, deudas y créditos, reservas atómicas, avisos y saldos insuficientes.
- **16 casos Stripe TEST aprobados** en Eclipse Staging, cuenta acct_1UKJbDQX94Oeeb3v, con SDK 22.6.0 y API 2026-08-26.dahlia. Servicios candidatos y migración real ejecutada en PGlite; pagos, devoluciones, SetupIntents y transferencias reales de API de pruebas. Ejecución final: 18:41–18:46 UTC. Evidencia sanitizada: STRIPE_CANCELLATION_TEST_20261014.json.
- Se corrigió incompatibilidad real de API: allowed_payment_method_types no se combina con automatic_payment_methods. El mandato/cargo del organizador restringe tarjeta mediante el primer parámetro.
- Esquema completo de **staging**: migración 20261014001706_organizer_deferred_cancellation_billing.sql aplicada. backend/scripts/qa-cancellation-staging.sql pasa y revierte todos sus fixtures: consentimiento, cancelación/repetición, avisos en outbox válidos, aviso en cola sin entrega, conciliación repetida, compensación de 34 céntimos, reserva de 17,66 EUR y ausencia de privilegios de cliente. Cero eventos/cuentas QA persistidos. No se ha enviado un aviso a un usuario real.
- Asesores de Supabase: sin advertencias nuevas; permanecen extensión pg_net en public, 30 funciones SECURITY DEFINER anteriores y protección contra contraseñas filtradas. Las 9 nuevas tablas financieras con RLS y sin políticas para clientes añaden avisos INFO deliberados (27 en total), con permisos comprobados.
- El primer CI falló al incluir Stripe nativo en el bundle web. Corregido mediante hook específico por plataforma. La exportación local queda limitada por el enlace a node_modules compartido; la verificación del bundle limpio corresponde a CI del nuevo commit, no se presenta como aprobada localmente.

### Alcance exacto de Stripe

Se prueban guardado sin fianza; devolución íntegra; respuestas perdidas y reintentos; un único cargo desatendido; evento desordenado; coste real del cobro y compensación única; transferencia Connect después del evento/aviso; tarjeta guardada que luego falla y recuperación en el mismo PaymentIntent; SetupIntent que exige autenticación sin falso éxito; compra histórica VIP con parcial/reversión; devolución pendiente que termina; devolución que falla después de éxito; parcial histórico sin recuperación que exige revisión; cargo del organizador devuelto posteriormente.

**Límites:** el informe se construye con costes reales de balance TEST y una declaración de finalidad simulada; no acredita llegada/cobertura del informe definitivo live. Los objetos Stripe se entregan al handler candidato: no certifica transporte remoto ni firma del webhook desplegado. La autenticación bancaria se detecta, pero falta completar el desafío dentro de PaymentSheet en los binarios iOS/Android. El ensayo SQL verifica la cola, no la entrega de email/push. No se prueban saldos/bancos reales.

## Procedimiento de operaciones preparado

Usar backend/scripts/cancellation-accounting.js solo con credenciales de servicio del entorno correcto. No copiar claves a argumentos, informes ni Git. Las operaciones siguientes son el procedimiento futuro; no autorizan activar producción.

1. `prepare-collection <cancelación UUID> <evidencia revisada.json>`: todas las devoluciones deben estar terminadas. Congela comisión histórica + gastos iniciales y encola desglose. No cobra. Evidencia: reference, feesFinalized:true, purchases:[{transactionId,costs:[{reference,category,direction,amountCents,currency}]}]. Categorías processing/refund/collection; dirección debit/credit; moneda eur; identificadores de gasto únicos. No confundir application fee con coste Stripe. No certificar finalidad desde fee inline provisional o cero.
2. `collect <cargo UUID>`: exige aviso entregado o aceptación explícita en app, recupera el mismo PaymentIntent ante respuesta perdida. El worker automático aplica además el margen configurado mínimo de 24 horas. Un cargo menor de 50 céntimos se difiere a liquidaciones sin inflarlo.
3. Tras disponer de costes completos: `reconcile-costs <cargo UUID> <fees.csv> <manifest revisado.json>`. El CSV usa incurred_by,amount,tax,currency y, cuando estén disponibles, fee_transaction_id/id, account_id, fee_description. Se importan céntimos exactos, impuestos y créditos. No volver a sumar los fees inline.
4. El manifiesto debe declarar reference, stripeAccount, livemode, currency:"eur", feesFinalized:true, reviewedBy, reviewedAt y targets:[{providerId,category}]. Incluir cada charge de venta, cada refund exitoso y el charge de cobro. Un coste cero sin fila requiere confirmedZero:true explícito tras revisión. El sistema coteja cada objetivo con Stripe y rechaza otra cuenta/moneda, pagos o devoluciones incompletos, duplicados o ámbito parcial. Un informe posterior es una instantánea completa nueva; genera solo la diferencia, positiva o negativa.
5. El coste del cargo se registra como ajuste y se avisa al organizador. Antes de compensarlo tiene que constar entrega o aceptación autenticada. No se envía otro cargo automático por ese gasto.
6. `release <compra UUID>` calcula el neto sin transferir. Solo `release <compra UUID> --execute --event-completion-verified` reserva y transfiere, tras comprobar finalización explícita. Reserva los ajustes antes de Stripe; no los descuenta en dos pagos concurrentes. Neto cero se registra como compensación sin transferencia; saldo restante continúa pendiente. Un abono puede elevar el neto hasta el máximo de su charge fuente; el exceso se conserva para otra liquidación o soporte.

Una deuda/abono sin ingresos futuros se mantiene pendiente para resolución con soporte, nunca se declara recuperada/devuelta por una anotación. No se ha implementado un segundo cobro automático ni una descarga automática del informe de Stripe. Las incidencias de recuperación histórica, disputas y cargos revertidos requieren revisión antes de desbloquear.

## Activación coordinada pendiente

1. Revisar/aceptar PR39 + PR40 con CI correcto. Ensayar el despliegue backend, Edge create-payment-intent-v2, esquema y app desde el mismo candidato. No atribuir el candidato al servidor Railway antiguo.
2. Configurar cuenta/clave y proyecto TEST coherentes; registrar los eventos webhook y verificar firma, repeticiones, indisponibilidad y entrega real. Completar autenticación, rechazo, retorno y cancelación de PaymentSheet en iOS/Android.
3. Confirmar entrega de avisos al comprador y al organizador, alertas de expedientes pendientes, conciliación de informes y capacidad de devolución de saldos. Confirmar tarifas/facturación y cuenta live, textos contractuales/datos del titular y liquidez antes del despliegue comercial.
4. Migraciones de producción mediante el plan revisado/copia recuperable del lanzamiento; no ejecutar toda la historia SQL indiscriminadamente. Activar solo después de aceptación y verificar un piloto controlado.

| Componente | Configuración de la futura activación |
|---|---|
| Backend y checkout Edge | ORGANIZER_CANCELLATION_BILLING_ENABLED=true; ORGANIZER_BILLING_STRIPE_MODE=test/live acorde con clave |
| Backend | ORGANIZER_BILLING_PROJECT_REF y SUPABASE_URL del mismo proyecto, credencial de servicio válida |
| Worker devoluciones | ORGANIZER_CANCELLATION_WORKER_ENABLED=true |
| Worker cobro desatendido | ORGANIZER_CANCELLATION_COLLECTION_ENABLED=true; ORGANIZER_COLLECTION_NOTICE_DELAY_HOURS mínimo 24 |
| App | EXPO_PUBLIC_ORGANIZER_CANCELLATION_BILLING=true; EXPO_PUBLIC_API_URL del mismo entorno |
| Webhooks | payment_intent.succeeded/payment_failed/requires_action, setup_intent.succeeded, refund.updated/failed, charge.refunded, charge.dispute.created/updated/closed, account.updated |

La activación global no es necesaria para ejecutar los ensayos privados. QA-111/275/279 y los seis bloqueos de lanzamiento conservan las pruebas de aceptación pendientes; esta evidencia no los marca cerrados.
