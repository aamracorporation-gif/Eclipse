# Eclipse — Sistema de notificaciones V1

**Estado: diseño propuesto para revisión con Ash. No implementado ni activado.** Seguimiento #29. Base auditada `979790cd2e3df05678d98e39e47ce4736f67baf5` (PR #30 sobre #28). Revisión 2026-10-06.

Este documento conserva el diseño y catálogo resumidos en el repositorio. El paquete de diseño entregado en la conversación contiene la especificación extensa, el catálogo detallado JSON/Markdown y la maqueta HTML navegable. Este cambio es sólo documentación: no modifica pagos, base de datos, workers, preferencias reales ni builds. No activa envíos. La infraestructura anterior de `docs/notifications.md` no demuestra entrega completa.

## 1. Auditoría y límites

Se inventariaron 54 archivos de rutas/pantallas (incluidos layouts), 21 componentes y 26 entradas de Edge Functions en la instantánea disponible. Se rastrearon roles, compras, mesas VIP, taquilla, descuentos, verificación, equipo, administración, soporte y notificaciones. La instantánea precede al PR #30; se contrastó el PR actual y el código de notificaciones en su commit. No se ejecutó una prueba visual ni física exhaustiva de las 54 rutas.

Se consultó Eclipse Staging en sólo lectura: esquema, funciones efectivas, triggers, permisos y agregados. No se copiaron tokens ni datos personales. No se auditó producción ni se invocó un envío.

Hallazgos:

- Existen siete tablas principales reutilizables con RLS: notifications, notification_deliveries, notification_delivery_events, notification_templates, notification_template_translations, notification_settings, user_push_tokens. La existencia de RLS no sustituye pruebas de permisos efectivos.
- `push_notify` deduplica por usuario + tipo + tiempo; la confirmación usa 43.200 segundos sin pedido ni evento. Puede silenciar una segunda compra real. Fija rol attendee, prioridad high y canales in_app/push; no consulta las preferencias ni plantillas.
- `on_ticket_created` y `on_payment_fulfilled` pueden emitir la misma confirmación. El mensaje compartido por entradas y mesas no describe correctamente un reservado VIP.
- Lectura y entrega se mezclan mediante `status='read'` y sincronización desde entregas. Leer no debe cancelar un email ni convertir un error de envío en éxito.
- `send-push` consulta recibos inmediatamente, agrega varios dispositivos en una sola entrega y deja provider_message_id vacío. Necesita trazabilidad posterior y por token.
- El registro pide permiso automáticamente y se repite al activar la app. No se encontró desvinculación explícita de token en el cierre de sesión auditado. La navegación está duplicada en layout y pantalla; el cliente no debe ejecutar el dispatcher de servicio.
- En la consulta staging: 17 entregas push pendientes, 2 tokens activos, 13 plantillas, ninguna traducción y ninguna fila en cron.job. Puede existir programación externa no examinada. No reenviar automáticamente la cola histórica al desplegar.
- Soporte envía correo, pero no se confirmó un modelo persistente de casos/respuestas. Existen tablas de espera y valoraciones, pero no se confirmó su flujo completo ni seguimiento persistente de favoritos. Sus avisos son condicionados.

Evidencias de código: `lib/notifications.ts`, `lib/NotificationContext.tsx`, `app/_layout.tsx`, `app/notifications.tsx`, `app/notification-preferences.tsx`, los workers `send-push`, `send-email-notifications`, `send-support-email`, `box-office-webhook`, la configuración de lanzamiento y `supabase/migrations/20260708000000_notification_complete_fix.sql`. Se contrastaron funciones y triggers efectivos en staging.

## 2. Principios

Un solo sistema: **hecho confirmado -> audiencia autorizada -> preferencias -> historial -> entregas por canal -> seguimiento**. Centro in-app como historial, push para llamar la atención cuando aporta valor y email para comprobantes o explicaciones extensas.

