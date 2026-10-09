# Eclipse: estado de la revisión y entrega iOS

Fecha: 2026-10-04. Código: `ab9e191193e9735fd64d053a4e5e0790c5abfc60`, rama `codex/release-hardening`, PR #22. Esta revisión no acredita que la aplicación esté libre de errores ni autoriza el lanzamiento a producción.

## Build entregada

iOS **1.0.0 (62)**, perfil `testflight`, entorno `preview/staging`.

- Build `78cb9976-3332-41d9-aa59-0b22fd57cb40`: Succeeded.
- Envío `f3b942b9-4609-439a-82ec-86ffe45383f6`: Succeeded; Expo confirma Upload to App Store Connect completado.
- [Envío verificado](https://expo.dev/accounts/ashhhhhhhh/projects/Eclipse/submissions/f3b942b9-4609-439a-82ec-86ffe45383f6).
- Evidencia: `evidence-20261004/testflight-62.jpg`.

La subida está confirmada. No se ha comprobado en App Store Connect el procesamiento posterior de Apple, la disponibilidad para todos los grupos de testers ni instalado el binario en un iPhone. No se ha publicado en App Store.

## Correcciones y estado real

| Riesgo / error | Cambio | Verificación y límite |
|---|---|---|
| Acceso antes de completar Stripe | Layout exige aprobación, Stripe completo y cobros habilitados; refresco al primer plano, Realtime y respaldo periódico. Middleware REST y políticas restrictivas de escritura en DB. | Guard probado en Jest y backend. RLS real rechaza organizador incompleto. **Middleware REST pendiente de despliegue por bloqueo de Railway.** Recorrido nativo pendiente. |
| Aprobación administrativa sigue mostrando pendiente | Actualización inmediata de lista y búsqueda, invalidación de lecturas antiguas; fallo de documentos no degrada estado aprobado. | Código incluido en build62; comprobación visual en móvil pendiente. |
| Suspensión administrativa parcial | Eliminada segunda RPC redundante; la RPC de suspensión cambia suspensión y rechazo en una transacción. | Verificado con fixture SQL en staging. Actualización visual pendiente. |
| Correo arbitrario desde send-ticket-email | Autorización interna antes de leer payload/contactar al proveedor; JWT requerido. | Función desplegada staging; HTTP401 sin sesión,403 anon; cuatro pruebas del handler sin llamada al proveedor. Falta entrega positiva autorizada. |
| Venta estándar + VIP parcial o duplicada | Nueva RPC `sell_manual_order` atómica e idempotente; cierre de RPC antiguas; clave de reintento persistida y bloqueo de doble envío en app. | Staging: fallo VIP revierte estándar; replay idéntico no duplica; clave con carga distinta denegada; sell=false rechazado. Prueba simultánea y UI pendientes. |
| Datos inválidos en venta manual | Validación de nombre, correo, cantidades y edad en RPC. | QA-144 ejecutado bajo rol authenticated: campos vacíos, email inválido y cantidades0,-1,21 rechazados; stock intacto. |
| Selector de año Android y enlaces de confirmación | Cambios previos incluidos: spinner Android, intercambio de código de confirmación una sola vez, configuración staging de redirección/correo. | No equivalen a prueba física en Android ni verificación del correo renderizado en buzón. |

Supabase staging recibió `20261004211339_atomic_sales_and_organizer_readiness` y `20261004212001_fix_manual_sale_receipt`. La segunda corrige un problema de precedencia detectado por la ejecución real de la primera prueba. Ambas están aplicadas; la prueba final pasa. Los fixtures SQL se revierten al terminar.

La build anterior deja de poder llamar directamente las RPC antiguas de venta manual en staging. Usar build62 para probar ese flujo. Esta restricción evita eludir la nueva transacción atómica.

## Bloqueo de despliegue del backend

Railway staging continúa ejecutando `b6b9bbbdca896dd690f388047371b0d64d6164ea`, despliegue `6e8e510b-6760-4a4a-8b62-391a56f8fe2f`. La configuración del servicio está preparada y fijada a `ab9e191`, pero no se creó un nuevo despliegue.

El Dashboard muestra **Limited Access / trial expired / subscription unpaid** y exige regularizar el plan para seguir desplegando. No se ha pagado ni cambiado la suscripción. El usuario debe resolverlo en Railway; después hay que desplegar el commit preparado, verificar que el hash activo coincide y repetir el control de permisos REST. Mientras tanto, **no considerar resuelto el riesgo REST en el servicio vivo**. Las políticas de Supabase sí están activas, pero no sustituyen la comprobación del backend que escribe con privilegios administrativos.

## Pruebas ejecutadas y evidencias

- GitHub CI #101: success en `ab9e191`.
- Jest app: **126 passed, 1 skipped**, 20 suites passed. La omitida no cuenta como ejecutada.
- Backend Node: **56 passed, 0 failed**.
- TypeScript y ESLint: código de salida0.
- SQL real staging: rollback de venta mixta, idempotencia secuencial, permiso sell=false, revocación de RPC antiguas, autorización RLS, suspensión atómica y validación de datos.
- HTTP staging: firma inválida de webhook devuelve400; registro del evento sintético inexistente; handler ejecutado localmente con cero efectos DB/proveedor.
- HTTP Edge sin sesión/anon: email401/403, endpoints de pago/registro retirados410, qa-board404. No se afirma cobertura de cliente autenticado ni entrega positiva por esos códigos.

Los archivos saneados están en `evidence-20261004/` y también adjuntos en Qase. Los casos técnicos `AUTO-*` describen su alcance; no sustituyen los 259 casos manuales originales.

| Ejecución Qase | Resultado verificado |
|---|---|
| #10 · Regresión técnica | 9 Passed, 0 Failed |
| #11 · Regresión manual build62 | 2 Passed, 6 Blocked, 251 Untested |
| #12 · Puerta de despliegue | 1 Failed: Railway mantiene backend anterior |

Total registrado: 11 Passed, 1 Failed y 6 Blocked; 251 casos siguen sin ejecutar. Los182 asserts automatizados están agrupados en controles técnicos; no se presentan como182 recorridos completos de la app. Catálogo actual:259 casos manuales más10 controles técnicos. `qase-execution-20261004.json` conserva IDs de casos, resultados, ejecuciones y adjuntos para continuar sin duplicarlos.

## Continuación manual

Qase run **#11**, “iOS 1.0.0 (62) · regresión de lanzamiento y entrega manual”, contiene los 259 casos originales. QA-086 y QA-144 tienen Passed; QA-141, QA-142, QA-239, QA-245, QA-247 y QA-252 están Blocked por alcance pendiente. Los otros251 siguen Untested. No se ha marcado como fallo de la aplicación una prueba que no pudo ejecutarse.

Empezar por el plan Smoke #12, priorizando:

1. Organizador aprobado con Stripe incompleto: no debe entrar en panel ni por enlaces, atrás o reapertura; completar Stripe y comprobar acceso cuando el servidor lo confirme.
2. Aprobación, rechazo y suspensión desde admin: comprobar cambio inmediato de tarjeta/lista/búsqueda y coherencia después de recargar. Usar el organizador en un segundo móvil.
3. Registro Android con cambio directo de año; correo de verificación legible y apertura de app con ella abierta/cerrada; logo y botón de cerrar sesión sin recortes.
4. Compra Stripe TEST con éxito, rechazo y3DS; pérdida de red/reintento; entradas/PDF/Wallet; devolución y conciliación económica.
5. Cámara/QR, permisos denegados y dos escáneres leyendo la misma entrada; última unidad comprada por dos sesiones a la vez, también venta manual frente a online.
6. Notificaciones reales, enlaces y accesibilidad/estética en iOS/Android pequeño y estándar; instalación limpia y actualización sobre versión anterior.

`manual-handoff-20261004.json` enumera exactamente los257 casos todavía no aprobados, con motivo y pasos. Se conservan los170 defectos históricos: requieren triage; no se han cerrado automáticamente.

## Riesgos todavía sin acreditar

- Simultaneidad real de stock, pagos y accesos QR; conciliación y devoluciones con Stripe TEST. La idempotencia secuencial SQL no prueba concurrencia.
- Permisos/horizontalidad con JWT reales A/B y contratos positivos de todas las Edge Functions.
- Estética y funcionamiento nativo, correo real, cámara, notificaciones, Wallet y callbacks de proveedor.
- Paridad de producción y revisión de sus secretos/configuración. Solo se ha intervenido staging. El acceso a producción fue bloqueado por la revisión automática de autorización; no se ha intentado eludirlo.
- Avisos de seguridad del proveedor pendientes de contextualizar: protección frente a contraseñas filtradas desactivada; extensión pg_net en public; RPC SECURITY DEFINER y tablas internas con RLS sin políticas. Estos avisos no prueban por sí solos explotación; no se cambiaron permisos/extensiones a ciegas.

La puerta de lanzamiento permanece cerrada hasta resolver el despliegue y completar los críticos P0 pendientes.
