# Publicación · 20/10/2026

Beta publicada y verificada: https://api.weareeclipseoficial.com. El titular confirma acceso correcto con una cuenta real. Pagos simulados. Consultar ../evidence/status.json para el estado actualizado de iOS y TestFlight.

## Destinos existentes
- Railway: proyecto 806d62be-6671-40d3-9a3e-d25c07c5cb05; servicio 1097f683-8e92-4859-a80b-a50b169080da; entorno 8e9dc89a-5e5e-457d-b11c-d3df0df7cf6f. Puerto 8080.
- Supabase: AppFest / zurbdrfmwjqbrscairub, esquema rondiqo, 17 tablas. Rol exclusivo; dos conexiones por réplica, límite total cinco.
- Expo: @ashhhhhhhh/Eclipse / 42ebb6eb-62b1-4784-a483-831ae3c804f2.
- Apple: com.achraf.eclipse, App Store Connect 6773071994. Nueva RONDIQO 1.1.0 (78); la anterior 1.0.0 (77) es Eclipse, no reenviarla.
- GitHub: https://github.com/aamracorporation-gif/Eclipse/tree/rondiqo/beta-release. Código público expresamente autorizado.

## Despliegue comprobado
Railway 6d3f5f83-e1ec-42a4-9703-f8c66db35aac: SUCCESS, 20/10/2026 21:42 UTC. Fuente fijada a 29a58f5be9ed9c33446016367971bf0e747eb288. Se conservaron las dos regiones/réplicas, planes, variables antiguas y recursos existentes.
RELEASE_MODE=beta, AUTH_MODE=supabase, PAYMENT_MODE=simulated, DEMO_ACCESS=false. RONDIQO_AUTH_URL y RONDIQO_AUTH_PUBLISHABLE_KEY aíslan la configuración nueva. DATABASE_URL transferida en memoria por canal privado a Railway, nunca a código, ZIP, chat o stdout.
Verificados por HTTPS: /api/health identifica RONDIQO, AppFest, beta, Supabase Auth y pagos simulados; interfaz, nonce CSP, HSTS, consulta pública restringida, demos rechazadas y origen ajeno rechazado. Portada y catálogo sin errores de consola. Evidencia: ../evidence/public-beta-check.json. El titular confirmó acceso correcto sin compartir contraseña ni códigos.
SMTP Resend existente configurado. Confirmación usa ConfirmationURL del proveedor; recuperación muestra Token y dirige a /reset-password. Plantillas adaptadas y persistidas. Conservar las redirecciones del proyecto compartido. Recepción real, recuperación completa, caducidad y revocación por correo pendientes de comprobar.
No mantener el servidor local conectado a AppFest junto a las dos réplicas salvo mantenimiento planificado: el rol admite cinco conexiones. La instancia local se detuvo tras verificar la beta.

## iPhone y TestFlight
Firma/perfil remotos existentes activos hasta 03/06/2027; clave de envío existente. Sin nuevas credenciales ni acuerdos aceptados. Build completado y enviado e45415e5-dd49-4031-bbbb-c6f0dccdcf80, 1.1.0 (78), commit local 920960f80be52e4da272e69be69a3dddab7275cf.
Antes de iniciar: 34 USD disponibles de 45 USD incluidos en Starter. iOS m-medium consume 2 USD del crédito según https://docs.expo.dev/billing/usage-based-pricing/. Sin cambios de plan. Revalidar antes de nuevos builds.
Perfil testflight: EAS_REUSE_ECLIPSE=true, EXPO_PUBLIC_API_URL=https://api.weareeclipseoficial.com, EXPO_PUBLIC_RELEASE_MODE=beta. scripts/verify-native-release.cjs pasa contra el servidor público. Archivo EAS inspeccionado sin Git ni credenciales privadas detectadas.
Enviar solo el ID de RONDIQO comprobado: eas-cli@25.3.0 submit --platform ios --profile testflight --id ID. No usar --latest sin comprobar identidad. Solicitud de envío, procesamiento Apple y disponibilidad para instalar son estados distintos: registrar cada uno.
Probar en iPhone: acceso/recuperación, espacios, equipo, calendario, cámara/QR, inscripción, cierre de sesión y retorno de Checkout sandbox. No hay prueba física realizada por el agente. No añadir testers ni enviar nuevas invitaciones sin solicitud del titular.