Cuatro familias: compras/cuenta, cambios importantes, recordatorios y descubrimiento/promociones. Marketing requiere una elección independiente; instalar, comprar, marcar favorito o aceptar push no equivale a aceptar publicidad. Sin SMS en V1.

No activar reventa ni monedero de saldo. Los pases Apple/Google Wallet no son saldo. No enviar push por guardar un favorito, aplicar un cupón, añadir un pase a Wallet o cada escaneo correcto. Tampoco por editar el precio/stock de una oferta futura a quien ya compró, salvo cambio real de sus condiciones adquiridas.

## 3. Catálogo canónico y canales iniciales

66 tipos de diseño: **49 objetivos de lanzamiento por etapas, 10 condicionados, 3 comerciales opcionales, 2 de Auth y 2 aplazados**. No son 66 mensajes para cada usuario. Todos los tipos nuevos empiezan desactivados; los canales siguientes son los previstos para cuando se apruebe su fase, siempre sujetos a sus reglas. I = in-app; P = push; E = email. No duplicar la autenticación de Supabase con otro envío.

### Cuenta y soporte

| Clave | Disparador confirmado | Canales | Fase |
|---|---|---|---|
| auth.verify_email | Registro pendiente de verificación | E | Auth existente |
| auth.reset_password | Solicitud explícita de recuperación | E | Auth existente |
| auth.email_change | Cambio de email con evento fiable | E | Condicionada |
| account.welcome | Primera verificación completada | I | Lanzamiento |
| account.password_changed | Cambio de contraseña verificable, no inferido desde UI | E/I | Condicionada |
| account.suspension_changed | Restricción o restablecimiento efectivo | E/I | Lanzamiento |
| support.received | Caso persistente creado | I/E | Condicionada |
| support.reply | Respuesta en un caso accesible al destinatario | I/P/E | Condicionada |

### Cliente

| Clave | Disparador / condición | Canales | Fase |
|---|---|---|---|
| order.admission_confirmed | Pedido pagado y entradas emitidas | I/P/E | Lanzamiento |
| order.vip_confirmed | Mesa completa confirmada, con capacidad y beneficios | I/P/E | Lanzamiento |
| order.free_confirmed | Invitación emitida, sin fingir un cobro | I/P/E | Lanzamiento |
| order.box_office_issued | Venta de taquilla completada y vinculada con seguridad | I/E | Lanzamiento |
| order.processing_delayed | Pago confirmado sin entrada tras umbral | I/P | Lanzamiento |
| payment.async_failed | Fallo posterior de pago confirmado | I/P | Lanzamiento |
| ticket.invalidated | Invalidación efectiva con motivo comunicable | I/P/E | Lanzamiento |
| refund.processing | Reembolso iniciado/aceptado, todavía no completado | I/E | Lanzamiento |
| refund.completed | Estado completado por proveedor, sin garantizar saldo bancario | I/P/E | Lanzamiento |
| refund.action_required | Acción real requerida al cliente | I/E | Lanzamiento |
| event.cancelled | Cancelación que afecta al comprador | I/P/E | Lanzamiento |
| event.schedule_changed | Cambio de fecha/hora de su asistencia | I/P/E | Lanzamiento |
| event.venue_changed | Cambio del lugar real | I/P/E | Lanzamiento |
| event.access_changed | Cambio de las condiciones de acceso aplicables | I/P/E | Lanzamiento |
| event.lineup_changed | Cambio material del cartel; agrupar ediciones próximas | I/P | Lanzamiento |
| order.benefits_changed | Cambio real en ventajas contratadas | I/P/E | Lanzamiento |
| reminder.event_24h | Un día antes, compra y fecha todavía vigentes | I/P | Lanzamiento |
| reminder.event_2h | Dos horas antes, sin acceso ya registrado | I/P | Lanzamiento |
| reminder.entry_deadline | T-60 minutos respecto a hora límite adquirida | I/P | Lanzamiento |
| ticket.checked_in | Acceso registrado; sin sonido/push | I | Lanzamiento |
| waitlist.available | Disponibilidad real y flujo de espera operativo | I/P | Condicionada |
| favorite.sales_open | Seguimiento persistente y aviso solicitado | I/P | Condicionada |
| marketing.weekend_picks | Selección local relevante, consentimiento vigente | I/P | Opcional |
| marketing.product_discount | Cupón público válido para el producto concreto | I/P | Opcional |
| marketing.price_tier_ending | Cambio de tramo real, sin escasez inventada | I/P | Opcional |
| feedback.event_rating | Asistencia comprobable y valoración habilitada | I | Condicionada |
| deferred.resale_update | Sólo tras aprobar y habilitar reventa | Ninguno activo; I previsto | Aplazada |
| deferred.wallet_balance | Sólo tras aprobar y habilitar saldo | Ninguno activo; I previsto | Aplazada |

