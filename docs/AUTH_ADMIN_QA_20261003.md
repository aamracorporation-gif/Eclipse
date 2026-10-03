# Registro y administración — 3 octubre 2026

## Implementado
- Android: selector de nacimiento con ruedas de día/mes/año y botones Aceptar/Cancelar para asistente y responsable del local.
- Icono de cierre de sesión de verificación centrado sin el padding interno que lo recortaba.
- Administradores van al panel, no a la verificación de organizadores. El rol procede de profiles; los metadatos editables del usuario no autorizan vistas administrativas.
- Navegación administrativa: resumen, usuarios/verificación, eventos, entradas y perfil con últimas 25 acciones.
- Métricas de entradas calculadas en SQL desde compras pagadas de los últimos 30 días. El importe es el de entradas, no beneficio ni liquidación de Stripe. Los errores se muestran, no se sustituyen por ceros.
- Invalidación de entradas exige motivo, comprueba administrador activo, guarda auditoría, no borra compras ni reactiva usadas. No equivale a reembolso.
- Reventa y monedero siguen desactivados.
- AuthContext usa el puente HTTPS del backend cuando no existe override explícito.
- Puente de autenticación compatible con CSP de Helmet mediante script externo, preservando query/hash y recovery; sin códigos en access logs y con no-referrer.
- Plantilla de confirmación en supabase/templates/confirmation.html, botón en español sin URL larga visible.

## Verificación ejecutada
- TypeScript sin errores.
- 108 tests de app correctos; 1 test previamente omitido.
- 54 tests de backend correctos, incluidos CSP, parámetros del enlace y recovery.
- Pruebas SQL en staging, con rollback: acceso denegado a asistentes/anónimos/admin suspendido, métricas, motivo obligatorio, invalidación, idempotencia de auditoría, rechazo de entradas usadas.
- Migraciones admin_launch_controls y admin_ticket_payment_guard aplicadas solo en staging.

## Configuración que requiere sesión del dashboard
La sesión web de Supabase caducó. No se han podido leer ni guardar aún las URLs y la plantilla alojadas.
- Site URL de staging: https://eclipse-staging-staging.up.railway.app/auth/verify
- Redirect URLs exactas: esa misma URL, https://eclipse-staging-staging.up.railway.app/auth/reset-password, eclipse://auth/callback, eclipse://auth/reset-password.
- Plantilla Confirm signup: archivo HTML; asunto «Confirma tu cuenta Eclipse».
- Mantener ConfirmationURL para la verificación de Supabase y su retorno al puente.

No se ha promovido ninguna cuenta real a administrador. Hace falta identificar y autorizar la cuenta concreta. Las pruebas de rol se revirtieron completamente.

## Pendiente antes de declarar lanzamiento listo
- Guardar configuración anterior, probar correo real en Android/iOS y enlace caducado/reenvío.
- Desplegar backend actualizado y compilar una versión nueva con estos cambios.
- QA visual en dispositivos: selector de año, teclado, icono y navegación de administrador. Las pruebas de código no sustituyen esta revisión.
- Validación funcional con cuenta administrativa autorizada (aprobar/corregir organizador, gestión de eventos, entradas y auditoría).

## Seguimiento: compilación limpia y enlaces de un solo uso
- CI #97 falló en TypeScript: `startOnYearSelection` no existe en datetimepicker 8.4.4 instalado por `npm ci`. La copia de node_modules del repositorio no era una prueba fiable de esa API.
- Se sustituye esa propiedad por `display="spinner"`, compatible con la versión fijada y con selección directa del año.
- El listener global ahora dirige el enlace a su pantalla; no consume OTP/PKCE en paralelo con la pantalla de callback.
- Callback comparte el resultado de un intercambio entre repeticiones del efecto, mantiene errores de enlaces caducados y admite un enlace nuevo. Un enlace nuevo no hereda credenciales del arranque anterior.
- Recovery se deriva a su pantalla antes de consumir sus credenciales.
- Verificación local tras `npm ci --ignore-scripts`: TypeScript y lint correctos; 110 pruebas app correctas y 1 omitida. Runtime local Node 24; CI utiliza Node 22.
- No se han cambiado las URLs ni la plantilla alojadas en Supabase. El correo real y la revisión física Android/iOS siguen pendientes.
