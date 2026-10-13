# Eclipse 74: análisis y plan de aceptación

Revisión del 13 de octubre de 2026. **No dar por apta para publicación comercial todavía.** Hay evidencia de compilación y pruebas automáticas, pero falta la aceptación en dispositivos y alinear el candidato con los servicios que se publicarán.

El plan entregado contiene **319 casos, 171 P0**, con preparación, pasos, resultado esperado, estado por iOS/Android/servidor y campo de evidencia. Parte del catálogo de 259 casos del 04/10, conserva sus identificadores y añade 60 comprobaciones dirigidas al código de la 74 y al lanzamiento. QA-006 se eleva a P0. Los solapamientos con el catálogo base son regresiones más específicas. Todos los resultados aplicables de esta nueva ejecución están pendientes.

## Qué se ha comprobado

| Elemento | Evidencia y límite |
|---|---|
| iOS 74 | Versión 1.0.0, commit `c1daf15f4bc4150694e6d4f2e39d6602751954df`, perfil `testflight`, canal **staging**, compilación y envío terminados. No acredita aprobación de App Store. |
| Android | Última compilación observada: preview, versionCode 7, commit `cccd8d2c6d13827388a631fc62e755b67db68923`, 09/10. No equivale al código de iOS 74. |
| CI de la 74 | 300 pruebas Jest, 24 de entorno, 11 de dependencias y 76 del servidor: **411 aprobadas**, una omitida. TypeScript correcto; lint con cero errores y cuatro avisos. Son resultados históricos consultados, no pruebas físicas ni una ejecución nueva. |
| Servidor staging | Railway sirve el despliegue `274352f8-bf8b-41cc-8e2d-ab77a2ecfaf8`, de 08/10, commit `96a80a86f7a16bb2d1cdf7af45748530e73fea0c`. |
| Servidor producción | Último despliegue consultado: `6522af28-0ca3-42d2-8f94-ef3deab62f59`, 13/09. Necesita revisión y despliegue coordinado del candidato. |
| Borrado de cuenta | Función staging `delete-account` v15 activa: cancela la suscripción propia antes de purgar. El fichero del repositorio de la 74 no incorpora esa protección. |