### Organizador

| Clave | Disparador / condición | Canales | Fase |
|---|---|---|---|
| organizer.verification_received | Documentación presentada | I/E | Lanzamiento |
| organizer.verification_approved | Aprobación efectiva | I/P/E | Lanzamiento |
| organizer.verification_changes | Se solicitan cambios concretos | I/P/E | Lanzamiento |
| organizer.connect_action | Requisito/restricción real de Stripe | I/P/E | Lanzamiento |
| organizer.event_published | Publicación confirmada | I | Lanzamiento |
| organizer.event_action | Moderación/corrección que requiere atención | I/E/P | Lanzamiento |
| organizer.sales_digest | Ventas reales agrupadas por evento y periodo | I/P | Lanzamiento |
| organizer.vip_sale | Mesa vendida, según preferencia individual | I/P | Lanzamiento |
| organizer.stock_low | Cruce de umbral real por producto | I/P | Lanzamiento |
| organizer.sold_out | Producto agotado, sin repetir cada actualización | I/P | Lanzamiento |
| organizer.team_joined | Trabajador vinculado correctamente | I | Lanzamiento |
| organizer.event_preflight | Preparación de evento, personal y taquilla | I/P | Lanzamiento |
| organizer.event_summary | Resumen posterior con cifras confirmadas | I/E | Lanzamiento |
| organizer.weekly_summary | Resumen semanal configurable | I/E | Lanzamiento |
| organizer.payout_status | Transferencia/payout comprobado, no inferido por venta | I/E | Condicionada |
| organizer.box_office_billing | Estado real de la suscripción de taquilla | I/E | Lanzamiento |
| organizer.box_office_expiry | Fecha efectiva de caducidad/restricción | I/E | Lanzamiento |

### Trabajador

| Clave | Disparador / condición | Canales | Fase |
|---|---|---|---|
| worker.assignment_added | Nueva asignación vigente | I/P | Lanzamiento |
| worker.assignment_changed | Cambio de tarea/permiso existente | I/P | Lanzamiento |
| worker.assignment_removed | Asignación retirada; contenido ya restringido no visible | I/P | Lanzamiento |
| worker.event_brief | Preparación del evento asignado | I/P | Lanzamiento |
| worker.event_critical_change | Fecha/lugar/cancelación que afecta al trabajo | I/P | Lanzamiento |

No inventar turnos que no existan en el modelo. Resultados de escaneo en su pantalla; patrones anómalos como incidencia agregada, no un push por error.

### Administrador

| Clave | Disparador / condición | Canales | Fase |
|---|---|---|---|
| admin.verification_queue | Solicitud pendiente; agrupar si hay varias | I/P | Lanzamiento |
| admin.fulfillment_stuck | Cobro confirmado sin entrada | I/P/E | Lanzamiento |
| admin.refund_failed | Reembolso atascado/fallido | I/P/E | Lanzamiento |
| admin.stock_conflict | Conflicto real de inventario | I/P/E | Lanzamiento |
| admin.security_pattern | Señal fiable y umbrales revisados | I/P | Condicionada |
| admin.notification_delivery_incident | Cola envejecida o entrega averiada | I/E | Lanzamiento |
| admin.daily_health | Resumen operativo sin datos personales innecesarios | I/E | Lanzamiento |
| admin.report_received | Reporte persistido con proceso de resolución | I | Condicionada |

