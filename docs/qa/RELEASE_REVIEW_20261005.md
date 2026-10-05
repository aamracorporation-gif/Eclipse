# Revisión de release63 y Qase — 5 octubre2026

Código de la build: `39ee88dc1c77ca484eaf272f5cc0628be6136d05`. Perfil testflight, entorno preview/staging. Build iOS1.0.0(63): `1de71acf-0aab-40c1-b2f6-98626a0cc67f`.

## Catálogo

Se revisan los 269 casos existentes, 21 suites y 12 planes frente al inventario de 53 rutas y 138 fuentes documentadas. Se conservan las pruebas de características desactivadas para detectar reactivaciones accidentales. No hay títulos duplicados exactos ni casos sin pasos. No se eliminan casos o ejecuciones históricas.

Se corrigen 5 casos: compra VIP, conciliación, venta manual VIP, atomicidad de venta mixta y autorización del checkout público. Se añaden 32 pruebas manuales (QA-260..291): precios y redondeo VIP, tope, capacidad, manipulación, replay histórico, concurrencia, categoría VIP alternativa, ventas manuales idempotentes, configuración por tipo, beneficios, plazo de gratuitas, aprobación admin con consultas tardías, suspensión, retirada de capacidades Stripe, actualización62→63, backend efectivo y accesibilidad móvil.

Los casos nuevos se incorporan a los planes aplicables, incluida regresión completa. Se añade un plan específico VIP. Lectura remota verificada: todos los pasos nuevos y miembros de los planes coinciden. Plan VIP: ID14; regresión completa: ID11. El total verificado es 301 casos (291 manuales + 10 técnicos), 21 suites y 13 planes.

## Evidencia ejecutada

`evidence-20261005/vip-tests.txt`:12/12 pruebas Jest aprobadas sobre el handler real con Auth/DB/Stripe simulados. Verifica9 precios, capacidad/tarifa independiente, estándar sin tope y replay histórico. No es una compra nativa ni una llamada real a Stripe. Los resultados históricos de Qase no se trasladan a esta build.

## Riesgos que impiden declarar el lanzamiento validado

1. **Dos recorridos VIP.** El tope está implementado en `kind=vip_table`. El checkout `event_ticket` no consulta `category` del tipo y calcula comisión general. Un tipo `event_ticket_types.category=vip` creado desde el formulario puede usar ese recorrido. QA-276 exige comprobarlo contra el requisito comercial; si representa un reservado completo debe respetar5%/25EUR. Esto es una discrepancia detectada en fuente, no un flujo nativo ejecutado ni corregido en esta build.
2. **Backend Railway.** La última verificación mantiene el bloqueo de despliegue por facturación. Una build iOS nueva no despliega el middleware REST. QA-290 exige comprobar SHA y entorno efectivos; los flujos dependientes permanecen bloqueados hasta desplegar y revalidar. Las migraciones y Edge de Supabase staging sí se aplicaron previamente.
3. **Dispositivos y servicios reales.** Pendientes los flujos nativos iOS/Android: compra/3DS, Wallet, QR/cámara, enlaces de correo, notificaciones, accesibilidad, permisos y actualización de la app. La existencia del caso no prueba su ejecución ni ausencia de errores.

## Orden recomendado de ejecución

1. Actualizar desde62 a63 y comprobar entorno y backend efectivo (QA-289/290).
2. Resolver y verificar diferencia entre reservado y categoríaVIP (QA-276), luego planVIP completo.
3. Smoke/P0 con cuentas cliente, organizador pendiente/listo, admin y trabajador en dispositivos distintos.
4. Regresión completa por plataforma; registrar build, fixture y evidencia en cada resultado. No cerrar P0 fallidos o bloqueados sin resolver.

La revisión automática rechazó exportar la copia completa del catálogo de Qase a GitHub por posible contenido privado. Esa exportación no se realizó; este informe solo documenta resultados agregados y hallazgos técnicos. Los cambios y el historial de ejecución permanecen en Qase.

## Estado del envío iOS

Build63 compilada con éxito. Submission `a22c869f-c3f0-43b5-8a09-e46c892bcf25` creada automáticamente; última comprobación: `Queued — Free Tier Queue`. La recepción por Apple y disponibilidad en TestFlight aún no están confirmadas. No se ha cambiado el plan de Expo ni contratado prioridad.

https://expo.dev/accounts/ashhhhhhhh/projects/Eclipse/submissions/a22c869f-c3f0-43b5-8a09-e46c892bcf25
