# Eclipse — Diseño del sistema de notificaciones V1

Estado: PROPUESTA PARA REVISIÓN CON ASH. Seguimiento: #29. Base auditada: `979790cd2e3df05678d98e39e47ce4736f67baf5`, PR #30 sobre #28. Fecha: 2026-10-06.

Este documento define el sistema objetivo. NO añade un worker, una migración, una campaña ni una build; NO activa nuevos envíos. La fase de implementación depende de revisar el diseño y sus decisiones de producto. `docs/notifications.md` describe infraestructura anterior y no constituye evidencia de entrega completa.

## 1. Auditoría y límites

Se inventariaron 54 archivos de rutas/pantallas (incluidos layouts), 21 componentes y 26 entradas de Edge Functions en la instantánea disponible. Se rastrearon los flujos de cliente, organizador, trabajadores, administración, entradas, mesas VIP, taquilla, descuentos, verificación, pagos, soporte y notificaciones. La instantánea precede al PR #30; se contrastó el PR actual y el código de notificaciones en su commit. No se ejecutó una prueba visual o física exhaustiva de las 54 rutas.

En Eclipse Staging se hicieron consultas de sólo lectura a tablas, funciones efectivas, triggers, permisos y agregados; no se copiaron tokens ni datos personales. No se auditó producción ni se invocó un envío.

Hallazgos relevantes:

1. Existen siete tablas principales reutilizables con RLS: notifications, notification_deliveries, notification_delivery_events, notification_templates, notification_template_translations, notification_settings y user_push_tokens. Hay centro, preferencias y workers, pero su coexistencia no demuestra funcionamiento de extremo a extremo.
2. `push_notify` deduplica por usuario + tipo + tiempo; la confirmación pasa 43.200 segundos, sin pedido ni evento. Puede silenciar una segunda compra legítima. También fija rol attendee, prioridad high y canales in_app/push, sin consultar preferencias o plantillas.
3. `on_ticket_created` y `on_payment_fulfilled` pueden originar la misma confirmación; una ventana temporal no es una identidad de compra.
4. Las mesas VIP reciben texto genérico de entrada. Se necesitan mesa, capacidad y condiciones del producto adquirido, sin multiplicar compras por asistentes.
5. `status='read'` comparte campo con estados sincronizados desde entregas. Leer no debe cancelar un correo ni convertir un fallo push en éxito.
6. `send-push` consulta recibos inmediatamente, agrega varios dispositivos en una entrega y guarda provider_message_id vacío. Hay que conservar resultado e ID por dispositivo y consultar recibos posteriormente.
7. `lib/notifications.ts` pide permiso automáticamente; el contexto vuelve a registrar al activar la app. El cierre de sesión auditado no desvincula explícitamente el token. Se requiere registro contextual, identificación de instalación y desvinculación segura.
8. Hay navegación por notificación duplicada en el layout y la pantalla. El cliente no debe ejecutar el dispatcher con credenciales de usuario.
9. En la consulta staging había 17 entregas push pendientes, 2 tokens activos, 13 plantillas, cero traducciones y ninguna fila en cron.job. Esto NO excluye un programador externo no examinado y NO describe producción. El despliegue no debe reenviar automáticamente la cola histórica.
10. Soporte envía un email, pero no se verificó un modelo persistente de casos/respuestas. Hay tablas de espera y valoraciones, pero su flujo de UI completo no se confirmó; tampoco un seguimiento persistente de favoritos. Sus avisos son condicionados.

Evidencia de código: `lib/notifications.ts`, `lib/NotificationContext.tsx`, `app/_layout.tsx`, `app/notifications.tsx`, `app/notification-preferences.tsx`, `supabase/functions/send-push/index.ts`, `send-email-notifications/index.ts`, `send-support-email/index.ts`, `box-office-webhook/index.ts`, `supabase/migrations/20260708000000_notification_complete_fix.sql` y configuración de lanzamiento. Las definiciones efectivas staging se contrastaron en lectura.

