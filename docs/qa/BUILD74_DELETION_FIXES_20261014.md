# Eclipse 74: correcciones de borrado, registro y candidatos

Revisión del 14 de octubre de 2026 (Madrid). Base exacta: `c1daf15f4bc4150694e6d4f2e39d6602751954df`. Rama: `codex/build74-deletion-safety`. No declara apta la app para publicación comercial.

## Cambios y estado

| Punto del informe | Corrección | Estado real |
|---|---|---|
| 3 — cuenta y suscripción | Incorporado el servicio desplegado y su helper. Antes de purgar, verifica cliente, organizador, producto y modo test/live; confirma cancelación con límites de espera. Cualquier error al consultar facturación bloquea el borrado, incluso si falta la tabla. Acepta claves restringidas del modo correcto. | `delete-account` v16 ACTIVE en staging, JWT exigido. Ambos archivos descargados después del despliegue coinciden con los locales. Producción sin cambios. |
| 4 — evento con compras | Trigger privado y relaciones `ON DELETE RESTRICT` conservan entradas y pagos; incluyen pagos pendientes y compras gratuitas/devueltas. El borrador sin historial sigue siendo eliminable. App y servidor muestran el bloqueo y no simulan éxito si no se eliminó ninguna fila. | Migración `20261013224156_protect_event_purchase_history.sql` aplicada en staging. Mensajes de app y servidor preparados en esta rama. No es un recorrido completo de cancelación/devolución. |
| 5 — espacios del correo | Formulario y envío comparten validación sobre correo recortado y en minúsculas; se rechazan espacios interiores. El rechazo de correo ya registrado sigue activo. | Código y prueba del formulario real aprobados; necesita nueva compilación/actualización para llegar al dispositivo. |
| 6 — iOS/Android | El workflow de EAS admite `all` + `testflight`: genera iOS TestFlight y Android preview desde el mismo commit, guarda identificadores y origen. `all` + `production` conserva ambos candidatos comerciales. | Preparado; no se han generado nuevos binarios en este trabajo. La aceptación en ambos sistemas y producción sigue pendiente. |

## Pruebas realizadas

- App: 334 pruebas aprobadas y una omitida preexistente; 37 suites aprobadas. Incluye formulario completo, normalización, rechazo de correo ya registrado, titularidad de suscripción, modo incorrecto, caída de Stripe, cancelación no confirmada, respuesta perdida y reintento.
- Servidor: 98 pruebas aprobadas. Incluye 17 comprobaciones de migración SQL (contando el grupo), cinco del servicio de borrado y regresiones de pagos/devoluciones existentes. La primera ejecución tuvo siete errores de permisos para localhost; la repetición con acceso a localhost aprobó las 98.
- TypeScript aprobado. Lint de los archivos TypeScript modificados aprobado, sin avisos. Cobertura configurada de `notificationSchema.ts`: 100% en líneas, ramas, funciones y sentencias.
- Entorno: 24 pruebas aprobadas. Dependencias: los cuatro fallos iniciales de `proxy-addr` corresponden a la instalación local 2.0.7, mientras ambos lockfiles ya fijan 2.0.8. En una carpeta aislada, con `proxy-addr@2.0.8` y `shell-quote@1.12.0` fijados en el proyecto, aprueban los 11 controles. La instalación compartida no se ha alterado. CI debe confirmar la instalación completa y limpia del candidato.
- Staging: ensayo transaccional con evento/entrada de prueba y borrador vacío. El primero rechaza DELETE con `PT409`, conserva la entrada y el evento; el segundo se elimina. Todo el ensayo se revierte con ROLLBACK. Recuentos finales iguales a los iniciales: 1.021 eventos, 40 entradas, 92 pagos. Ninguna compra real afectada.
- Staging: relaciones de `public.tickets` y `public.payment_transactions` confirmadas con borrado restringido. Trigger propiedad de `postgres`, SECURITY DEFINER, `search_path` vacío; ejecución directa revocada a `anon` y `authenticated`. Los asesores de seguridad no añaden hallazgos frente a la consulta anterior.
- Staging: petición sin sesión a `delete-account` devuelve 401. No se ha borrado una cuenta, cancelado una suscripción ni enviado una devolución real. Fallos y demoras de Stripe se han probado con respuestas simuladas, no provocando una caída del proveedor.

