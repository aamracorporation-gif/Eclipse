# Descuentos por producto y mesas VIP

## Alcance
Corrección sobre PR #28, sin activar reventa ni monedero. Código preparado para integrar; este documento no confirma despliegue de base de datos/Edge Functions ni disponibilidad en una build instalada.

El organizador puede crear y editar códigos con cuatro alcances: todas las entradas, todas las mesas VIP, ambos o selección múltiple de productos concretos del catálogo del evento. Se guardan IDs separados de tipos de entrada y reservados VIP. No se confunden categorías/nombres con los productos reales.

Los códigos anteriores conservan `tickets`: no pasan automáticamente a descontar mesas. Para autorizar mesas con un código anterior hay que editar expresamente su alcance. Un producto nuevo no se añade automáticamente a un código de selección concreta.

## Compra
La misma interfaz de código se utiliza para entradas y mesas. Revalida por evento, producto y cantidad; descarta respuestas tardías y borra la selección al cambiar de producto. Un reservado/pack cuenta como una unidad, no como sus invitados.

El servidor calcula el importe en céntimos, aplica un fijo una sola vez al pedido y nunca supera el subtotal. La comisión VIP conserva el 5% con límite de 25 euros por mesa, calculado sobre el subtotal descontado. La tasa de servicio existente permanece separada; un cupón del 100% no elimina automáticamente dicha tasa mínima.

`discount_expected_cents` sólo permite rechazar una cotización obsoleta: nunca es la autoridad del importe. Se vuelven a comprobar vigencia, evento, selección, mínimo y usos en el servidor antes de crear el pago. La confirmación en PostgreSQL vuelve a comprobar el descuento y bloquea la fila del código hasta registrar el uso; los pagos repetidos no emiten otra entrada. Un descuento que ya no sea válido sigue la decisión persistente de reembolso existente, sin emitir el reservado.

## Evidencia y límites
El workflow de validación 37534195114 aprobó instalación reproducible, migración/confirmación en fixtures PostgreSQL, TypeScript, lint, tests de aplicación, backend, controles de entorno/dependencias, regresiones Wallet y exportación Expo web. Sólo entonces guardó las modificaciones de código y la migración generada con Supabase CLI. Los ficheros temporales del workflow se retiraron después.

Las pruebas incluyen cálculo de importes en el handler real con Stripe simulado, rechazo de productos/eventos ajenos, mínimos, caducidad, último uso, firma Wallet existente, respuesta tardía al cambiar de mesa y emisión de seis accesos para una mesa de seis personas al precio neto. La prueba de dos pagos compitiendo por el último uso es secuencial en PGlite; no representa una prueba de carga concurrente multi-sesión.

La revisión final debe incluir el CI ordinario de la PR, incluidos los tests del selector del organizador añadidos después del primer workflow. No se han cobrado tarjetas reales ni probado en un iPhone/Android físico en esta tarea.

## Orden de integración y despliegue
1. Integrar PR #28 y esta corrección, conservando la política de lanzamiento.
2. Aplicar únicamente la migración nueva `*_discount_product_scope.sql` en staging. No ejecutar toda la cadena histórica con `db push --include-all`.
3. Desplegar en staging `create-payment-intent-v2` con sus imports relativos (incluido `_shared/discountPolicy.ts`) y JWT habilitado; no cambiar producción.
4. Comprobar permisos, crear código por producto y probar compra con Stripe de pruebas, confirmación, límites y reintento. Verificar que el total mostrado coincide con el cobrado.
5. Generar la build nativa desde el commit integrado y realizar QA físico de selección, teclado, aplicar/quitar código, cambio de producto, VIP y navegación antes de promover a producción.

## Pendiente de notificaciones
Issue #29 registra el requisito de diseñar previamente las notificaciones: matriz por rol/disparador/canal, textos, preferencias, permisos, frecuencia, agrupación y destino al abrir. Implementación y pruebas iOS/Android posteriores al diseño. La infraestructura existente no supone aprobación del sistema completo. No se activan envíos ni campañas desde esta corrección.