## 2. Principios

Un único sistema: hecho confirmado -> audiencia autorizada -> política de preferencias -> historial -> entrega por canal -> seguimiento. El centro in-app es el historial; el push llama la atención; el email contiene el comprobante o detalle extenso.

Cuatro familias: compras/cuenta, cambios importantes, recordatorios y descubrimiento/promociones. Un comprador no acepta marketing por comprar, marcar favorito, instalar la app o conceder el permiso de push. Las promociones permanecen apagadas hasta elección explícita.

La prioridad interna no autoriza a saltarse Focus, modo silencio, permisos del sistema o preferencias. No se solicitará el entitlement de alertas críticas de Apple. Las comunicaciones obligatorias del servicio, si proceden, deben distinguirse de los controles opcionales de push y marketing, con textos y base jurídica revisados antes del lanzamiento.

Reventa y monedero de saldo siguen desactivados. Apple/Google Wallet son pases de entrada, no saldo. No se envía un push para confirmar que se pulsó Añadir a Wallet, ni por cada escaneo correcto, ni por guardar un favorito o aplicar un cupón.

## 3. Catálogo canónico

66 tipos de diseño: 49 objetivos de lanzamiento por etapas, 10 condicionados a completar/verificar su flujo, 3 comerciales opcionales, 2 gestionados por Auth y 2 aplazados. NO son 66 mensajes para cada usuario. Todos los tipos nuevos empiezan desactivados. Los textos se renderizan con datos confirmados y mínimos; los ejemplos y precios de la maqueta son ficticios.

Canales: I = historial in-app, P = push sujeto a permiso/preferencias, E = email sujeto a su política. El catálogo detallado y la maqueta adjuntos a la revisión de diseño desglosan disparador, texto, horario, supresión, destino, deduplicación y dependencias por tipo. No se contempla SMS en V1.

### Cuenta y soporte

| Clave | Condición / momento | Canales objetivo | Fase |
|---|---|---|---|
| auth.verify_email | Registro no verificado; conservar el flujo seguro de Auth | E | Auth existente |
| auth.reset_password | Solicitud explícita; no crear otro email competidor | E | Auth existente |
| auth.email_change | Cambio confirmado y trazable; confirmar soporte del proveedor | E | Condicionada |
| account.welcome | Primera verificación completada; no repetir en cada login | I | Lanzamiento |
| account.password_changed | Evento de seguridad fiable, no inferido desde una pantalla | E | Condicionada |
| account.suspension_changed | Restricción/restablecimiento confirmado; explicar acción permitida | I/P/E | Lanzamiento |
| support.received | Caso persistente creado, no sólo pulsar Enviar | I/E | Condicionada |
| support.reply | Respuesta de un caso accesible al usuario | I/P/E | Condicionada |

### Cliente