## Pagos reales
Checkout/Connect, firmas, aislamiento test/live, cuentas verificadas, idempotencia, conciliación y reembolsos implementados. Solo conexión Stripe Staging disponible; sin credenciales live ni validación completa con el proveedor. Pruebas actuales con simulaciones y firmas locales.
Identificar responsable/plataforma live, comisión, reembolsos y responsabilidades de destination charges. 500 bps es ejemplo. La administración vincula cuentas ya conectadas con reautenticación y verificación; no abre cuentas financieras ni acepta acuerdos.
Configurar clave restringida y secreto webhook separados en el servidor. Permisos mínimos: Checkout, lectura de cuentas/cobros, creación/lectura de reembolsos. Endpoint /api/webhook, eventos checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired y charge.refunded.
Validar sandbox real: éxito, fallo, cancelación, duplicados, firma, cobro tardío, cierre, reembolso parcial y total. No hacer cobros con posibles comisiones sin autorización. No activar live porque pasen pruebas simuladas.

## Requisitos comerciales y operación
Correo verificado operativamente, pruebas físicas, identidad/condiciones/privacidad/soporte definitivos, disponibilidad de marca, retirada planificada de datos ficticios, copias/restauración, monitorización y avisos heredados. Producción rechaza perfiles .test y credenciales locales. No falsear indicadores approved/verified de release.env.example.
Auditoría servidor: 0 vulnerabilidades conocidas. Compilación: 19 altas transitivas de dos avisos sin parche oficial. scripts/patch-build-tools.cjs exige versiones exactas y aplica mitigaciones probadas; retirar tras parche oficial revisado.
Supabase conserva avisos del legado public y protección de contraseñas filtradas desactivada; sin hallazgos del asesor sobre rondiqo. No mover pg_net ni revocar funciones indiscriminadamente. Historial público original contiene material de firma Android antiguo: revisar con el titular y rotar lo necesario de forma planificada. La rama nueva no lo incluye; no se revocaron certificados.
Eliminación: solicitud autenticada, suspensión y cierre de sesiones; tramitar pagos, participaciones, clubes, retención y borrado/anonimización incluyendo Auth y legado compartido. Registrar resultado. La cola no automatiza todo ese proceso.
Reembolsos: conciliación cada minuto con idempotencia; investigar los fallidos, no crear otro a ciegas.

## Reversión y costes
Despliegue anterior: 6522af28-0ca3-42d2-8f94-ef3deab62f59. Restaurar código/configuración anteriores revisados; no DROP de tablas ni reversión automática de pagos. Copia sin secretos en work/railway-before-rondiqo.json, fuera de la entrega.
No se contrataron servicios, compraron recursos, cambiaron planes, crearon proyectos remotos ni cobraron pagos reales. Railway mostraba 2,06 USD de uso de 20 USD incluidos antes de desplegar. Son límites del ciclo observado, no garantía de uso gratuito ilimitado. Revisar consumo durante la beta.

## Resultado TestFlight y corrección de registro
Apple valida 1.1.0 (78), build d03ff8e5-10ce-4bd4-8aa4-e3e8d64c9fe5. Grupo interno existente Eclipse Team asociado automáticamente. Indicaciones guardadas. Apple muestra la instalación de esta versión por el titular. Sin nuevos testers ni invitaciones manuales. No se ha validado un recorrido funcional completo en el dispositivo.
Los intentos de registro consultados eran user_repeated_signup de cuentas Eclipse ya verificadas; el proveedor no envía otra confirmación ni modifica la contraseña. Se corrigió el mensaje del servidor para explicar el acceso y recuperación sin prometer un correo ni revelar la existencia de una cuenta. 43 pruebas pasan. No se ha confirmado manualmente ningún usuario ni desactivado la verificación.