## Límites y aceptación pendiente

1. QA-290–293: realizar el recorrido autenticado completo con cuentas y suscripciones TEST desechables, incluidos Stripe disponible, error, demora y reintento; verificar que el usuario no desaparece si la cancelación no se confirma. También comprobar usuario sin suscripción.
2. QA-111, QA-275 y QA-279: comprobar el mensaje en ambos móviles, comprador que conserva entrada/historial, intento de borrado por otro organizador, carrera entre compra y borrado y conciliación. El bloqueo protege datos; no cancela el evento, no devuelve dinero ni envía avisos de cancelación.
3. QA-261: pegar correo nuevo con espacios externos en iOS y Android; comprobar envío normalizado y correo duplicado rechazado. Mantener también pruebas de mayúsculas, espacios interiores, confirmación y recuperación.
4. QA-302–319: compilar desde el commit final, registrar IDs iOS/Android, versión, entorno, OTA, servidor, funciones y esquema; instalar ambos y completar aceptación. iOS 74 es staging; Android observado sigue en versionCode 7, commit `cccd8d2c6d13827388a631fc62e755b67db68923`. No quedan certificados por estos cambios.
5. Las claves externas nuevas usan `NOT VALID` para no borrar ni corregir silenciosamente pagos históricos huérfanos. Protegen escrituras nuevas y borrados desde su creación; conciliar el historial antes de ejecutar VALIDATE. El trigger bloquea también entradas gratuitas, devueltas y pagos fallidos para preservar trazabilidad.
6. Revisar/aplicar la migración y la función en producción en el despliegue coordinado del candidato. No ejecutar indiscriminadamente el historial completo de migraciones. Los seis bloqueos del lanzamiento permanecen abiertos.

## Comisión y presentación al organizador

Código revisado: `create-payment-intent-v2`, `stripe-get-account-stats` y pantalla del organizador. Ejemplo confirmado en una compra de pruebas: entrada de 20,00 €, cargo de servicio al comprador de 0,56 €, total de 20,56 €, comisión Eclipse de 2,00 € y destino organizador de 18,00 €.

La comisión ordinaria predeterminada es 10% (configurable); las mesas VIP usan 5% con máximo de 25 €. Los cálculos se aplican al precio después del descuento cuando procede. `application_fee_amount` agrupa comisión Eclipse y cargo de servicio: 2,56 € en el ejemplo. Stripe descuenta sus gastos reales del saldo de la plataforma; por tanto 2,56 € no es beneficio de Eclipse. El cargo de servicio es un cálculo de la app, no una lectura de la tarifa final de cada tarjeta.

La plataforma puede consultar las application fees en [Comisiones recaudadas de Stripe](https://dashboard.stripe.com/connect/application_fees), seleccionando pruebas o real. El organizador dispone de cuenta Express; Stripe documenta la visibilidad del importe y la application fee en el Dashboard conectado. Eclipse muestra saldo disponible y pendiente, y las ventas en otra sección. La app todavía no ofrece un desglose explícito por operación de bruto, comisión y neto. No confundir saldo Stripe con abono ya recibido en banco; el abono depende del calendario y estado de la cuenta.

No se han cambiado tarifas. No se han activado devoluciones automáticas por cancelación. Hace falta acordar el tratamiento del cargo de servicio, comisión, costes de Stripe y fondos ya abonados al organizador. Con destination charges, una devolución y la recuperación del dinero transferido al organizador son operaciones que deben coordinarse; conservar compras y estados permite reintentar y conciliar sin duplicar.

Fuentes oficiales: [destination charges](https://docs.stripe.com/connect/destination-charges), [comisiones de marketplace](https://docs.stripe.com/connect/marketplace/tasks/app-fees), [devoluciones y disputas](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes).
