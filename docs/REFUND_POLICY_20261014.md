# Eclipse: cancelaciones sin fianza inicial

Decisión vigente de Achraf: **cobro posterior sin fianza inicial**. Sustituye las propuestas de retener gastos al comprador o exigir un depósito. Consentimiento del candidato: organizer-cancellation-full-refund-v2.

## Política y recorrido

1. El organizador guarda una tarjeta con autorización expresa. No se cobra una fianza. El banco puede pedir autenticación.
2. Si cancela, se detienen las ventas, se invalidan las entradas y el comprador recibe **todo lo pagado, incluido el servicio**, en su medio original. Los fallos del cargo al organizador no suspenden esta devolución.
3. El organizador debe la comisión histórica de Eclipse y los costes reales no recuperados de Stripe, netos de abonos. Se comunica un desglose antes del cobro. El cargo desatendido requiere entrega confirmada del aviso y al menos 24 horas configuradas; también puede pagarlo expresamente desde la app.
4. Hay **un cargo inicial** por comisión y costes de venta/devolución ya conciliados. El coste real de ese cargo y los ajustes posteriores se registran como saldo y se compensan con las siguientes liquidaciones, después de avisar. Los abonos a favor del organizador también se trasladan a su saldo. No se encadenan microcargos a la tarjeta.
5. Si la deuda inicial no alcanza 0,50 EUR, se compensa íntegramente con futuras liquidaciones sin redondearla al alza. Si no hay ingresos suficientes, el resto sigue pendiente y requiere resolución con soporte. Un crédito pendiente también sigue siendo dinero debido al organizador.
6. Las nuevas ventas acogidas al modelo se liquidan después del evento y de verificar su finalización. No se ha pactado un plazo fijo de 48 horas. No se liberan fondos con devoluciones, gastos, avisos o incidencias pendientes.
7. No hay devolución voluntaria por cambio de opinión cuando el evento se celebra conforme a lo anunciado; se respetan las devoluciones legalmente obligatorias.

**No existe garantía de pérdida cero:** la tarjeta puede fallar, requerir autenticación, ser revocada o sufrir una disputa. Puede no haber ganancias futuras para compensar. El riesgo de impago fue explicado y aceptado; Eclipse necesita liquidez para devolver al comprador antes de recuperar la deuda.

## Ejemplo ejecutado en Stripe TEST

Los costes siguientes proceden de las transacciones de balance del ensayo; **no son una tarifa garantizada de vuestra cuenta live**. La revisión de cobertura/finalidad del informe fue un fixture de prueba.

| Concepto | Importe |
|---|---:|
| Compra y devolución íntegra al comprador | 20,56 EUR |
| Comisión histórica de Eclipse | 2,00 EUR |
| Coste Stripe de la venta en este ensayo | 0,90 EUR |
| Cargo inicial al organizador | 2,90 EUR |
| Coste Stripe de ese cargo | 0,34 EUR |
| Siguiente liquidación bruta del organizador | 18,00 EUR |
| Compensación de gastos avisados | −0,34 EUR |
| Transferencia neta al organizador | 17,66 EUR |

Reintentar el cargo, el informe y la transferencia no duplica ninguno. La comisión solo puede considerarse conservada neta cuando se han recuperado todos los costes. Las comisiones no disponibles o provisionales nunca se convierten automáticamente en cero.

## Conciliación y excepciones

El importador interno valida el informe detallado completo de Stripe, la cuenta, el modo, la moneda, los pagos/devoluciones afectados, impuestos de las comisiones y abonos. Usa instantáneas completas, no suma otra vez el fee inline. Cada revisión queda registrada y solo genera la diferencia respecto a la anterior. La descarga y revisión de cobertura del informe siguen siendo una tarea de operaciones; no hay un endpoint público para inventar costes.

Las ventas antiguas con destination charges necesitan reversión de transferencia y devolución de application fee. Si una devolución parcial anterior omitió esas reversiones, el comprador recupera su importe pero la contabilidad queda en revisión; no se declara recuperado el dinero del organizador. Los casos históricos con saldo/reventa quedan también para conciliación. Una operación excepcional no bloquea la devolución de las demás compras compatibles.

Una devolución pendiente no se presenta como completada. Si Stripe comunica un fallo posterior, se reabre el caso y se bloquea el cobro al organizador. Si se devuelve o disputa el cargo del organizador, se reabre su expediente sin crear otro cargo automático.

## Dónde consultar cada importe

- **Eclipse → organizador → Cancelaciones y cobros:** autorización, devoluciones, comisión, gastos conciliados, cargo y ajustes en liquidaciones, una vez activado el candidato.
- **Stripe plataforma → Pagos:** pago del comprador y cargo independiente al organizador; los metadatos relacionan ambos con el expediente.
- **Stripe → Saldos / Transacciones / Informes de gastos:** comisiones reales, sus impuestos y ajustes. El cargo de servicio del comprador no equivale necesariamente al coste real de Stripe.
- **Stripe Connect → Comisiones recaudadas:** application fees históricas. Las nuevas ventas retenidas hasta después del evento conservan la comisión por diferencia al transferir el neto y no crean una application fee por venta.
- **Connect → cuenta del organizador → Transferencias / pagos al banco:** dinero transferido por Eclipse y posterior abono bancario, que son movimientos distintos.

## Estado de activación

Código en PR40, controles financieros desactivados por defecto. Esquema aplicado y ensayado en staging con operaciones revertidas. Pruebas reales de API Stripe **TEST**, sin dinero real; detalles y límites en [la evidencia de aceptación](qa/DEFERRED_CANCELLATION_BILLING_20261014.md).

La activación exige todavía el despliegue coordinado del candidato, aceptación del recorrido completo en iOS/Android (incluida autenticación bancaria), webhooks firmados y avisos entregados por los servicios desplegados, configuración de costes/cuenta live y documentación contractual definitiva. Los ensayos de API no certifican estos puntos. Producción no se ha activado y los seis bloqueos de lanzamiento permanecen abiertos.

Fuentes: [SetupIntents](https://docs.stripe.com/payments/setup-intents), [devoluciones Connect](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes), [transferencias separadas](https://docs.stripe.com/connect/separate-charges-and-transfers), [costes standalone](https://docs.stripe.com/standalone-fees), [informe de gastos](https://docs.stripe.com/reports/all-fees).