El canal averiado no puede ser la única vía para alertar de su caída. Responsable y canal independiente se cierran antes del piloto.

## 4. Política propuesta de frecuencia y supresión

- Cliente: 24h y 2h antes (esta propuesta sustituye el 1h anterior). Hora límite T-60 minutos sustituye 2h si ambos quedan a menos de 90 minutos. Identidad por evento + usuario + tipo + revisión de fecha; no enviar retrospectivamente ventanas perdidas.
- Silencio push opcional 00:00–11:00 en zona IANA del usuario. Confirmaciones iniciadas por el propio usuario pueden ser inmediatas. Excepción nocturna visible y desactivable para avisos pertinentes de eventos comprados/asignados, desde T-4h hasta el final. Nunca saltarse permisos, Focus ni controles del sistema operativo; no se solicita entitlement de alertas críticas.
- Ventas: agrupar cada 15 minutos por defecto, con opciones inmediato o sólo resumen; VIP individual opcional sin duplicación innecesaria en el digest.
- Stock: 20%, 5% y agotado por producto/ciclo. Una mesa es una unidad; pack/grupo no se confunde con número de compras. No repetir por fluctuaciones del mismo umbral.
- Marketing: apagado inicialmente. Máximo global propuesto un push cada 24h y dos por siete días móviles, entre 12:00–21:00, sumando todos los locales. Consentimiento comprobado al enviar. No vaciar campañas acumuladas al acabar silencio. En V1, plantillas y aprobación central; no campañas libres por local ni códigos privados expuestos.
- Resumen del evento: próxima franja de 12:00 situada al menos dos horas después del final. Semanal lunes 12:00, configurable. Considerar DST; un horario local no es sumar siempre 24h en UTC.
- Cancelación, reprogramación, reembolso, validación QR o retirada de permiso recalculan/cancelan trabajos pendientes. No recordar llegar después de caducar el acceso. No cambiar silenciosamente beneficios de una compra al editar el catálogo futuro.

## 5. UX, mensajes y privacidad

Centro por rol con filtros Todas/No leídas/Importantes, agrupación temporal, contador fiable, lectura sincronizada, archivo y detalle. Abrir el centro no marca todo leído. Lectura/archivo no borran auditoría. Cada tarjeta contiene icono, título, explicación, momento, estado y una acción principal. Diseñar carga, vacío, error/reintento, permiso denegado y destino no disponible. Comprobar contraste, texto dinámico, lector de pantalla y tamaño táctil al implementar.

Preferencias distintas por rol, canales separados, marketing independiente y modo nocturno explícito. Petición contextual de permiso después de comprar o activar recordatorios, no repetida en cada foreground. Push denegado no impide utilizar la app.

Texto interno VIP: «Tu mesa VIP está confirmada. Mesa Eclipse para 6 personas en Eclipse Weekend. Consulta el acceso de tu grupo y lo incluido». Una mesa, una confirmación al comprador; no inventar contactos de sus invitados.

Cambio importante: «Cambio de ubicación. Eclipse Weekend se celebrará en Sala Aurora. Revisa la dirección antes de salir».

Reembolso completado: «Se ha tramitado tu reembolso de 40,00 €. El abono depende de tu entidad de pago». No usar ese estado al solicitar el reembolso.

Pantalla bloqueada discreta por defecto: «Cambio importante en tu evento. Abre Eclipse para revisar los detalles». Nunca QR válido, secretos de pago, DNI, datos bancarios o del grupo. No asumir que se puede retirar un push ya en tránsito al cerrar sesión. Los importes de la maqueta son ficticios, no una tarifa actual garantizada.