| Clave | Condición / momento | Canales objetivo | Fase |
|---|---|---|---|
| order.admission_confirmed | Pedido pagado Y entradas emitidas | I/P/E | Lanzamiento |
| order.vip_confirmed | Mesa completa confirmada; capacidad y beneficios adquiridos | I/P/E | Lanzamiento |
| order.free_confirmed | Invitación emitida; no hablar de cobro | I/P/E | Lanzamiento |
| order.box_office_issued | Venta de taquilla completada y vinculada de forma segura | I/P/E | Lanzamiento |
| order.processing_delayed | Pago confirmado sin entrega tras umbral; no afirmar entrada lista | I/P/E | Lanzamiento |
| payment.async_failed | Fallo posterior confirmado; los errores inmediatos se muestran en checkout | I/P | Lanzamiento |
| ticket.invalidated | Invalidación efectiva y motivo comunicable | I/P/E | Lanzamiento |
| refund.processing | Reembolso solicitado/aceptado, no abonado | I/P/E | Lanzamiento |
| refund.completed | Estado confirmado por el proveedor; no garantizar saldo bancario | I/P/E | Lanzamiento |
| refund.action_required | Se requiere una acción real del cliente; no exponer detalles internos | I/P/E | Lanzamiento |
| event.cancelled | Cancelación efectiva para compradores afectados | I/P/E | Lanzamiento |
| event.schedule_changed | Fecha/hora de la asistencia comprada cambia | I/P/E | Lanzamiento |
| event.venue_changed | Cambia el destino real de asistencia | I/P/E | Lanzamiento |
| event.access_changed | Cambian condiciones de acceso aplicables al comprador | I/P/E | Lanzamiento |
| event.lineup_changed | Cambio material del cartel; agrupar ediciones próximas | I/P | Lanzamiento |
| order.benefits_changed | Cambio real en beneficios contratados, no edición de ofertas futuras | I/P/E | Lanzamiento |
| reminder.event_24h | Un día antes; compra válida, fecha vigente y no avisada | I/P | Lanzamiento |
| reminder.event_2h | Dos horas antes; sustituye el antiguo recordatorio 1h en esta propuesta | I/P | Lanzamiento |
| reminder.entry_deadline | Sesenta minutos antes de hora límite adquirida; consolidar avisos cercanos | I/P | Lanzamiento |
| ticket.checked_in | Acceso registrado; sólo historial, no sonido por cada escaneo | I | Lanzamiento |
| waitlist.available | Disponibilidad real y flujo de espera completo, sin prometer reserva inexistente | I/P | Condicionada |
| favorite.sales_open | Seguimiento persistente y aviso solicitado; reevaluar elegibilidad | I/P | Condicionada |
| marketing.weekend_picks | Selección local relevante y consentimiento comercial vigente | I/P | Opcional |
| marketing.product_discount | Cupón público aplicable al producto; no revelar códigos privados | I/P | Opcional |
| marketing.price_tier_ending | Cambio de tramo verificable; no inventar escasez | I/P | Opcional |
| feedback.event_rating | Asistencia verificable y flujo de valoración habilitado | I/P | Condicionada |
| deferred.resale_update | Sólo cuando la reventa esté aprobada y habilitada | Ninguno ahora | Aplazada |
| deferred.wallet_balance | Sólo cuando el monedero de saldo esté aprobado | Ninguno ahora | Aplazada |

### Organizador

| Clave | Condición / momento | Canales objetivo | Fase |
|---|---|---|---|
| organizer.verification_received | Documentación enviada correctamente | I/E | Lanzamiento |
| organizer.verification_approved | Aprobación efectiva | I/P/E | Lanzamiento |
| organizer.verification_changes | Se requieren cambios concretos | I/P/E | Lanzamiento |
| organizer.connect_action | Stripe indica requisitos o restricciones que requieren atención | I/P/E | Lanzamiento |
| organizer.event_published | Evento publicado correctamente, una vez por publicación | I | Lanzamiento |
| organizer.event_action | Moderación/corrección que requiere acción | I/P/E | Lanzamiento |
| organizer.sales_digest | Ventas reales agrupadas por evento/intervalo | I/P | Lanzamiento |
| organizer.vip_sale | Venta de una mesa; inmediata sólo según preferencia | I/P | Lanzamiento |
| organizer.stock_low | Cruce real de umbral de cada producto | I/P | Lanzamiento |
| organizer.sold_out | Producto agotado, sin repetir en cada actualización | I/P | Lanzamiento |
| organizer.team_joined | Trabajador vinculado correctamente | I/P | Lanzamiento |
| organizer.event_preflight | Antes del evento: personal, QR, taquilla y datos pendientes | I/P | Lanzamiento |
| organizer.event_summary | Resumen posterior con ventas, devoluciones y accesos confirmados | I/E | Lanzamiento |
| organizer.weekly_summary | Resumen semanal configurable | I/E | Lanzamiento |
| organizer.payout_status | Estado de transferencia/payout confirmado; no inferido por venta | I/P/E | Condicionada |
| organizer.box_office_billing | Estado real de facturación de la suscripción de taquilla | I/P/E | Lanzamiento |
| organizer.box_office_expiry | Caducidad/restricción próxima con fecha efectiva | I/P/E | Lanzamiento |

