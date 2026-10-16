# POS Shared Foundation

Esta rama prepara contratos compartidos para que POS pueda confirmar ventas sin acceder directo a `MockDatabaseStore` ni hardcodear IDs demo.

## Venta Como Agregado

`SalesRepository.create` recibe `CreateSaleInput` con datos de negocio y `CreateSaleItemInput[]`. El caller no envia `Sale.id`, `Sale.number`, `Sale.status`, timestamps, `SaleItem.id` ni `SaleItem.saleId`.

`MockSalesRepository` genera esos valores dentro de una sola mutacion del store, crea la venta con sus items y mantiene el correlativo existente `POS-###`.

`SaleStatus` actualmente solo tiene `completed`, `partially_returned` y `cancelled`. Por eso `create()` conserva `completed` y debe entenderse como persistencia final de una venta ya validada dentro del futuro boundary de `ConfirmSale`, no como borrador ni reserva intermedia.

## Sesion Y Caja

`CashShiftRepository.getOpenByUserAndBranch(userId, branchId)` resuelve el turno abierto por cajero y sucursal. `getOpenByUser(userId)` se conserva por compatibilidad.

`CashMovement` conserva `referenceType` y `referenceId` opcionales para registrar ingresos de efectivo relacionados a una venta sin crear un repositorio nuevo.

`RoleRepository.getByIdScoped(tenantId, id)` permite resolver `User.roleId -> Role active -> permissions` sin salir del tenant. `CurrentSessionProvider` es temporal para demo: resuelve `cajero@ferrepharma.demo` via repositories y expone `user`, `role`, `permissions`, `hasPermission`, `canAccessBranch`, `loading` e `isDemo`. Auth real podra reemplazar la estrategia interna sin cambiar `useCurrentSession()`.

## Documento De Venta

`Sale.document` es optional para compatibilidad. El snapshot soporta `ticket` o `invoice`; factura conserva `taxId`, `legalName` y `fiscalAddress` como datos historicos de la venta, no como reconstruccion desde el cliente actual.

## Pagos

Pago mixto no requiere un `Payment` especial: se representa como multiples `Payment` asociados al mismo `saleId`. El repositorio actual ya expone `getBySale(saleId): Promise<Payment[]>` y el mock no impone unicidad por venta.

## Inventario

`InventoryMovement` ya soporta `referenceType = "sale"` y `referenceId = sale.id`; el historial de movimientos ya muestra esos movimientos como `Venta {sale.number}`.

`RegisterSaleInventoryMovementsService` vive en Inventario y registra salidas con `InventoryRepository.registerMovement`, reutilizando el patron que actualiza `InventoryBalance` e `InventoryMovement`. Por cada `SaleItem` fisico con `Product.tracking.stock` crea una salida. Servicios o productos sin stock se omiten.

Productos con `tracking.lot` o `tracking.serial` bloquean la confirmacion hasta que POS entregue la trazabilidad necesaria. No se registra una salida incompleta.

El servicio primero resuelve y valida todos los items y solo despues registra movimientos. Si ya existen movimientos con `referenceType = "sale"` y `referenceId = sale.id`, un retry completo devuelve esos movimientos; un estado parcial o inconsistente se rechaza para evitar duplicar descuentos de stock.

## Pendiente Para ConfirmSale

Antes de persistir una venta POS deben validarse: usuario actual, permiso `pos.sales.create`, acceso a sucursal, turno abierto por usuario+sucursal, carrito no vacio, cantidades validas, stock suficiente, bloqueo de lote/serie sin trazabilidad, pagos iguales al total y datos fiscales cuando `document.type` sea `invoice`.

La orquestacion atomica final vive en `SaleConfirmationRepository`. Ver `docs/POS_SALE_CONFIRMATION.md` para el contrato, reglas de transferencia manual, caja, inventario, order opcional e idempotencia.
