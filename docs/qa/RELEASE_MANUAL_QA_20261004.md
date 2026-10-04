# Eclipse: revisión de flujos y plan manual de lanzamiento

Fecha: 2026-10-04. Rama: `codex/release-hardening`, base `b6b9bbbdca896dd690f388047371b0d64d6164ea` más las correcciones de este cambio.

## Resultado y límites

259 casos manuales diseñados en 21 suites; 119 críticos P0. Diseño basado en rutas, operaciones RPC/Edge, backend y documentación del repositorio. No equivale a 259 pruebas ejecutadas ni garantiza ausencia de errores. Android/iOS reales, correos, Connect, pagos y permisos deben ejecutarse contra la build resultante. El inventario es estático: enumera fuentes y operaciones; no constituye cobertura de ramas de código ni una auditoría exhaustiva de cada dependencia.

Se han reemplazado los 472 casos anteriores de Qase tras exportar casos, suites, planes y defectos. Los 170 defectos históricos se conservan para triage; su vigencia no ha sido confirmada y sus referencias a casos antiguos pueden quedar obsoletas. La copia completa queda fuera del repositorio público.

## Correcciones incluidas

- El layout de organizador exige aprobación, cuenta Stripe, onboarding completo y cobros habilitados; las rutas ocultas y los enlaces internos también quedan bajo el mismo control. Admin mantiene su acceso independiente de Stripe. Cuentas suspendidas no entran en el panel.
- El perfil se consulta al recuperar primer plano, con Realtime y respaldo periódico de 15 segundos mientras el layout está montado. No se toma abrir el navegador como prueba de haber completado Stripe. La pantalla de verificación consulta Stripe al volver de segundo plano.
- Tras aprobación/corrección/rechazo se actualizan tanto resultados de búsqueda como lista filtrada, se invalidan lecturas anteriores y se recargan datos. Respuestas antiguas de búsquedas no reemplazan la búsqueda actual.
- Un error al leer documentos ya no transforma visualmente una aprobación válida en pendiente.

## Riesgos encontrados que requieren ejecución o corrección posterior

| Prioridad | Hallazgo | Evidencia y prueba |
|---|---|---|
| P0 | El bloqueo de navegación no basta para garantizar bloqueo del servidor. Las rutas REST de eventos solo exigen rol organizer y el servicio escribe con cliente administrativo. | `backend/src/routes/eventRoutes.js`, `backend/src/services/eventService.js`, `backend/src/middlewares/auth.js`. Ejecutar caso API sin onboarding; revisar también RLS/RPC de mutaciones de organizador. No se afirma explotación confirmada en staging. |
| P0 | send-ticket-email reenvía destinatario, remitente y HTML sin comprobar emisor interno en el código de la función. Si se despliega accesible a clientes, existe riesgo de envío arbitrario. | `supabase/functions/send-ticket-email/index.ts`; caso Contrato send-ticket-email. Verificar despliegue/autorización real y restringir antes de lanzamiento; no se han enviado correos para explotarlo. |
| P0 | La venta manual estándar y VIP usa dos RPC consecutivas, con riesgo de éxito parcial y duplicación al reintentar. | `app/(worker)/sell.tsx`, `sell_tickets_manual_v2`, `sell_vip_manual`. Caso Venta mixta y fallo parcial. |
| P0 | Suspensión y rechazo son dos RPC consecutivas; un fallo de la segunda puede dejar estado parcialmente actualizado. | `app/(creator)/admin-verification.tsx`. Revisar con fallo inducido y volver a cargar. El guard nuevo sí bloquea por is_suspended. |
| P0 | El stock final, la idempotencia, las devoluciones y los accesos QR simultáneos necesitan pruebas concurrentes reales. | Plan de pagos/seguridad y casos con dos dispositivos; pruebas secuenciales no sustituyen concurrencia. |
| P1 | La presentación física y retorno de enlaces dependen del binario, SO y ajustes de proveedor. | 40 casos visuales y flujos de callback/correo/Stripe; no evaluados físicamente en esta revisión. |
| P1 | Configuración staging no acredita paridad de producción. | Verificar runbook y secretos del entorno de lanzamiento, sin copiar secretos a cliente o informe. |

## Cobertura por flujo

