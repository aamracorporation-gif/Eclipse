# Publicación · 20/10/2026
Preparación comprobada y configuración Railway pendiente de aplicar. Publicación y TestFlight aún pendientes. La sustitución del servicio está autorizada; queda pendiente consentimiento explícito para publicar código en el repositorio GitHub público.

## Destinos existentes
Railway: Eclipse 806d62be-6671-40d3-9a3e-d25c07c5cb05; servicio 1097f683-8e92-4859-a80b-a50b169080da; entorno 8e9dc89a-5e5e-457d-b11c-d3df0df7cf6f. Puerto 8080, https://api.weareeclipseoficial.com.
Supabase: AppFest / zurbdrfmwjqbrscairub, esquema rondiqo.
Expo: @ashhhhhhhh/Eclipse / 42ebb6eb-62b1-4784-a483-831ae3c804f2.
Apple: com.achraf.eclipse, App Store Connect 6773071994. Último build observado 77 (Eclipse anterior). Propuesta 1.1.0 (78). No enviar el build antiguo.

## Despliegue beta
1. Verificar resolución de https://status.railway.com/incident/JUA1PC5H. Resuelta el 20/10 a las 20:56 UTC; no se ha activado ningún despliegue de RONDIQO.
2. Revalidar presupuesto sin ampliar plan/recursos/réplicas. Railway mostró $2.06 de uso y $20 incluidos; no garantiza coste futuro.
3. Construir/probar Dockerfile y revisar paquete de código. Servidor mínimo e imagen Linux construidos y probados localmente; la prueba del contenedor se realizó sin red externa y con usuario sin privilegios.
4. Configurar release.env.example en el servicio existente. Credenciales únicamente en gestor de secretos. Conservar configuración anterior cifrada para rollback. No enviar secretos a Git/app/ZIP/chat.
5. Configurar confirmación de correo y redirecciones exactas /login y /reset-password. Plantilla de recuperación: email-recovery-template.html, con {{.Token}}. Verificar alta real, confirmación, recuperación, caducidad y revocación. Auth comparte proyecto con Eclipse: conservar sus redirecciones necesarias.
6. Publicar primero beta con Supabase Auth, pagos simulados y DEMO_ACCESS=false. Los datos del piloto siguen siendo ficticios; cuentas .test bloqueadas.
7. Verificar HTTPS, /api/health, sesión real, permisos, inscripción, QR y correo desde fuera del ordenador. Monitorizar errores entre ambas réplicas.

El historial original incluye artefactos y material de firma antiguos. No publicar todo ese historial ni copiar credenciales. Revisar/rotar certificados potencialmente expuestos con el titular. No se han revocado certificados ni enviado código al remoto.

## Pagos reales
Solo se dispone de conexión Eclipse Staging en modo de prueba. No se han encontrado credenciales live utilizables ni ejecutado transacciones.
Identificar plataforma/responsable live, aprobar comisión (500 bps es ejemplo), reembolsos y responsabilidades de destination charges antes de activar.
Preparar clave restringida y secreto webhook separados de sandbox. Permisos necesarios: Checkout, lectura de cuentas/cobros y creación/lectura de reembolsos. Nunca enviar claves al cliente.
Endpoint /api/webhook. Eventos: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired y charge.refunded.
La administración vincula cuentas Stripe YA conectadas, con reautenticación y verificación. No crea cuentas ni acepta acuerdos financieros.
Validar sandbox real: Checkout/Connect, éxito, fallo, cancelación, duplicados, firma, cierre y reembolsos. Las pruebas incluidas usan simulaciones/firmas locales y no sustituyen la integración con el proveedor.
Producción requiere correo verificado operativamente, URLs HTTPS reales de legal/soporte, ausencia de perfiles .test y credenciales locales, y las variables de activación de release.env.example. No rellenar indicadores approved/verified sin realizar las comprobaciones.
No efectuar cobros de validación sin autorización para posibles comisiones.

