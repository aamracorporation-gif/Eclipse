# Eclipse: cancelaciones y cobro posterior al organizador

Decisión vigente de Achraf, 14 de octubre de 2026: **«Sí, cobro posterior sin fianza inicial»**. Sustituye las propuestas anteriores de fianza, retención de comisión al comprador y retención del gasto de Stripe al comprador.

## Política acordada

- Si cancela el organizador, el comprador recupera **todo lo pagado**, incluido el cargo de servicio, en el medio original. El cobro al organizador es independiente de esa devolución.
- El organizador guarda una tarjeta y acepta expresamente una autorización. Guardarla no cobra una fianza. Su banco puede pedir autenticación para autorizarla.
- Tras la cancelación, el organizador debe la comisión de Eclipse registrada en las ventas afectadas y los costes reales no recuperados de Stripe. Se entrega el desglose antes del cargo.
- Los costes reales incluyen los de procesamiento, devolución y cobro de esa deuda cuando correspondan, netos de abonos. No se identifica el cargo de servicio calculado en la compra con el coste real de Stripe.
- Las nuevas ventas acogidas a la política se liquidan al organizador después del evento. No se ha acordado un plazo fijo de 48 horas; la operación exige verificar la finalización y resolver incidencias.
- No hay devolución voluntaria por simple cambio de opinión si el evento se celebra conforme a lo anunciado. Se mantienen todos los supuestos legalmente obligatorios.
- Una tarjeta guardada no garantiza cobrar. El usuario ha aceptado expresamente el riesgo de rechazo, autenticación o impago para Eclipse. Eclipse también necesita liquidez para devolver antes de cobrar la deuda.

## Ejemplo y contabilidad

Compra de 20,56 EUR: entrada 20 EUR, servicio 0,56 EUR, comisión Eclipse 2 EUR, asignación inicial al organizador 18 EUR. Si los gastos reales de la venta y devolución son 0,56 EUR:

| Concepto | Importe |
|---|---:|
| Devolución total al comprador | 20,56 EUR |
| Comisión incluida en la deuda del organizador | 2,00 EUR |
| Costes Stripe conciliados de venta/devolución | 0,56 EUR |
| Primer cargo al organizador | 2,56 EUR |

El propio cargo de 2,56 EUR puede generar otro gasto de Stripe. Ese gasto no se considera cero, no se inventa con una tarifa genérica y **no está cubierto por el ejemplo**. Se registra para conciliación posterior y resolución contable, sin una secuencia infinita de microcargos. Mientras no se resuelva, el expediente conserva costes pendientes y bloquea la liquidación posterior. No se promete un beneficio neto de 2 EUR hasta cobrar y conciliar todo.

Las ventas antiguas con destination charges requieren recuperar su asignación mediante la reversión de transferencia. En una devolución completa se devuelve también la application fee original y la comisión contractual se recupera mediante el cobro de cancelación. Con las nuevas ventas retenidas no se envía una transferencia al crear la compra: la comisión se conserva por diferencia cuando se liquida el neto, no mediante application_fee_amount.

## Qué incluye el candidato de código

- Autorización con texto/version/hash/fecha, SetupIntent off_session y comprobación de propiedad, modo y tarjeta confirmada por Stripe.
- Pantalla del organizador para autorizar tarjeta, solicitar cancelación, consultar devoluciones y desglose, y completar pagos que requieren intervención del banco. Sección legal de devoluciones.
- Cancelación persistente: detiene ventas, conserva compras, invalida entradas y tramita devoluciones con reintentos. Una respuesta perdida no crea una segunda devolución. Se descuentan devoluciones parciales previas.
- Protección de compras que se cruzan con la cancelación y de liquidaciones que se cruzan con ella. Los clientes no pueden escribir en el registro financiero ni cancelar un evento vendido saltándose este recorrido.
- Nuevas ventas de entradas/mesas acogidas a la política sin transferencia inmediata. El endpoint de cobro antiguo queda bloqueado al activar el nuevo modelo.
- Cargo inicial único por expediente, recuperación del mismo PaymentIntent tras errores, tratamiento de autenticación/impago y bloqueo de más exposición por expedientes pendientes.
- Aviso de desglose mediante el sistema de notificaciones existente. El cobro desatendido exige constancia de entrega y un margen configurado de al menos 24 horas; es una salvaguarda operativa, no un nuevo plazo de liquidación. El organizador puede pagar antes desde la pantalla.
- Herramienta interna para conciliar costes confirmados y liberar liquidaciones después de verificar el evento. No hay endpoint público que permita introducir gastos ni liquidarse a sí mismo.

