# Eclipse Wallet — Sculptural Series v2

Fecha: 6 de octubre de 2026.

## Resultado

Cuatro identidades originales para los pases, con composición propia y materiales distintos:
- General / Liquid Orbit: mercurio líquido y filamento ultravioleta.
- VIP y reservados / Obsidian Aureole: obsidiana y oro champán.
- Backstage / Prism Rupture: cristal fracturado magenta.
- Fastlane / Acid Velocity: metal tensado y acento ácido.

Los originales se crearon con la herramienta integrada ImageGen. Los prompts completos y los PNG maestros están en `assets/wallet-pass/artwork-v2/`. La exportación es reproducible sin llamar a servicios de imágenes.

## Adaptación por plataforma

Apple: franja 375×98 a 1x, 2x y 3x, con tipografía condensada protagonista y detalle escultórico. El campo primario se deja vacío para que no tape el arte. El evento y la hora pasan a campos secundarios; el local, titular y grupo opcional permanecen como datos nativos. El tipo de entrada específico permanece en la etiqueta del evento y en los detalles. La categoría también permanece en el encabezado, accesible en Apple Watch sin depender de la franja. QR nativo sin retoques.

Google: imagen 1032×812 sin texto incrustado, conservando su composición escultórica. Fondo oscuro y datos nativos contrastados. Imágenes públicas fijadas a la revisión inmutable `39426435f4d26cd47f72a473dd3d31c96f10787c`. No contienen datos de entradas ni credenciales.

Referencias consultadas:
- [Apple: Pass Design and Creation](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/PassKit_PG/Creating.html).
- [Google: Generic Pass Brand Guidelines](https://developers.google.com/wallet/generic/resources/brand-guidelines), actualizadas el 28 de septiembre de 2026.
- [Supabase: Functions deployment](https://supabase.com/docs/guides/functions/deploy).

## Verificación

24 comprobaciones correctas: autorización, propiedad, firma Apple con certificados ficticios, firmas RS256 de Google, formatos de claves, datos por categoría, fecha Madrid y preservación del QR. Se comprueban también las dimensiones de las imágenes y la igualdad exacta entre los PNG revisados y los incluidos en el pase.

El código base de los dos generadores se contrastó con el desplegado en Eclipse Staging antes de modificarlo: coincidencia exacta. No se cambia autenticación, firma, derechos de acceso ni datos de entradas.

Previsualizaciones:
- `evidence-20261006/wallet-ios-v2.png`
- `evidence-20261006/wallet-android-v2.png`
- `evidence-20261006/wallet-design-preview-v2.png`
- `evidence-20261006/wallet-design-v2-tests.txt`

Estas composiciones usan los PNG finales y datos ficticios; no son capturas del sistema operativo. La disposición exacta, el ajuste de títulos largos y los tamaños de letra requieren revisión con un pase recién generado en iPhone y Android. No se ha comprobado instalación en dispositivos ni la cadena de confianza de Apple. El acceso al emisor Google de staging seguía pendiente en el contexto previo.

## Regenerar

Desplegado en Eclipse Staging: Apple versión 4 y Google versión 7, ambas activas y con verificación JWT. Se comprobó que los cuatro PNG públicos devuelven HTTP 200 y coinciden byte a byte con los revisados, y que ambos endpoints rechazan llamadas sin sesión (401). El código recuperado del despliegue de Google coincide con la revisión guardada. La lectura posterior del código de Apple no pudo completarse por un error interno del conector; el despliegue y la consulta de estado sí confirman su versión activa. Evidencias: `wallet-v2-live-check.json` y `wallet-v2-deployment.json` en la misma carpeta de evidencias.

Desde la raíz del repositorio, con las dependencias de desarrollo instaladas:

```sh
node scripts/generate_eclipse_wallet_assets.mjs
node scripts/qa/preview-wallet-design.mjs
WALLET_TEST_DEPS=/ruta/al/prefijo-de-dependencias node scripts/qa/wallet-pass-regression.cjs
```

El prefijo de pruebas requiere passkit-generator@3.1.10, jose@5.9.6 y node-forge@1.4.0. La generación usa @napi-rs/canvas@1.0.0 y las fuentes incluidas en el repositorio.