## 6. Arquitectura y garantías

### Hechos, audiencia y datos

Persistir un hecho confirmado y su salida duradera en la misma transacción de BD. La entrega HTTP externa nunca participa en la compra. Un fallo al escribir esa salida debe ser observable/reintentable, no silenciado. Un productor canónico por pedido emitido; identidad entorno + pedido/hecho + destinatario + propósito. Invitaciones/taquilla necesitan identidad propia, no sólo payment_intent.

Audiencias y roles se resuelven en servidor, no desde user_metadata, email/rol declarados por el cliente o un listado enviado por organizador. Revalidar destinatarios al enviar y abrir. No asignar compra invitada basándose sólo en email sin verificar. Separar cliente/organizador/trabajador/admin aunque una cuenta tenga varios contextos.

Plantillas versionadas, variables obligatorias y preferencias al encolar y al entregar. Ausencia de datos produce incidencia, no mensajes rotos. Copy español definido; inglés/francés requieren traducción y QA antes de activar esos idiomas.

### Cola y entregas

Reutilizar las siete tablas y añadir salida duradera/planificación, identidades únicas, expiración/cancelación y entregas por dispositivo. Separar `read_at`/`archived_at` de estados `queued`, `leased`, `provider_accepted`, `receipt_ok`, `failed`, `suppressed`, `expired`, `unknown`.

Reclamación atómica con leases y bloqueo de filas; recuperar leases vencidos. Retroceso exponencial con jitter y caducidad. Límite comercial no elimina un aviso esencial. Idempotencia local no garantiza exactly-once externo: caída después de aceptación crea ambigüedad que se debe registrar, no reenviar a ciegas.

Expo: hasta 100 mensajes del mismo proyecto por lote, resultados/IDs por dispositivo, consulta posterior de recibos (recomendación actual 15 minutos; borrado a 24h), invalidación DeviceNotRegistered tanto en ticket como recibo. Aceptación Expo no es recepción del móvil; recibo correcto sólo confirma aceptación APNs/FCM. Apertura/lectura requiere interacción registrada. No fallback sin autenticación ante 401.

Resend: idempotencia determinista por entrega y estado local duradero; ventana del proveedor 24h. Un timeout no demuestra que no envió. Escapar HTML, CTA autorizado, seguimiento de rebotes/entrega y sin reenviar automáticamente después de vencer la ventana.

### Cliente, permisos y operación

Tokens por instalación/usuario/entorno/plataforma/permiso. Al salir/cambiar cuenta: desvincular asociación, limpiar historial/caché/badge, descartar respuestas tardías y revalidar destino; pushes ya en tránsito llevan contenido mínimo.

Único resolver de navegación con identificador de aviso, autenticación y autorización. Destinos semánticos, no URL/paths arbitrarios. Si no existe/acceso revocado, detalle seguro en `/notifications`. Apertura en frío/foreground consumida una sola vez. La app nunca llama al dispatcher con la sesión de usuario ni mantiene viva la cola por abrirse.

RLS y privilegios mínimos: usuario lee/archiva/marca leído lo propio y cambia sus preferencias; no modifica audiencias ni estados de entrega. Workers/administración separados, nada de secretos en frontend. Auditoría sin tokens o datos bancarios. Verificar políticas, no sólo que RLS esté activa.

Programador servidor para dispatcher, recordatorios, digest, reconciliación y recibos; jobs autenticados y observables. Punto de corte al desplegar: revisar/expirar pendientes antiguos sin envío masivo. Pausa por entorno/canal/tipo sin perder hechos ni alterar pagos.