| Suite | Casos | Fuente y alcance |
|---|---:|---|
| 01 · Registro y acceso | 14 | app/(auth)/*; lib/AuthContext.tsx |
| 02 · Verificación y Stripe Connect | 13 | app/(creator)/_layout.tsx; verification.tsx; supabase/functions/stripe-connect-* |
| 03 · Administración | 13 | app/(creator)/admin-verification.tsx; admin-profile.tsx; admin-tickets.tsx; index.tsx |
| 04 · Perfil cliente y preferencias | 9 | app/(tabs)/profile.tsx; app/notification-preferences.tsx |
| 05 · Descubrimiento y mapa | 10 | app/(tabs)/index.tsx; party-map.tsx; lib/event*; lib/home* |
| 06 · Detalle, compartir y enlaces | 8 | app/(tabs)/event/[id].tsx; app/evento/*; supabase/functions/event-share; ticket-calendar |
| 07 · Compra, descuentos y pagos | 16 | app/(tabs)/event/[id].tsx; lib/payments/*; supabase/functions/create-payment-intent-v2; confirm-payment |
| 08 · Webhooks, devoluciones y conciliación | 8 | backend/src/services/webhookProcessor.js; refundUnavailablePurchase.js; supabase/migrations/*fulfill* |
| 09 · Mis entradas, PDF y carteras digitales | 10 | app/(tabs)/tickets.tsx; lib/ticket*; supabase/functions/apple-wallet-generator; generate-wallet-pass |
| 10 · Crear y gestionar eventos | 13 | app/(creator)/create-event.tsx; manage-events.tsx; backend/src/routes/eventRoutes.js |
| 11 · Descuentos y estadísticas | 7 | app/(creator)/discount-codes.tsx; event-discounts.tsx; stats.tsx; global-stats.tsx; event-stats/[id].tsx |
| 12 · Equipo e invitaciones | 8 | app/(creator)/workers/*; worker-qr.tsx; app/(tabs)/join-worker.tsx |
| 13 · Escaneo organizador y trabajador | 9 | app/(creator)/scan.tsx; app/(worker)/scan.tsx; validate_ticket_qr_v3; validate_ticket_worker_v2 |
| 14 · Venta manual de trabajadores | 7 | app/(worker)/sell.tsx; sell_tickets_manual_v2; sell_vip_manual |
| 15 · Notificaciones | 7 | app/notifications.tsx; notification-preferences.tsx; lib/NotificationContext.tsx; supabase/functions/*notifications* |
| 16 · Seguridad y aislamiento | 10 | docs/EDGE_FUNCTION_AUTH_MATRIX.md; supabase/migrations; backend/src/middlewares/auth.js |
| 17 · Funciones aplazadas y compatibilidad | 6 | docs/DEFERRED_RESALE_WALLET.md; lib/launchFeatures.ts; supabase/functions/_shared/launchPolicy.ts |
| 18 · Navegación, errores y release | 10 | app/_layout.tsx; app/+not-found.tsx; app/auth-required.tsx; app/legal/*; docs/MOBILE_STAGING_BUILD.md |
| 19 · Estética por pantalla y plataforma | 40 | app/**; components/ui/**; theme/styles.ts |
| 20 · Matriz de rutas protegidas | 17 | app/(creator)/_layout.tsx; lib/creatorAccess.ts |

| 21 · Contratos de todas las Edge Functions | 24 | Cada función tiene prueba de autenticación, propiedad o contrato público/retirado. |

## Preparación de datos

Crear fixtures identificados por fecha/run: cliente A y B, cliente no confirmado, organizador pendiente/rechazado/corrección, organizador aprobado sin Stripe, organizador listo, admin real en profiles, trabajador con venta y trabajador solo escaneo. Usar dos móviles para cambios en vivo y concurrencia. Eventos futuros con stock 1/5, gratuito, estándar, VIP, pasado y cancelado; códigos de un uso, vencidos y de otro organizador. Preparar entradas válidas, usadas e invalidadas. Todas las transacciones en Stripe TEST.

No manipular usuarios reales, no reactivar reventa/saldo, no incluir secretos en capturas. Para fallos inducidos, clonar fixtures o utilizar entorno QA aislado; no romper secretos compartidos de staging.

## Orden de ejecución

1. Crear una ejecución de Smoke crítico por plataforma/build. Ejecutar regresiones de onboarding y aprobación primero.
2. Ejecutar los planes funcionales Cliente, Organizador, Administración y Trabajadores.
3. Responsable técnico ejecuta pagos, concurrencia, aislamiento, llamadas API/RPC y webhooks con Stripe TEST.
4. Ejecutar planes visuales Android e iOS en dispositivos pequeños y estándar, con fuente grande y permisos denegados.
5. Ejecutar navegación/release, instalación limpia y actualización. Repetir fallos corregidos y después la regresión completa.

Cada resultado debe tener build/commit, SO/dispositivo, precondiciones reales, pasos, esperado/observado, captura/vídeo y IDs anonimizados. Marcar Blocked cuando falte configuración o fixture; nunca Passed por inferencia desde el código. Los planes se solapan intencionadamente; evitar repetir casos dentro de la misma ejecución completa.

## Criterio de salida

- Cero P0 fallidos o bloqueados. Resolver riesgos de autorización del servidor antes del lanzamiento.
- P1 resueltos o decisión explícita documentada del responsable de lanzamiento con impacto conocido.
- Conciliación de pagos y stock, idempotencia, QR y separación de usuarios demostradas con evidencia.
- Aprobación de aspecto visual en ambas plataformas y enlaces verificados con app abierta/cerrada.
- Revisar los 170 defectos históricos: reproducible/corregido/duplicado/no aplicable; no cerrarlos automáticamente.

## Funciones aplazadas

Reventa nueva y monedero de saldo permanecen desactivados en UI y servidor. Se prueban sus bloqueos, cancelación de ofertas anteriores y conservación del histórico. No ejecutar pruebas positivas de reventa/saldo en esta release. Apple Wallet/Google Wallet para entradas, PDF, tarjetas, VIP y descuentos sí están incluidos.

## Archivos y trazabilidad

`manual-cases-20261004.json`: definiciones completas para reconstruir casos, con claves QA estables. `source-inventory-20261004.json`: fuentes y operaciones detectadas. `route-coverage-20261004.json`: asignación de cada uno de los 53 archivos de rutas a suites y casos; asignación a suite no implica que todos los estados posibles estén probados. `qase-published-20261004.json`: IDs remotos tras publicación y verificación. Cada suite incluye rutas fuente para localizar el flujo.

## Depuración del catálogo anterior

Las incidencias antiguas incluyen Google/Apple Sign-In; no se ha localizado implementación de OAuth en las pantallas de autenticación ni AuthContext actuales. No se inventan pruebas positivas de una función ausente. Revisar esas incidencias como no aplicables a esta versión o requisito pendiente, sin cerrarlas automáticamente.

## Verificación del cambio de código

- Commit de corrección: `c27e1e23ec336d46a259d0426d3ef1b7b71d8deb`, incluido en PR #22.
- TypeScript y lint: sin errores.
- CI GitHub #99: completada correctamente para el commit de corrección.
- Jest: 122 pruebas aprobadas, 1 previamente omitida. Incluye 12 pruebas del control de acceso de organizador.
- Exportación de bundles Metro para Android e iOS: completada. Esto verifica empaquetado JavaScript; no genera por sí solo APK/IPA firmado ni instala el cambio en dispositivos.
- Falta ejecutar regresiones manuales en una nueva build de esta revisión. La versión instalada anteriormente no cambia por actualizar GitHub.

## Planes publicados y verificados en Qase

Proyecto `ECLIPSE`: 259 casos manuales, 21 suites y 12 planes. Los 170 defectos anteriores permanecen. Todos los casos se leyeron después de crearlos para verificar título, suite, pasos, resultado esperado y condición manual. Se comprobaron además los 18/119/259 miembros de los planes Smoke/P0/Completo.

| ID Qase | Plan | Casos |
|---:|---|---:|
| 12 | 00 · Smoke rápido — primer recorrido | 18 |
| 2 | 01 · Críticos P0 — puerta de lanzamiento | 119 |
| 3 | 02 · Cliente — registro a entrada | 74 |
| 4 | 03 · Organizador y Stripe | 58 |
| 5 | 04 · Administración y estados | 13 |
| 6 | 05 · Trabajadores y accesos QR | 24 |
| 7 | 06 · Pagos, concurrencia y seguridad | 64 |
| 8 | 07 · Android — revisión visual | 20 |
| 9 | 08 · iOS — revisión visual | 20 |
| 10 | 09 · Release, navegación y resiliencia | 56 |
| 11 | 10 · Regresión completa de lanzamiento | 259 |
| 13 | 11 · Contratos Edge — responsable técnico | 24 |

Abrir el proyecto Eclipse App en Qase, sección Test Plans. Empezar por **00 · Smoke rápido — primer recorrido**. Crear ejecuciones separadas por build y plataforma; ningún resultado manual se ha marcado como aprobado en esta tarea. El Smoke no sustituye los 119 críticos ni la regresión completa.