### Trabajador

| Clave | Condición / momento | Canales objetivo | Fase |
|---|---|---|---|
| worker.assignment_added | Asignación vigente a evento | I/P | Lanzamiento |
| worker.assignment_changed | Cambio de tarea/permiso realmente disponible | I/P | Lanzamiento |
| worker.assignment_removed | Retirada de asignación; aviso sin filtrar contenido ya restringido | I/P | Lanzamiento |
| worker.event_brief | Preparación antes del evento asignado | I/P | Lanzamiento |
| worker.event_critical_change | Fecha/lugar/cancelación relevante para su trabajo | I/P | Lanzamiento |

No se inventan turnos horarios ni funciones que no existan en el modelo de asignación. Los resultados de escaneo se muestran en la pantalla de validación; los patrones anómalos se elevan como incidencia agregada, no como un push por error.

### Administrador

| Clave | Condición / momento | Canales objetivo | Fase |
|---|---|---|---|
| admin.verification_queue | Nueva solicitud pendiente, agrupada si hay varias | I/P | Lanzamiento |
| admin.fulfillment_stuck | Cobro confirmado sin entrada emitida | I/P/E | Lanzamiento |
| admin.refund_failed | Reembolso atascado o fallido que requiere conciliación | I/P/E | Lanzamiento |
| admin.stock_conflict | Conflicto de inventario confirmado | I/P/E | Lanzamiento |
| admin.security_pattern | Señal validada y umbrales revisados; no etiquetar fraude sin prueba | I/P/E | Condicionada |
| admin.notification_delivery_incident | Cola envejecida, credenciales o proveedor fallando | I/P/E | Lanzamiento |
| admin.daily_health | Resumen operativo sin datos personales innecesarios | I/E | Lanzamiento |
| admin.report_received | Reporte persistido con flujo de resolución y permisos | I/P | Condicionada |

Un canal averiado no puede ser la única vía para alertar de su propia caída. Destinatario operativo y canal independiente se deben cerrar antes de activar alertas.

## 4. Reglas de frecuencia propuestas, pendientes de decisión

- Recordatorios cliente: 24h y 2h antes. Hora límite: T-60 minutos, sustituyendo el de 2h si quedan a menos de 90 minutos entre sí. Cada recordatorio tiene identidad de evento + usuario + tipo + revisión de fecha. No reenviar retrospectivamente ventanas perdidas.
- Silencio opcional de push: 00:00–11:00 en la zona IANA del usuario. Confirmaciones de acciones iniciadas por el propio usuario pueden ser inmediatas. Para un evento comprado o asignado, proponer una excepción visible y desactivable desde cuatro horas antes hasta su final para cambios importantes y recordatorios pertinentes. Siempre se respetan permisos y controles del sistema operativo; no se garantiza despertar al usuario.
- Ventas del organizador: resumen cada 15 minutos, configurable a inmediato o sólo resumen. Mesas VIP pueden activar avisos individuales; evitar duplicar el mismo detalle en push y digest.
- Stock: avisar al cruzar 20%, 5% y agotado por producto/ciclo de disponibilidad, no por cada compra. Una mesa consume una unidad; un pack mantiene su número real de accesos. Los umbrales dependen de existencias reales.
- Marketing: desactivado por defecto. Máximo global propuesto de un push cada 24h y dos en siete días móviles, sumando todos los locales; ventana 12:00–21:00. No recuperar una acumulación de campañas tras quitar el silencio. Baja inmediata antes de entregar. No campañas libres de locales en V1: aprobación central, destinatarios elegibles y auditoría.
- Resumen de evento: próxima franja de 12:00 que esté al menos dos horas después de su final. Semanal: lunes a las 12:00, configurable. No se suma un intervalo fijo UTC para representar un horario local; considerar DST.
- Si el usuario ya ha accedido, se anula/refunda su acceso, se cancela/reprograma el evento o cambia la elegibilidad: cancelar o recalcular el aviso pendiente. No enviar urgencia de acceso después de caducar.
- No notificar a compradores por cambiar precio/stock de ofertas futuras. Un cupón se comunica sólo a quien pueda aplicarlo, nunca al conjunto de compradores por defecto.