Métricas: edad de cola, aceptación, recibos ausentes, errores, caducados, suprimidos por preferencias y aperturas voluntarias. Objetivo inicial propuesto: 95% de esenciales presentados al proveedor antes de 60s; no es SLA externo ni prueba de recepción. Retención propuesta 90 días de inbox y 30 de datos operativos detallados; revisar privacidad/finalidad y obligaciones antes de aprobar. Responsable y vía independiente para incidencias pendientes de confirmar.

## 7. Implantación y aceptación

A. Revisar diseño/copy/maqueta por cuatro roles, cerrar recordatorios, silencio, ventas y marketing.
B. Núcleo staging con envíos nuevos desactivados: identidades, salida duradera, preferencias, RLS, sesiones y resolver.
C. Piloto esencial con destinatarios autorizados de prueba: pedidos, VIP, gratis, taquilla, cancelación, fecha/lugar y reembolsos.
D. Recordatorios, inventario, equipo, verificación, suscripción, administración y resúmenes.
E. Funciones condicionadas/comerciales sólo al completar dependencias y consentimiento. Reventa/saldo aparte.

Nueva migración revisada, no repetir a ciegas la cadena histórica. Desplegar productores/consumidores coordinados, retirar productores antiguos después de paridad y tener reversión que conserve salida duradera. No emitir doble como método de transición.

Aceptación requerida:

- Dos compras distintas en segundos generan dos confirmaciones; webhook repetido sólo una por pedido. Probar concurrencia real, no sólo secuencia.
- VIP con descuento conserva capacidad, beneficios y precio realmente pagado. Invitación/taquilla no fingen cobros o receptores verificados.
- Reembolso solicitado/procesando/completado/fallido con lenguaje correcto, sin garantizar abono bancario.
- Cambios afectan sólo a destinatarios pertinentes; reprogramación/cancelación/QR invalidan recordatorios y promociones viejas.
- Permiso denegado, silencio, baja comercial posterior a encolado, cuotas comerciales concurrentes de varios locales, idioma y DST.
- Cuenta A sale y B entra: sin historial, badge, respuesta tardía ni entrega nueva de A a B; minimizar exposición de pushes en tránsito.
- App abierta/cerrada/segundo plano: una navegación autorizada; evento borrado/permiso revocado/ruta inválida tienen fallback seguro.
- 429/5xx, token inválido, recibo tardío, resultado parcial entre dispositivos, worker caído tras aceptación, lease vencido y caducidad.
- Recuperación de cola sin enviar caducados; compras independientes de HTTP proveedor; fallo de alertas visible fuera de su propio canal.
- QA físico iPhone/Android con build firmada y accesibilidad. HTML o Expo Go no sustituyen esas pruebas.

Validación realizada en el paquete de diseño: **14 pruebas de contrato del catálogo y 12 comprobaciones de interacción del prototipo HTML**. No son pruebas del backend futuro, RLS, app nativa ni entrega. Prototipo con datos ficticios, sin red y sin cambios en la cuenta real.

## 8. Decisiones de Ash

1. Promociones preparadas pero apagadas, con opt-in y máximo global de dos push semanales: confirmar alcance V1.
2. Ventas agrupadas cada 15 minutos y VIP individual opcional: confirmar modo inicial.
3. Recordatorios 24h/2h y excepción nocturna desactivable de evento propio/asignado: confirmar cadencia/horario.
4. Antes de activar incidencias: responsable y canal independiente, sin asignar a otra persona por suposición.

## Referencias técnicas

Expo Push: https://docs.expo.dev/push-notifications/sending-notifications/
SDK 54: https://docs.expo.dev/versions/v54.0.0/sdk/notifications/
Apple 4.5.4: https://developer.apple.com/app-store/review/guidelines/
Resend: https://resend.com/docs/dashboard/emails/idempotency-keys
Supabase Cron: https://supabase.com/docs/guides/cron

Revalidar APIs y changelogs antes de implementar. Horarios, umbrales y retenciones anteriores son propuestas de producto, no requisitos de proveedor ni asesoramiento legal.
