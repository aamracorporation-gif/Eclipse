# Eclipse — candidata integrada de staging, 8 octubre 2026

## Estado
PR #35, rama `codex/staging-release-candidate-20261008`, basada en #34 y por tanto en #33 / #32 / #30 / #28. No se ha fusionado en main ni cambiado producción. El código de aplicación de esta candidata es el mismo que el de b089cffb029bb3deb2626dcf9cdf04a996d979d7; el trabajo de esta fase consiste en desplegar el descuento revisado, verificar staging y preparar la siguiente compilación.

**Descuentos: migración y función de pago ya desplegadas en staging. Builds nativas: no generadas ni puestas en cola, bloqueadas por EXPO_TOKEN ausente en GitHub. Notificaciones: servidor preparado, envío y captura apagados; piloto pendiente.**

## Cambios efectivos de descuentos
Proyecto exclusivo: `uhondxttdpvywvkyqlkk` (Eclipse Staging).

Se aplicó únicamente el contenido revisado de `20261006212917_discount_product_scope.sql`, registrado por el gestor como `20261008012459_discount_product_scope`. No se reejecutó la cadena histórica, no se renumeró el historial y no se modificaron migraciones previas. Se añadieron antes del SQL un lock_timeout de 5 segundos, un control de puertas de notificación cerradas y comprobaciones de hash de las tres funciones de fulfillment existentes.

Los campos `applicability`, `ticket_type_ids` y `vip_reservado_ids` ya existen. El único código preexistente conserva alcance `tickets` y selecciones vacías. Se verificaron los cuerpos de las cinco funciones nuevas/reemplazadas contra el archivo revisado:

| Función | MD5 de prosrc verificado |
|---|---|
| private.enforce_discount_product_scope | 6a5b1a7f4d029c46102fb6cdfbfb862e |
| private.discount_rule_error | 2a372ba359b9b4bcca1249d75c49da7d |
| public.validate_discount_code_for_product | 41c163f19f18dc8610aaf00012c5404f |
| public.validate_discount_code | a01fb951dca19bc8423820d87eec03ef |
| private.payment_discount_failure | 37b3cc581ac0ebf07db43d3b65b503da |

Se desplegó `create-payment-intent-v2` **versión 17**, ACTIVE, con `verify_jwt=true` y sus tres imports relativos. Digest del bundle: `c236782edb5acbc51eb01d4771e4e5a87eaea50268aecd7b791bc6e51691f0b8`. La lectura posterior confirmó el validador de descuentos por producto y el cálculo VIP sobre el precio descontado. No se desplegó ni alteró ningún generador Wallet, webhook Stripe o worker de notificaciones en esta fase.

Fuente revisada: artefacto 11517149141 de la regresión 37700982575; SHA-256 ZIP `227d1d33856de5002880fa1e02d640ebd89f88f309604df944955903f77b6b73`. Los 659 hashes del manifiesto se verificaron en el contenedor. El blob del handler coincide con el leído en la candidata: `347054f04b6c44767016f096020dfb1be5e0abd9`.

## Pruebas realizadas
- CI #129, ejecución 37712706747, pasó completamente en f44d1efd0d36ef3ed683109d9eb5087252a4087b: quality y secret-scan, TypeScript, lint, pruebas de app, Wallet, bundle web, backend y controles de dependencias. No es una build nativa.
- **32 comprobaciones** en la base de datos efectiva de staging, con escrituras revertidas: compatibilidad de códigos antiguos, alcance de entradas/VIP, selección vacía, catálogo incorrecto, evento ajeno, permisos de creación, RPC con rol authenticated, denegación anónima, límites de unidades, caducidad/activación/usos, importe porcentual, importe manipulado, fijo limitado al subtotal y rutas sin descuento.
- El script `scripts/qa/discount-staging-candidate-smoke.sql` no debe confundirse con el fixture desechable de CI. Solo crea un cupón temporal sobre catálogo existente, con subtransacción y ROLLBACK. Los contextos JWT/rol son simulados para probar permisos de base de datos; no son una sesión física del móvil ni llamadas a Stripe.
- Las funciones privadas de fulfillment siguen sin EXECUTE para clientes. La validación pública de código requiere autenticación.
- POST sin autenticación a la función de pago y al dispatcher de notificaciones devolvieron **401 UNAUTHORIZED_NO_AUTH_HEADER**; no demuestran llamadas autenticadas ni entrega por proveedores.
- Tras el rollback: 1 código original, 0 cupones RC_QA, 16 entradas, 19 transacciones, 17 entregas antiguas y 0 entregas nuevas. No se cambiaron compras o balances ni se emitieron avisos.

