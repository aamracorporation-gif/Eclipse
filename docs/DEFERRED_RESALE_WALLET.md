# Reventa y monedero aplazados para el lanzamiento

Decisión de Ash, 30-09-2026: lanzar sin reventa ni monedero de saldo, conservando las implementaciones para una fase posterior. No elimina entradas, códigos QR, Apple Wallet, Google Wallet, descuentos de organizador, compra directa ni VIP.

## Estado y alcance

- Base anterior a la desactivación: `5a48794e19863ca974331dc8a54fb6c91d3fb22c`, rama `codex/release-hardening`, PR #22.
- Política compartida: `supabase/functions/_shared/launchPolicy.ts`, reexportada por `lib/launchFeatures.ts`. `resale=false`, `walletCredit=false`. No son variables que un cliente pueda activar para eludir el servidor.
- App: oculta pestaña, botones y ajustes de reventa, accesos al monedero, pago con saldo y pago mixto. Las rutas `/resale`, `/my-resales` y `/wallet` redirigen a Mis entradas antes de montar la pantalla original. Los componentes originales, traducciones, tipos, estados y estilos se conservan.
- Se permite cancelar una oferta anterior desde Mis entradas. Así una entrada que ya estaba publicada no queda atrapada. La incorporación de entradas a Apple/Google Wallet permanece habilitada.
- Edge `create-payment-intent-v2`: rechaza reventa, recarga y cualquier débito de saldo antes de buscar/crear un PaymentIntent. Comprueba también la transacción almacenada antes de devolver un client secret en una repetición idempotente. Autenticación y verificación JWT se mantienen.
- Migración `20260930000853_defer_resale_and_wallet_for_launch.sql`: revoca RPC de publicación, compra de reventa y compra con saldo; impide nuevas ofertas, reactivación y cambios de precio mediante trigger; impide nuevas transacciones de reventa, recarga o pago mixto. No sustituye ni borra las implementaciones originales.
- Se conserva el procesamiento de pagos ya creados y devoluciones: desactivar una función no debe dejar sin resolver dinero ya cobrado. Las actualizaciones de transacciones históricas siguen permitidas.
- Aplicado únicamente a Supabase **staging** `uhondxttdpvywvkyqlkk`; no se ha modificado producción. La app requiere una compilación nueva de esta rama. El APK anterior no contiene la nueva interfaz.

## Inventario previo de staging

Una cuenta con 10 EUR reales de saldo, 0 EUR promocionales; una oferta activa y una vendida; ninguna transacción con estado pendiente fuera de fulfilled/refunded/failed/canceled/cancelled. Se han conservado todos estos datos. El origen de los 10 EUR corresponde al escenario sandbox documentado en STAGING_STRIPE_QA_20260927.md. Antes de aplicar en producción repetir el inventario y resolver cualquier obligación real; no borrar ni poner a cero saldos para facilitar el lanzamiento.

## Cómo funcionaba

1. `create_resale_listing_secure(ticket, price)` verifica titularidad, evento, estado, uso del QR, incorporación a cartera digital y límites de precio. La publicación bloquea el QR de la entrada original.
2. Compra con tarjeta: `create-payment-intent-v2`, tipo `resale_ticket`, y webhook/`confirm-payment` invocan `fulfill_payment_for_user`. La entrega bloquea entrada y oferta, transfiere titularidad y rota el QR. La venta genera crédito del vendedor respaldado mediante `wallet_reserves`.
3. Si la oferta ya no puede entregarse, se registra `refund_pending`; el backend ejecuta un reembolso idempotente y procesa sus eventos posteriores. Véase `backend/src/services/refundUnavailablePurchase.js`.
4. `lib/WalletContext.tsx` lee `user_credit.balance_real` y `balance_promo`, reservas y movimientos. La compra íntegra con saldo usa `buy_ticket_with_credito_v2`, `buy_vip_with_credito` o `buy_resale_ticket_with_credito`. La compra mixta transmite `credit_debit_eur` a Edge; el fulfillment consume reservas de saldo real.
5. Cancelar una publicación utiliza `cancel_resale_listing_secure` y restaura la disponibilidad de la entrada según las comprobaciones de esa función.

## Condiciones para reactivar

No basta con cambiar los dos booleanos. No reactivar automáticamente por alcanzar un número de usuarios.

1. Resolver el fallo de contabilidad documentado en `STAGING_RELEASE_QA_20260929.md`: compra íntegra con saldo emite entrada, debita saldo antiguo y no actualiza `user_credit` ni el ingreso del organizador. Unificar contabilidad y respaldo, sin inventar PaymentIntents para compras de saldo.
2. Decidir financiación de saldo promocional y tarifas de compras sin un nuevo cargo de tarjeta. La frase «lo asume el cliente» no determina quién financia un crédito regalado. Estas decisiones siguen pendientes.
3. Probar concurrencia real de dos compradores, compra contra cancelación, stock final, doble toque, reintentos, webhooks duplicados/desordenados y ausencia de doble emisión/doble débito. Las llamadas secuenciales del conector no prueban concurrencia.
4. Conciliar cada euro entre cobro Stripe, reservas, crédito comprador/vendedor, comisión, ingreso y transferencia al organizador y reembolsos. Probar saldo real, promocional, mixto e insuficiente, venta VIP y descuentos.
5. Probar Android e iOS: publicación, compra, retirada, QR anterior inválido, QR nuevo válido una sola vez, evento cancelado/caducado y compatibilidad de entradas añadidas a cartera digital.
6. Crear una migración nueva revisada que retire `launch_resale_listing_guard` y `launch_wallet_checkout_guard` y restaure solamente los permisos necesarios. Antes de desactivar tenían EXECUTE authenticated: `create_resale_listing_secure(uuid,numeric)`, `buy_resale_ticket_with_credito(uuid,uuid)`, `buy_ticket_with_credito_v2(uuid,text,text,integer,uuid,uuid)`, `buy_vip_with_credito(uuid,uuid,text,text)`. Las otras seis firmas de compra eran solo postgres/service_role: no concederlas al cliente. La migración de desactivación contiene la lista completa de nombres y contempla todas las sobrecargas.
7. Desplegar servidor y migración en staging, habilitar la política compartida, compilar nuevas apps y ejecutar regresiones antes de cualquier despliegue de producción autorizado.

No revertir toda la rama: perdería correcciones de seguridad, pagos y QR posteriores. Los tests históricos de reventa/wallet se conservan, pero algunos escenarios positivos requieren un entorno aislado con la función explícitamente reactivada.

## Verificación de esta desactivación

- 29 comprobaciones locales de política: tarjetas normales/VIP admitidas; reventa, recargas, saldo y alias rechazados.
- 7 pruebas de la función Edge con HTTP simulado: no crea ni consulta Stripe al recibir una operación desactivada; tampoco devuelve secretos de checkouts antiguos desactivados.
- SQL `supabase/tests/staging_launch_scope_regression.sql`: permisos de las 10 firmas históricas bloqueados, publicación y repricing rechazados, compra mixta/reventa rechazadas, inserción primaria/VIP permitida, cancelación, pases y fulfillment conservados. Todas las mutaciones de la prueba se revierten.
- Pruebas de emisión QR primaria y compra VIP con tarjeta ejecutadas en staging tras aplicar la migración.
- Estas verificaciones no sustituyen las pruebas funcionales en dispositivos ni convierten el producto completo en apto para producción.
