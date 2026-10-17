# POS Sale Confirmation

`SaleConfirmationRepository` es el boundary compartido para confirmar una venta POS como una sola operacion persistente.

## Responsabilidades

El modulo POS debe prevalidar la venta antes de llamar `confirm(input)`: sesion actual, permiso `pos.sales.create`, acceso a sucursal, turno abierto, ticket no vacio, cantidades, stock suficiente, bloqueo de lote/serie, pagos equivalentes al total y documento fiscal cuando aplique.

El boundary no reemplaza esa prevalidacion; protege la persistencia final y evita que POS cree por separado `Sale`, `Payment`, movimientos de inventario y movimientos de caja.

## Atomicidad Mock

`MockSaleConfirmationRepository` usa `MockDatabaseStore.transact()`: clona el estado actual, ejecuta toda la confirmacion contra la copia y solo reemplaza el estado real si todas las mutaciones terminan correctamente.

Si falla cualquier paso, la copia se descarta. El estado original queda intacto: no quedan ventas, pagos, descuentos de inventario ni movimientos de caja parciales.

Los eventos se emiten solo despues del commit exitoso. Si un listener/refresco falla despues del commit, la confirmacion sigue devolviendo exito porque la persistencia ya fue cerrada.

## Input Y Resultado

`ConfirmSaleInput` recibe una venta ya prevalidada:

- `confirmationId` tecnico para idempotencia;
- `tenantId`, `branchId`, `cashierUserId`, `cashShiftId`;
- datos de venta, items y snapshot de documento;
- uno o varios pagos reales;
- `sourceOrderId` opcional.

El caller no envia `Sale.id`, `Sale.number`, `SaleItem.id`, `saleId` ni timestamps.

`ConfirmSaleResult` devuelve `sale`, `payments`, `inventoryMovements`, `cashMovement` opcional e indicador `idempotent`.

## Pagos Multiples

Un pago mixto se representa como multiples `Payment` reales. No se debe crear un `Payment` con `PaymentMethod.mixed` en la confirmacion POS.

Los metodos habilitados para POS salen de `BusinessCapabilitiesConfig.allowedPosPaymentMethods`. `EcommerceConfig.allowedPaymentMethods` pertenece al checkout ecommerce y no es la autoridad de la caja POS.

Ejemplo:

- efectivo Q300;
- transferencia Q700.

Resultado:

- `Payment cash` por Q300;
- `Payment transfer` por Q700.

## Transferencia O Deposito

La transferencia/deposito usa verificacion externa manual. El sistema no valida con banco, API, webhook ni gateway.

El cajero debe registrar cuenta bancaria compartida activa, referencia/comprobante y declarar que verifico externamente el pago. Esa declaracion se guarda en `Payment.manualVerification`.

Esto significa: el cajero confirmo que verifico externamente el pago. Nunca significa pago validado por banco.

## Cuentas Bancarias

Las cuentas se reutilizan desde `BankAccountRepository`. La confirmacion exige que la cuenta de transferencia sea del tenant actual, este activa y aplique a la sucursal de la venta.

POS no debe hardcodear bancos, cuentas, alias ni IDs.

## Caja

`CashMovement` se genera solo por dinero fisico (`PaymentMethod.cash`). Transferencia y tarjeta no generan movimiento de caja fisica.

El movimiento de efectivo se vincula al turno y a la venta usando `referenceType = "sale"` y `referenceId = sale.id`.

## Inventario

Para productos fisicos con `Product.tracking.stock === true`, la confirmacion registra salida de inventario con `InventoryMovement.referenceType = "sale"` y `referenceId = sale.id`, actualizando `InventoryBalance`.

Servicios o productos sin stock no generan movimiento de inventario.

Productos con lote o serie bloquean la confirmacion hasta que POS entregue trazabilidad. No se seleccionan lotes ni seriales en este boundary.

## Order Opcional

`sourceOrderId` es opcional. Una venta directa de mostrador no requiere `Order`.

Si existe `sourceOrderId`, la confirmacion valida que la Order pertenezca al mismo tenant y sucursal, no este cancelada y coincida en productos y cantidades con la Sale. Cada item fisico con stock debe conservar una `InventoryReservation` valida que demuestre que la Order es responsable del fulfillment. En ese caso la Sale no crea un segundo `InventoryMovement.out`: Picking conserva el consumo fisico de la reserva.

En el alcance actual, una Order puede respaldar como maximo una Sale confirmada. La comprobacion ocurre dentro de la transaccion de confirmacion, junto con la persistencia de Sale, pagos y caja. No cambia `Order.status` ni emite `order.changed`.

## Entrega POS

`immediate` confirma una Sale directa y registra su OUT. `store_pickup` y `home_delivery` crean primero una Order confirmada con `source = pos` e idempotencia propia; esa Order reserva stock mediante su boundary y la Sale se confirma con `sourceOrderId`, sin un segundo OUT. La clave de Order es distinta de `confirmationId` y ambas permanecen estables al reintentar el mismo cobro.

## Idempotencia

`confirmationId` evita dobles confirmaciones por doble click o retry. Si ya existe una venta del mismo tenant con ese `confirmationId` y el mismo payload logico, el repository devuelve el resultado persistido con `idempotent: true` y no duplica ventas, pagos, inventario ni caja.

Si el mismo `confirmationId` se reutiliza con otro payload logico, la confirmacion falla para evitar asociar una venta distinta al retry anterior.

## Integracion POS

Flujo esperado:

```text
Terminal
-> ConfirmSaleService
-> prevalidate()
-> repositories.saleConfirmations.confirm(input)
-> success
-> limpiar ticket / mostrar venta confirmada
```

POS no debe llamar individualmente `SalesRepository.create()`, `PaymentRepository.create()`, inventario, caja u orden para confirmar una venta.