Fuentes: [compilación EAS](https://expo.dev/accounts/ashhhhhhhh/projects/Eclipse/builds/0c5062c4-d272-41b4-8fc8-c59002fd6ffd), [ejecución CI](https://github.com/aamracorporation-gif/Eclipse/actions/runs/38328356054), [fuentes exactas](https://github.com/aamracorporation-gif/Eclipse/tree/c1daf15f4bc4150694e6d4f2e39d6602751954df), consultas de solo lectura a Railway y Supabase. Debe anotarse también la actualización OTA instalada: el número de build por sí solo no identifica todo el código ejecutado.

## Hallazgos que resolver o demostrar antes de publicar

1. **Correo duplicado: la app contiene la corrección; el servidor desplegado es anterior.** La 74 normaliza el correo y reconoce respuestas de registro sin identidades como duplicado. El controlador de registro del commit servido en staging no comprueba ese caso antes de devolver 201. Publicar la corrección del servidor y verificar el endpoint real. Probar que no cambia contraseña, rol, perfil ni compras de la cuenta existente. El falso éxito no demuestra por sí mismo apropiación de cuenta. Casos QA-006, QA-260–269. Fuentes: [helper de la 74](https://github.com/aamracorporation-gif/Eclipse/blob/c1daf15f4bc4150694e6d4f2e39d6602751954df/lib/signupResult.ts), [controlador del servidor desplegado](https://github.com/aamracorporation-gif/Eclipse/blob/96a80a86f7a16bb2d1cdf7af45748530e73fea0c/backend/src/controllers/authController.js).

2. **La 74 presenta contratación de Taquilla Premium dentro del recorrido nativo.** La tarjeta muestra precio y acción de contratar; la pantalla abre Stripe también en iOS/Android. Contradice la decisión de lanzamiento de contratar solo desde la web y mostrar estado/uso en móvil. Reconciliar el candidato con esa decisión y probar suscripción, renovación, impago, cancelación y permisos. Esto no constituye una predicción de rechazo automático de las tiendas. Casos QA-282–293. Fuentes: [pantalla](https://github.com/aamracorporation-gif/Eclipse/blob/c1daf15f4bc4150694e6d4f2e39d6602751954df/app/(creator)/box-office.tsx), [tarjeta](https://github.com/aamracorporation-gif/Eclipse/blob/c1daf15f4bc4150694e6d4f2e39d6602751954df/components/BoxOfficePlanCard.tsx).

3. **Riesgo de perder la protección de borrado en un futuro despliegue.** El servicio staging v15 sí cancela la suscripción antes de borrar; el fichero incluido en la 74 no lo hace. Incorporar al candidato la función y su helper realmente desplegados, verificar su propiedad/modo y repetir borrado con Stripe disponible, fallando y con respuesta tardía. No se ha borrado ninguna cuenta en este análisis. Casos QA-290–293. Fuente: [fichero de la 74](https://github.com/aamracorporation-gif/Eclipse/blob/c1daf15f4bc4150694e6d4f2e39d6602751954df/supabase/functions/delete-account/index.ts).

4. **Cancelación de eventos con ventas necesita una prueba crítica de integridad.** Las funciones revisadas de app y servidor realizan borrado directo sin coordinar una devolución en esas funciones. Hay que demostrar que la base de datos bloquea un borrado inseguro o que el recorrido de cancelación conserva compras, resuelve cobros y avisa a compradores. No se ha confirmado un borrado inseguro en vivo. Casos QA-111, QA-275, QA-279. Fuente: [EventContext](https://github.com/aamracorporation-gif/Eclipse/blob/c1daf15f4bc4150694e6d4f2e39d6602751954df/lib/EventContext.tsx).

5. **Validación del correo con espacios inconsistente.** La validación visual aplica la expresión al valor sin recortar, aunque el envío normaliza. Reproducir pegando un correo nuevo con espacios exteriores y corregir si impide continuar. Es un defecto de formulario, no evidencia de acceso indebido. Caso QA-261. Fuente: [register.tsx, línea 357](https://github.com/aamracorporation-gif/Eclipse/blob/c1daf15f4bc4150694e6d4f2e39d6602751954df/app/(auth)/register.tsx#L357).

6. **La aceptación debe cubrir los candidatos definitivos de ambos sistemas.** La 74 usa staging; Android observado contiene código anterior. Las pruebas del binario iOS 74 no certifican Android ni un servidor de producción distinto. Casos QA-302–319.

## Cobertura completa del catálogo

| Área | Casos | Qué debe quedar probado |
|---|---:|---|
| Registro y acceso | 14 | Alta cliente/organizador, correo, edad, consentimiento, login, recuperación y sesión. |
| Verificación y Connect | 13 | Documentos, estados de revisión y habilitación real para cobrar. |
| Administración | 13 | Acceso exclusivo, revisión, rechazo, cambios y suspensión. |
| Perfil y preferencias | 9 | Guardado, privacidad, preferencias y eliminación. |
| Descubrimiento y mapa | 10 | Búsqueda, filtros, carga, GPS, caducidad y red. |
| Detalle y enlaces | 8 | Compartir con/sin app, enlaces inválidos, calendario e información. |
| Compra y descuentos | 16 | Pago/gratis/VIP, descuento, 3DS, rechazos, doble pulsación y stock. |
| Webhooks y devoluciones | 8 | Duplicados, desorden, firma, carreras, reintentos y conciliación. |
| Entradas, PDF y Wallet | 10 | Propiedad, historial, descarga, pase real y estados de entrada. |
| Gestión de eventos | 13 | Creación, fechas, ubicación, tipos, edición y borrado con ventas. |
| Descuentos y estadísticas | 7 | Límites, vencimiento, desactivación y cifras por organizador. |
| Equipo | 8 | Invitaciones, permisos, revocación, QR de acceso y aislamiento. |
| Escaneo | 9 | Reutilización, concurrencia, evento ajeno, cámara y ausencia de red. |
| Venta manual | 7 | Permiso, productos, venta mixta, cupo compartido y recuperación. |
| Notificaciones | 7 | Compra/cambio, lectura, permisos, cambio de cuenta y reintentos. |
| Seguridad | 10 | Roles, lectura/escritura ajena, tokens, almacenamiento y datos sensibles. |
| Funciones aplazadas | 6 | Reventa/saldo desactivados en app y servidor; enlaces antiguos. |
| Navegación y salida | 10 | Instalación, entorno, volver, interrupciones, accesibilidad y errores. |
| Revisión visual | 40 | Veinte pantallas/recorridos por cada sistema. |
| Rutas protegidas | 17 | Intentos por navegación y enlace directo, antes y después de verificar. |
| Contratos de Edge Functions | 24 | Petición válida y abuso de identidad/propiedad; comprobar efectos reales. |
| Registro y recuperación de la 74 | 10 | Cuenta activa intacta, normalización, simultaneidad, API y enlaces de correo. |
| Integridad comercial adicional | 12 | Pack/mesa, hora límite, cobro tardío, eventos, devoluciones y comisiones. |
| Taquilla y borrado | 12 | Web, ciclo de suscripción, permisos, atomicidad y cancelación antes de borrar. |
| Wallet, puerta y avisos reales | 8 | Dispositivos, usuario externo, QR simultáneo, revocación y entrega. |
| Candidato y producción | 18 | Despliegues, seguridad, tiendas, restauración, alertas, carga y salida. |
| **Total** | **319** | **171 P0; el resto requiere resolución o valoración documentada según impacto.** |

## Preparación y ejecución

Usar cuentas QA controladas: clientes A/B, correo nuevo/no confirmado, organizadores en todos los estados, administrador y trabajadores con permiso de venta, solo escáner y revocados. Preparar eventos futuros, agotados, pasados y cancelados, última entrada, pack de cuatro sin mesa, mesa reservada, descuento de un uso y compras pagadas/pendientes/devueltas.

La matriz mínima necesita iPhone pequeño/grande, Android pequeño/gama media, versiones mínima admitida y actual de cada sistema, y dos dispositivos simultáneos para stock y escaneo. Cubrir Wi-Fi/datos, corte de red, retorno desde segundo plano, instalación limpia/actualización, permisos denegados, teclado, texto grande y lector de pantalla. Probar los idiomas realmente publicados y el huso horario de Madrid, incluido el cambio de hora.

Orden recomendado:

1. Identificar binario, OTA, servidor, funciones y esquema. Resolver diferencias de versiones.
2. Registro, recuperación, permisos y eliminación de cuenta.
3. Organizador: verificación, cobros y creación del evento.
4. Cliente: compra → correo/entrada/PDF/Wallet → escaneo → segundo intento rechazado → devolución conciliada. Repetir con pack, mesa, descuento, 3DS y dos compradores del último cupo.
5. Taquilla web, suscripción, equipo, venta manual y avisos.
6. Regresión completa de pantallas, enlaces, dispositivos, red y accesibilidad.
7. Candidato de producción, configuración de tiendas, recuperación y comprobación comercial mínima autorizada.

Registrar por caso fecha, probador, dispositivo/SO, build/commit/OTA, entorno, resultado real, vídeo/captura e incidencia. En pagos y acceso, incluir referencias saneadas que permitan conciliar compra, pago y entrada. Una pantalla de éxito o un HTTP 200 no demuestran una operación correcta. No publicar secretos ni QR utilizables.

## Condición para sacar la app

Todos los P0 aplicables deben aprobarse con evidencia del candidato y servicios finales; ninguno puede quedar pendiente, fallido o bloqueado. Los defectos graves deben cerrarse, los P1 resolverse o aceptarse expresamente según alcance, y las correcciones volver a probarse. Deben estar listos soporte, alertas de cobros sin entrada, conciliación y restauración demostrada. La publicación gradual necesita responsable y procedimiento de recuperación.

Las tiendas requieren su propia aceptación: cuenta de revisión funcional, datos de privacidad y ficha coherentes, enlaces públicos y eliminación de cuenta. Revisar el modelo de pagos por mercado y distribución. Google exige además una vía web de solicitud de eliminación cuando la app crea cuentas; para determinadas cuentas personales nuevas, exige 12 testers inscritos durante 14 días continuos antes de solicitar producción. Verificar si aplica en la Console del titular. Fuentes oficiales: [Apple](https://developer.apple.com/app-store/review/guidelines/), [eliminación en Google Play](https://support.google.com/googleplay/android-developer/answer/13327111), [pruebas cerradas de Google Play](https://support.google.com/googleplay/android-developer/answer/14151465).

El análisis no ejecutó pruebas físicas, cobros, envíos, borrados o despliegues. Es una revisión dirigida del código y de evidencias disponibles; no una certificación de seguridad ni una auditoría completa. Las referencias antiguas del 04–06/10 son antecedentes y no se presentan como nuevos fallos comprobados.