## 5. Experiencia y textos

Centro común con contenido filtrado por rol y permisos; secciones temporales, filtros Todas/No leídas/Importantes, contador fiable, marcar leído, archivar y recuperar detalle. No marcar todo como leído por abrir el centro. Lectura sincronizada entre dispositivos. El borrado/archivo del inbox no destruye la auditoría operativa.

Cada tarjeta: icono semántico, título, explicación breve, fecha relativa, estado y una acción principal. El color no es el único indicador. Estados sin avisos, permiso denegado, carga/error/reintento y destino ya no disponible. Tipografía dinámica, contraste y objetivos táctiles deben validarse en iOS/Android durante implementación.

Preferencias distintas por rol; canales separados; marketing opt-in independiente. Pedir permiso de push en un contexto útil, por ejemplo después de confirmar una entrada o al activar un recordatorio, con explicación previa. No repetir el diálogo en cada foreground. La app debe funcionar con push denegado.

Ejemplos de contenido interno:

- Mesa: «Tu mesa VIP está confirmada» / «Mesa Eclipse para 6 personas en Eclipse Weekend. Consulta el acceso de tu grupo y lo incluido.»
- Cambio de lugar: «Cambio de ubicación» / «Eclipse Weekend se celebrará en Sala Aurora. Revisa la dirección antes de salir.»
- Reembolso: «Reembolso confirmado» / «Se ha tramitado tu reembolso de 40,00 €. El abono depende de tu entidad de pago.» No usar este texto si únicamente se solicitó el reembolso.

En pantalla bloqueada se usa una versión discreta por defecto: «Cambio importante en tu evento. Abre Eclipse para revisar los detalles». Nada de QR válido, secreto de pago, DNI, cuenta bancaria o datos del grupo. No asumir que un push ya enviado puede retirarse al cerrar sesión: minimizar su contenido desde origen.

## 6. Arquitectura y seguridad objetivo