## Límites y pendientes antes de activar

**Candidato desactivado; no desplegado ni validado todavía con el recorrido completo de Stripe.** No se han ejecutado cobros, devoluciones ni transferencias reales durante este trabajo.

1. Ensayo completo en Stripe de pruebas: tarjeta normal, autenticación, rechazo, método retirado, timeout, entrega de webhooks duplicada/desordenada, devolución pendiente/fallida y saldo insuficiente; recorrido iOS/Android con PaymentSheet real.
2. Revisar tarifas y modo de facturación de vuestra cuenta. Los costes standalone pueden llegar después y requieren informes detallados. La conciliación final usa evidencia revisada por operaciones; todavía no existe un importador automático de esos informes. Un balance_transaction.fee=0 no acredita que todos los gastos sean cero.
3. Completar la liquidación contable de los gastos del propio cobro y posibles abonos posteriores. El candidato los conserva pendientes; no los cobra mediante otro cargo automático ni declara cerrado el beneficio. Hace falta cerrar el procedimiento de ajuste/compensación antes de activar cobros reales.
4. Confirmar configuración de métodos de pago para mostrar tarjeta, firma de webhooks, avisos recibidos, saldos y alertas. Las credenciales y el proyecto de pruebas deben coincidir en servidor y Edge.
5. Ensayar las migraciones con el esquema real, revisar los asesores de Supabase y desplegar coordinadamente servidor/Edge/app. No basta con pruebas SQL aisladas.
6. Revisar los textos contractuales definitivos y los datos del titular, aún pendientes del lanzamiento. La nueva página no sustituye el resto de documentación legal ni acredita validez jurídica por sí sola.
7. Compras históricas mixtas con saldo/reventa, eventos ya iniciados y liquidaciones ya iniciadas requieren soporte. Una operación histórica excepcional queda identificada y no impide procesar las demás compras compatibles.
8. Sigue pendiente presentar en las ventas del organizador el desglose comercial por operación y separar ventas, saldo Stripe, liquidación y abono bancario. No se deben leer las estadísticas Express como un desglose completo de la plataforma.

## Dónde consultar los importes

- **Eclipse, organizador → Cancelaciones y cobros** (cuando se active el candidato): tarjeta autorizada, devolución, comisión, gastos conciliados, cargo y pendientes.
- **Stripe, plataforma → Pagos**: pago del comprador y, por separado, cargo de cancelación al organizador; cada uno con importe, devolución y costes. Los metadatos relacionan expediente y operación.
- **Stripe, Connect → Comisiones recaudadas**: comisiones de las ventas antiguas con application fees. En el modelo de transferencias posteriores no habrá una application fee por cada venta nueva.
- **Stripe → Saldos / Transacciones / Informes de gastos**: movimientos y costes reales. Un gasto aún no disponible no se trata como cero.
- **Stripe Connect → cuenta del organizador → Transferencias y pagos al banco**: transferencia del neto y posterior abono bancario, que son movimientos distintos.

Fuentes: [SetupIntents y autorización de cargos futuros](https://docs.stripe.com/payments/setup-intents), [devoluciones en Connect](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes), [cargos y transferencias separados](https://docs.stripe.com/connect/separate-charges-and-transfers), [costes standalone](https://docs.stripe.com/standalone-fees), [informe de gastos](https://docs.stripe.com/reports/all-fees), [visibilidad de pagos en Express](https://docs.stripe.com/connect/express-dashboard/payments).
