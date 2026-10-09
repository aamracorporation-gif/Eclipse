# Rediseño de pases Eclipse — 6 de octubre de 2026

## Alcance

Apple Wallet y Google Wallet: General violeta, VIP/reservados champán, Backstage rosa y Fastlane menta. Arte oscuro con eclipse y órbitas; contraste alto, marca legible, QR nativo y campos españoles. Apple incluye imágenes 1x, 2x y 3x. Google incluye logo, hero y plantilla de dos filas. Los recursos públicos no contienen datos personales y se fijan a un commit inmutable.

Solo datos reales: puertas, zona, prioridad y acceso anticipado requieren metadata explícita. Se han retirado condiciones de compra y correo de soporte inventados. Fechas y horas Europe/Madrid, incluido cambio de día. Grupo y botellas conservados cuando existen.

## Verificación

24/24 pruebas de los handlers con bibliotecas reales de firma y credenciales ficticias: autorización, propietario, configuración ausente, firma Apple y Google, las cuatro categorías, título largo, cambio de día, ausencia de accesos inventados y dimensiones Apple. TypeScript de la app pasa. Evidencia: evidence-20261006/wallet-design-tests.txt.

La vista previa evidence-20261006/wallet-design-preview.png utiliza los recursos definitivos y datos de ejemplo. Es una aproximación, no una captura de un teléfono: los sistemas nativos controlan tipografía y distribución final.

## Pendientes de dispositivo y proveedor

- Instalar un pase recién generado en iPhone y comprobar logo, título largo, QR, campos y reverso. No hace falta una nueva build por este cambio de servidor.
- Google: el acceso al emisor aprobado sigue pendiente. La firma local no valida permisos de emisión ni instalación. Verificar la plantilla en la clase real al recuperar acceso; un JWT de guardado no actualiza automáticamente una clase que ya existe. Aplicar entonces classTemplateInfo a la clase del entorno correspondiente y probar guardado en Android.
- Los pases ya guardados no se actualizan automáticamente. No se han modificado las credenciales ni la configuración de producción.

## Regeneración

Desde la raíz: node scripts/generate_eclipse_wallet_assets.mjs y node scripts/qa/preview-wallet-design.mjs. Se incluyen fuentes DejaVu y licencia para generar el logotipo de forma reproducible. La fuente del resto del pase la controla Wallet.