1. Registrar un hecho confirmado de negocio junto con una salida duradera en la misma transacción de base de datos. La entrega externa no participa en la compra. Un fallo al guardar el registro duradero debe ser observable y reintentable, no silenciado con `EXCEPTION WHEN others RETURN NULL`.
2. Un único productor canónico por pedido confirmado. Identidad: entorno + hecho/pedido + destinatario + propósito. Compras gratuitas y taquilla necesitan también un identificador; no depender exclusivamente de payment_intent. Una mesa para seis personas genera una confirmación al comprador, no seis destinatarios inventados.
3. Resolver audiencia con permisos del servidor, no role/email/user_id enviados por el cliente ni user_metadata. Revalidar permisos al enviar y abrir. No vincular una compra invitada a una cuenta basándose sólo en un email sin verificar.
4. Aplicar plantillas versionadas, idioma y preferencias antes de encolar y antes de entregar. Datos obligatorios ausentes deben producir una incidencia visible, no un mensaje con variables sin resolver. Textos se revisan en español; inglés/francés requieren traducción y QA antes de activarlos.
5. Reutilizar historial, preferencias, plantillas y auditoría. Incorporar salida duradera y planificación, identidad única, expiración/cancelación, y entregas por dispositivo. Separar `read_at`/`archived_at` de `queued`, `leased`, `provider_accepted`, `receipt_ok`, `failed`, `suppressed`, `expired` y `unknown`.
6. Reclamar trabajos de forma atómica con leases y bloqueo de filas; recuperar leases vencidos. Dos workers no deben reclamar el mismo trabajo. Reintentos con retroceso y jitter sólo para fallos transitorios, limitados por caducidad. No perder avisos esenciales por un límite comercial ni provocar bucles de incidencias.
7. En Expo: lotes de hasta 100 mensajes del mismo proyecto, IDs y resultados por token, respeto de límites del proveedor, consulta posterior de recibos (recomendación actual: 15 minutos, antes de su borrado a 24h). Desactivar DeviceNotRegistered aparezca al enviar o en recibo. No rebajar autenticación como fallback a un 401.
8. Aceptación por Expo no es entrega al móvil; recibo correcto sólo confirma aceptación por APNs/FCM. Leer/abrir sólo se registra mediante interacción autenticada. No prometer exactly-once ni garantía de recepción: existe ambigüedad si el proveedor acepta antes de un fallo local.
9. En Resend: clave de idempotencia determinista por entrega; la ventana del proveedor es 24h, por lo que se conserva también estado local y se evita un reenvío ciego posterior. Un HTTP timeout no demuestra que el email no se envió. Escapar variables en HTML, enlaces seguros, entrega y rebotes trazables.
10. Tokens por instalación, usuario, entorno, plataforma, permiso y última actividad. Cambios de cuenta deben invalidar asociaciones anteriores, limpiar caché/badge y evitar respuestas tardías del usuario previo. No registrar dispositivos de staging en producción.
11. Un único resolver de navegación: identifica notificación, autentica y consulta permisos. Destinos semánticos, nunca URLs/paths arbitrarios del payload. Si el destino no existe o no es accesible, abrir un detalle seguro en `/notifications`. No tratar un texto de rol como autorización. Resolver y consumir una sola vez las aperturas en frío y con app abierta.
12. RLS y privilegios mínimos: usuario sólo lee/archiva/marca leído su historial y cambia sus preferencias; no crea avisos para otros, no cambia audiencias ni estados de envío. Workers y administradores con permisos separados; no secretos en el cliente. Auditoría y trazas sin tokens/datos bancarios.

Programación exclusivamente servidor: despacho y reconciliación frecuentes con reintento, recordatorios materializados con fecha/revisión, digest y recibos. Jobs autenticados y observables; la app nunca asume que abrirla mantiene viva la cola. El arranque de V1 debe establecer un punto de corte y expirar/revisar pendientes antiguos, no mandar los 17 históricos automáticamente.

Operación propuesta: métricas de antigüedad de cola, aceptación, recibos faltantes, errores por canal, caducados, suprimidos por preferencia y aperturas voluntarias. Un objetivo interno inicial de 95% de entregas esenciales presentadas al proveedor en menos de 60s es un objetivo de operación, no SLA del proveedor ni prueba de recepción. Retención inicial propuesta 90 días de inbox y 30 de datos operativos detallados; revisar finalidad, privacidad y obligaciones antes de aprobarla.

## 7. Plan de implantación

A. Aprobar diseño: recordatorios/horarios, marketing, ventas y responsable de incidencias. Revisar copy y maqueta por los cuatro roles.
B. Núcleo en staging, nuevos envíos desactivados: política única, identidades, salida duradera, RLS, sesiones, permisos y navegación.
C. Piloto esencial: confirmación de pedido/mesa/invitación/taquilla, cancelación, fecha/lugar y reembolsos, con destinatarios de prueba autorizados.
D. Operación: recordatorios, stock, equipo, verificación, suscripción, administración y resumen. Activar sólo tras pruebas de concurrencia y dispositivos.
E. Opcionales: soporte persistente, espera/favoritos/reseñas y marketing después de completar sus dependencias y consentimiento. Reventa y saldo se mantienen aparte.