## TestFlight
1. Backend beta HTTPS operativo y cuenta real de prueba con correo confirmado.
2. Sesión Apple verificada. Certificado y perfil remotos existentes activos hasta 03/06/2027. Clave de envío existente. Último build Apple observado: 77; se propone 78. No se crearon credenciales ni se aceptaron acuerdos.
3. Crédito Expo verificado: Starter existente, $11 usados de $45, $34 disponibles. Las cuatro compilaciones iOS suman $8; cada m-medium cuesta $2 según documentación oficial. No se han iniciado builds. Revalidar antes de compilar si cambia el período o hay otros usos. https://docs.expo.dev/billing/usage-based-pricing/
4. Variables locales: EAS_REUSE_ECLIPSE=true, EXPO_PUBLIC_API_URL=https://api.weareeclipseoficial.com, EXPO_PUBLIC_RELEASE_MODE=beta.
5. Ejecutar node scripts/verify-native-release.cjs ANTES del build remoto. Ahora falla: el backend no es RONDIQO.
6. Revisar archivo EAS (.easignore), guardar commit y usar npx eas-cli@25.3.0 build --platform ios --profile testflight. Solo firma existente verificada. No se ha iniciado este paso.
7. Enviar el ID de ese build: npx eas-cli@25.3.0 submit --platform ios --profile testflight --id ID_DEL_BUILD_RONDIQO. No usar --latest sin verificar identidad y versión.
8. Verificar procesamiento y disponibilidad en TestFlight; completar información beta, privacidad, contacto y cifrado estándar HTTPS. Solicitar envío no equivale a publicación.
9. Probar iPhone: acceso/recuperación, espacios, equipo, calendario, cámara/QR, Checkout sandbox y retorno. No se ha realizado esta prueba.
No se han enviado invitaciones ni publicado enlaces de beta.

## Operación
Antes de producción: copia y prueba de restauración local, inventario de demostraciones y retirada planificada, monitorización y soporte real. No borrar datos automáticamente.
Rollback: restaurar código/configuración revisados anteriores; no DROP de tablas ni reversión de pagos.
Reembolsos: conciliación cada minuto con idempotencia. Un failed requiere revisar Stripe; no crear otro a ciegas.
Eliminación: solicitud autenticada, acceso suspendido, resolver pagos/participaciones/propiedad de clubes, aplicar retención y borrar/anonimizar datos que corresponda. Comprobar también Auth y legado compartido, registrar finalización y comunicar plazo/resultado por canal acordado. El código registra y suspende, no realiza todo ese proceso.
Revisar avisos heredados Supabase; las funciones muestreadas comprueban identidad/propietario, pero no se auditó todo el legado. No mover pg_net ni revocar todas las funciones a ciegas. Protección de contraseñas filtradas desactivada: comprobar disponibilidad en plan existente sin contratar.
Mitigaciones braces/node-forge: scripts/patch-build-tools.cjs exige versiones exactas y falla ante estructura inesperada. Retirar tras parche oficial revisado. Auditoría servidor 0; compilación 19 altas transitivas de 2 avisos sin parche.

## Preparación comprobada de esta continuación
- Código local: 42 pruebas correctas tras fijar la URL beta en EAS y aislar RONDIQO_AUTH_URL / RONDIQO_AUTH_PUBLISHABLE_KEY.
- Archivo EAS inspeccionado localmente: 161 archivos, sin Git ni patrones de credenciales detectados. No es una compilación firmada.
- Railway: 14 variables de RONDIQO y 7 ajustes de arranque preparados; sin aplicar ni desplegar. Las variables antiguas permanecen disponibles para reversión.
- DATABASE_URL transferida mediante canal privado en memoria al panel Railway, sin stdout ni archivo plano. Un intento anterior de usar stdout fue bloqueado antes de ejecutarse.
- Publicar el árbol de código en GitHub fue rechazado por revisión automática porque Eclipse es público; la autorización de despliegue no incluía exposición pública explícita. Esperar respuesta al consentimiento solicitado. No rodear el bloqueo con otra vía de publicación pública.
- SMTP Resend ya configurado. Redirección HTTPS existente cubre /login y /reset-password. Plantilla antigua de recuperación usa TokenHash y no incluye el código Token: adaptar antes de verificar la recuperación. Copia local anterior en work, fuera del paquete público.
