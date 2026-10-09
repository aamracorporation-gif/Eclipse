# Corrección de Wallet — 5 de octubre de 2026

## Diagnóstico y cambios

- Staging no tenía `apple-wallet-generator`. Los registros de las 16:38 UTC muestran dos POST404 coincidentes con el fallo comunicado. Se ha restaurado, con JWT obligatorio, control de propietario y assets empaquetados.
- El workflow de staging solo desplegaba las dos funciones de pago. Ahora incluye también ambos generadores de Wallet para evitar repetir esa omisión.
- Apple: autenticación antes de inspeccionar certificados, compatibilidad con claves cifradas y contraseñas con espacios, claves de campos únicas para no perder contenido del pase y lectura de marca de botellas compatible con el formulario.
- Google: normalización de PEM multilinea, texto escapado, JSON entrecomillado y PEM codificado en base64; validación de plataforma/método; configuración ausente identificada con503; lectura compatible de marca de botellas.
- No se ha confirmado la causa exacta del fallo de Android en producción/dispositivo. No hubo invocaciones Google relevantes en la consulta de logs de staging. Los cambios de compatibilidad no sustituyen verificar el emisor configurado.

## Despliegue verificado

Proyecto staging: `uhondxttdpvywvkyqlkk`.

| Función | Versión | Estado | JWT |
|---|---:|---|---|
| apple-wallet-generator | 1 | ACTIVE | obligatorio |
| generate-wallet-pass | 4 | ACTIVE | obligatorio |

Lectura posterior confirma que ambos entrypoints y el helper coinciden con el código probado. Apple responde200 a OPTIONS y rechaza POST sin autenticación; ya no devuelve404 por función ausente. No se han modificado producción, permisos de usuario ni credenciales de firma. No hace falta una nueva build para estos cambios de servidor.

## Pruebas

20/20 pruebas con los handlers reales y las bibliotecas reales `passkit-generator@3.1.10` y `jose@5.9.6`: paquetes ZIP con manifest y firma, cifrado de clave Apple, rechazo de contraseña errónea, unicidad de campos, cuatro formatos PEM, verificación criptográfica RS256 Google, QR de fixture, sesión/propiedad, configuración ausente y métodos inválidos. TypeScript de la app también pasa.

Se usan certificados generados en memoria, identidad QA y DB/Auth simulados. No se han usado claves reales ni añadido pases a cuentas de clientes. Esta prueba NO valida la cadena de confianza Apple, la autorización del emisor Google ni la instalación en un dispositivo.

Reproducción: instalar en un prefijo temporal `passkit-generator@3.1.10` y `jose@5.9.6` con scripts desactivados, y ejecutar:

```sh
WALLET_TEST_DEPS=/ruta/al/prefijo node scripts/qa/wallet-pass-regression.cjs
```

Evidencia: `evidence-20261005/wallet-signing-tests.txt`.

## Comprobación pendiente

El panel de Supabase requiere iniciar sesión para revisar la presencia/configuración de los secretos. El conector disponible no los expone. No se han extraído credenciales de otros entornos ni eludido ese acceso.

- Apple: `APPLE_WWDR_CERT`, `APPLE_PASS_CERT`, `APPLE_PASS_KEY`, contraseña si está cifrada, Pass Type ID y Team ID coincidentes con el certificado vigente.
- Google: `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_CLASS_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_WALLET_PRIVATE_KEY`; cuenta de servicio autorizada en el emisor y usuario de prueba autorizado si está en modo demo.
- Probar con una entrada propia en iPhone/TestFlight y Android: apertura, cancelar, guardar, reintentar y QR correcto. No declarar esos casos Passed hasta ejecutarlos.
