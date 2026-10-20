# RONDIQO · Eclipse adaptado · 0.4
App de pádel y fútbol 7. Rama local rondiqo/deportes del repositorio real Eclipse, basada en 7d1efc1006a815c44dbab1b18c8e24eef5f9b0e0. Código publicado con autorización en aamracorporation-gif/Eclipse, rama rondiqo/beta-release.

## Abrir
Beta publicada: https://api.weareeclipseoficial.com/welcome. El titular confirma acceso correcto con una cuenta real. La instancia local se ha detenido; para desarrollo, reiniciar con ./start-appfest.ps1.
Credencial AppFest cifrada mediante Windows DPAPI en ../../work/appfest-backend.secret, fuera de la entrega.
Cuentas ficticias: organiza@rondiqo.test, jugador@rondiqo.test, capitan@rondiqo.test, arbitro@rondiqo.test, acceso@rondiqo.test, admin@rondiqo.test. Contraseña local: RondaLocal2026!
Estas cuentas no acceden en beta/producción. Los tokens no se comparten entre entornos ni modos de autenticación.
Sin AppFest: Node 24.14.x, npm ci, npm run seed, npm run build:web y npm start (PGlite local). No ejecutar semillas contra datos reales.

## Arquitectura y funciones
Se reutilizan Expo/React Native/Expo Router, grupos de rutas, proveedores Auth/Event/Notification/Filter, ThemedButton/Input, GlassView, AppDialog, campana, gráficos, iconos y diseño adaptable. Se conserva licencia y atribución. El legado de ocio no autoriza operaciones deportivas.
Jugador: registro/acceso, equipos, invitaciones, inscripciones, espera, agenda/ICS, resultados, clasificación y QR.
Organizador: clubes y personal, asistente, borradores con versiones, publicación, inscripciones, cuadros, horarios, resultados y disputas.
Administración: verificación, suspensión, auditoría, conciliación, cuentas Stripe existentes y solicitudes de eliminación.
Pádel por parejas; fútbol 7 con siete miembros como mínimo. Ligas hasta 32 equipos, eliminatorias hasta 128. Revisar horarios generados.

## Seguridad y pagos
AppFest / zurbdrfmwjqbrscairub: esquema rondiqo, 17 tablas RLS, usuario exclusivo y TLS con CA verificada. Pool de dos conexiones por réplica para el límite de cinco. Tres migraciones *_rondiqo_*.sql aplicadas; no ejecutar las migraciones/funciones históricas ni migraciones remotas automáticas.
Sesiones opacas de 12 horas, cookies HttpOnly/Secure/SameSite, SecureStore móvil, revocación al cambiar contraseña, limitación compartida en PostgreSQL, CSP con nonce, HSTS y límites de peticiones.
Supabase Auth preparado para correo confirmado, recuperación por código y usuarios Eclipse con consentimiento. SMTP existente configurado y plantillas RONDIQO guardadas; entrega y recuperación completas pendientes de verificar.
Eliminación: solicitud con contraseña, suspensión y cierre de sesiones inmediato, cola administrativa. El borrado final requiere tramitación.
Stripe Checkout/Connect preparado: importe de servidor, cuentas verificadas, idempotencia, firma de webhooks, separación test/live, conciliación y reembolsos. Reservas impagadas caducan; cobros fuera de plazo se reembolsan. Cobros reales desactivados.

## Verificación
43 pruebas y TypeScript correctos; Expo Doctor 20/20; exportaciones web/Android/iOS correctas. Paquete mínimo instalado por separado y probado por HTTP con base temporal. AppFest: operaciones verificadas en transacción revertida; 26 perfiles y 9 competiciones del piloto conservados.
Auditoría de dependencias del servidor: 0 vulnerabilidades conocidas.
Árbol completo: 19 altas transitivas de dos avisos sin parche oficial (braces/node-forge), 0 críticas/moderadas. scripts/patch-build-tools.cjs aplica mitigaciones deterministas probadas. npm audit sigue mostrando los avisos.
Supabase conserva avisos del esquema public y protección de contraseñas filtradas desactivada; sin hallazgos del asesor sobre rondiqo. No equivale a una auditoría externa completa.

## Publicación
Railway desplegado y verificado por HTTPS. Servicio y planes existentes, AppFest y pagos simulados. Despliegue 6d3f5f83-e1ec-42a4-9703-f8c66db35aac, código 29a58f5be9ed9c33446016367971bf0e747eb288.
RONDIQO 1.1.0 (78) compilada, firmada, subida y validada por Apple; disponible en TestFlight para el grupo interno existente Eclipse Team. Apple informa que el titular ya la ha instalado. No equivale a verificar todos los flujos en un iPhone. Se reutilizan com.achraf.eclipse y App Store Connect 6773071994.
Una compilación o exportación no sustituye una prueba en iPhone. Imagen Linux probada sin red externa y con usuario sin privilegios; web pública también verificada.
Consultar [procedimiento de publicación](deploy/RELEASE.md).
Pendiente: correo, Stripe live y prueba integral, condiciones/privacidad/soporte, retirada planificada de demostraciones, restauración, monitorización, revisión del legado, marca y dispositivos.
No se han contratado servicios, realizado cobros, contactado clubes ni creado nuevos proyectos remotos.