Aplicar una migración nueva revisada sobre el esquema staging, nunca reproducir a ciegas la cadena histórica. Despliegue incremental de productores y consumidores coordinado; punto de corte por evento/pedido; interruptores por entorno/canal/tipo, posibilidad de pausar entregas sin perder registros ni alterar pagos. Retirada de productores anteriores tras demostrar paridad. No un doble envío como método de migración.

## 8. Aceptación

- Dos compras distintas en segundos, mismo o distinto evento: dos confirmaciones; webhook repetido: una por compra. Confirmar idempotencia real con procesos concurrentes, no sólo test secuencial.
- Mesa con descuento: un pedido, grupo correcto, precio realmente pagado, beneficios del snapshot, sin convertir asistentes en unidades vendidas.
- Invitación y taquilla: texto y comprobante correctos, sin mensajes de cobro inexistente; vinculación segura de receptor.
- Reembolso solicitado/procesando/completado/fallido: mensajes corresponden a estado real, sin garantizar abono bancario.
- Cambio de evento: sólo afectados; reprogramación invalida recordatorios viejos; cancelación cancela promoción/recordatorios pendientes; escaneo cancela recordatorios de llegada.
- Preferencias: negativa OS, silencio, opt-out comercial posterior a encolado, marketing de varios locales concurrentes y cambio de idioma.
- Cuenta A sale y B entra en el mismo móvil: no historial, badge, respuesta tardía o entrega nueva de A a B. Minimizar exposición de pushes ya en tránsito.
- App abierta/cerrada/segundo plano: abrir destino autorizado una sola vez. Ruta inválida, permiso revocado o evento borrado: fallback seguro.
- Worker cae tras aceptación del proveedor: no declarar no entregado ni reenviar a ciegas. Recibo tardío, token inválido, 429/5xx, lease vencido y entrega parcialmente correcta entre dispositivos.
- Despacho apagado y recuperación: cola observable, caducados no se envían, compras siguen sin depender de HTTP del proveedor.
- Verificación de accesibilidad, idioma, Android canales/permiso y pruebas físicas iPhone/Android en una build firmada; Expo Go o un HTML no sustituyen esa prueba.

Se entregó una maqueta HTML local navegable con contenido ficticio y catálogo JSON/Markdown detallado. Validación del diseño: 14 pruebas del contrato del catálogo y 12 comprobaciones de interacción del HTML, sin errores JS en esas comprobaciones. NO son pruebas de la app nativa, de RLS, de envío ni del backend futuro. El prototipo no usa red ni activa preferencias de la cuenta real.

## 9. Decisiones que debe confirmar Ash

1. ¿Incluir promociones preparadas pero apagadas, activables mediante consentimiento, con máximo global de dos push semanales?
2. ¿Ventas del organizador agrupadas cada 15 minutos, con opción separada de aviso VIP inmediato, o preferencia inicial distinta?
3. ¿Recordatorios 24h/2h y excepción nocturna desactivable para eventos comprados/asignados, o cambiar horario/cadencia?
4. Antes del piloto operativo: responsable que recibirá incidencias y canal independiente. No se asigna a otra persona por suposición.

## Referencias técnicas consultadas

- Expo Push Service, tickets/receipts y límites: https://docs.expo.dev/push-notifications/sending-notifications/
- API de notificaciones SDK 54: https://docs.expo.dev/versions/v54.0.0/sdk/notifications/
- Apple App Review, notificaciones 4.5.4: https://developer.apple.com/app-store/review/guidelines/
- Resend idempotencia: https://resend.com/docs/dashboard/emails/idempotency-keys
- Supabase Cron: https://supabase.com/docs/guides/cron

Revalidar APIs, convenciones y changelogs antes de implementar. Las cifras, horarios y retenciones de producto anteriores son propuestas, no requisitos del proveedor ni asesoramiento legal.
