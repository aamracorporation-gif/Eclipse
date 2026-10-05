# Comisión de reservados VIP

Política aprobada el 5 de octubre de 2026: 5 % del precio de cada reservado completo, máximo 25 EUR de comisión Eclipse. El organizador soporta esta comisión. Se calcula en céntimos, con redondeo al céntimo más próximo antes de aplicar el tope.

`commission = min(round(base_price_cents * 500 / 10000), 2500)`

Alcance: nuevas transacciones de tipo `vip_table` de `create-payment-intent-v2`. Cada checkout compra un reservado; la capacidad de invitados no multiplica la comisión. Las entradas normales conservan su tarifa configurada. Un nombre de entrada que contenga “VIP” no cambia su categoría: esta política corresponde al flujo de reservados, no a etiquetas de texto libres.

| Precio | Comisión Eclipse |
|---:|---:|
| 150 EUR | 7,50 EUR |
| 200 EUR | 10 EUR |
| 201 EUR | 10,05 EUR |
| 300 EUR | 15 EUR |
| 500 EUR | 25 EUR |
| 1.000 EUR | 25 EUR |

El cargo de procesamiento al comprador sigue separado. `application_fee_amount` incluye la comisión Eclipse más ese importe de procesamiento; por ello puede superar25 EUR, aunque la comisión Eclipse no lo supere. El organizador recibe el precio del reservado menos la comisión Eclipse (sin saldo, desactivado en esta release).

La transacción y Stripe guardan el importe real de comisión, la política `vip_5pct_cap25_v1` y el límite2500 céntimos. `commission_bps=500` representa el porcentaje nominal; para conciliación debe utilizarse `platform_fee_cents`/`eclipse_commission_cents`, porque el porcentaje efectivo baja después del tope.

No se recalculan operaciones anteriores. Los reintentos de un PaymentIntent ya creado conservan su importe y comisión originales por idempotencia. El cambio de servidor no requiere una nueva build móvil para nuevos checkouts de reservados.

Prueba: `npx jest __tests__/vipCommission.test.ts --runInBand --coverage=false`. Ejecuta el handler real con fixtures de Auth/DB/Stripe: nueve importes y límites de redondeo, independencia de la tarifa general y capacidad, tarifa normal sin tope y replay sin recálculo. No realiza cargos reales.