## Compilación: bloqueo comprobado, no supuesto
El preflight de GitHub **37712688473**, ejecutado en el entorno `staging`, produjo solo booleanos:

```json
{"EXPO_TOKEN":false,"SUPABASE_ACCESS_TOKEN":false,"SUPABASE_DB_PASSWORD":false,"stagingProjectRef":"not_set"}
```

El paso de autenticación Expo se omitió por ausencia de token. Por ello **no se inició ninguna compilación Android/iOS ni envío a Apple**. El acceso MCP a Supabase sí permitió los cambios anteriores y no necesita que el usuario copie una clave Supabase al chat. Las otras ausencias de GitHub no deben confundirse con que falten los secretos de las funciones desplegadas.

El preflight temporal ya se elimina del árbol final; su reporte y registro permanecen en la ejecución indicada. No se introduce automatización recurrente. Para desbloquear compilación, guardar un token de la cuenta con acceso al proyecto Expo como secreto `EXPO_TOKEN` en GitHub, entorno staging o repositorio. Nunca pegarlo en chat, código o una variable EXPO_PUBLIC_.

Tras verificar el acceso, comprobar las variables remotas del entorno Expo `preview`, el proyecto `42ebb6eb-62b1-4784-a483-831ae3c804f2` y las credenciales de firma. Usar el mismo commit para Android perfil `preview` (APK) e iOS perfil `testflight` (store sobre staging); no usar perfil production. El número lo determina EAS. `--no-wait` solo confirma cola, no compilación terminada. El envío a TestFlight debe referirse a la build iOS que realmente finalice, no a latest sin verificar su commit.

## Notificaciones: estado comprobado y siguiente puerta
`capture_enabled=false`, `operations_enabled=false`, `live_delivery_enabled=false`, `allow_all_recipients=false`, allowed_recipients vacío, 0 instalaciones y 0 cron jobs. Las 17 entregas antiguas no se han procesado ni copiado a v2. La inspección de nombres relevantes de Vault no encontró una credencial guardada para invocar automáticamente el worker; no se leyeron valores secretos.

La disponibilidad real de credenciales Expo/APNs/FCM y Resend en runtime **todavía no está verificada**. El conector instalado no expone los secretos de Edge y el usuario no ha identificado una cuenta de app para el piloto. No se habilitan rutas de diagnóstico sin autenticación para sortearlo.

Configuración requerida por el código ya existente:
- `NOTIFICATIONS_EXPO_PROJECT_ID` del proyecto Expo indicado arriba.
- `RESEND_API_KEY` y `NOTIFICATIONS_FROM_EMAIL` con remitente verificado.
- `EXPO_ACCESS_TOKEN` solo si está activada la seguridad adicional del servicio push.
- Mantener `NOTIFICATIONS_V2_SEND_ENABLED` desactivado hasta verificar destinatarios, dispositivos y configuración; es distinto de EXPO_TOKEN de GitHub.

El piloto requiere autorizar la cuenta exacta, instalar la candidata y registrar su dispositivo. Después probar ejecución autenticada, programar el procesamiento del servidor con credencial guardada de forma segura y activar únicamente esa audiencia. No activar allow_all ni producción. Primero una compra de prueba -> entrada -> aviso -> apertura correcta; después VIP, gratuito, descuento, reintento y devolución, y estados abierta/segundo plano/cerrada/permisos/cambio de cuenta.

## Límites y revisión de seguridad
No se hicieron cobros, reembolsos de proveedor, envíos, pruebas físicas, builds nativas ni cambios en producción. El escenario de pago autenticado con descuento y posterior devolución sigue pendiente; las pruebas SQL y el CI no lo sustituyen. Los formularios nuevos requieren una app que incluya esta candidata.

Advisors de staging revisados después de la migración: 30 avisos de funciones SECURITY DEFINER accesibles a usuarios autenticados, aviso de pg_net y protección de contraseñas filtradas, y 18 INFO de tablas RLS sin políticas. La nueva validación sustituye al wrapper antiguo como función privilegiada; las pruebas negativas verifican sus límites, no una aprobación global del proyecto. Las tablas privadas sin políticas se mantienen cerradas, no se añaden políticas permisivas para silenciar avisos.

Referencias oficiales: https://docs.expo.dev/build/building-on-ci/ ; https://docs.expo.dev/push-notifications/push-notifications-setup/ ; https://supabase.com/docs/guides/functions/secrets/ ; https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable ; https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection .
