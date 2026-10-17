# Arquitectura OmniRetail

`app/` contiene rutas y layouts de Next.js. `core/` define entities, enums, types y repository contracts sin React. `infrastructure/` implementa persistencia mock, LocalStorage encapsulado, repositories mock y eventos. `modules/` contiene las features por integrante. `shared/` contiene UI, hooks y utilidades comunes; desde feature/saas-entitlement-enforcement tambien `shared/application/` (services/dto), la unica capa Application neutral de la que cualquier modulo puede depender sin invertir el sentido de las dependencias -- mismo criterio que `auth` (nadie depende de `auth` "hacia atras"). `config/` centraliza navegacion, permisos, estados y politicas.

## SaaS Entitlement Enforcement

`ResolveTenantEntitlementsService` vivia en `administration`; se movio a `shared/application/services/` porque Inventory/Purchasing/Receiving/POS/Storefront/Catalog necesitaban resolver entitlements y una dependencia `inventory -> administration` hubiera sido incorrecta (administration es un modulo de dominio, no una capa base). `administration` reimporta el mismo service para sus propias pantallas (`GetTenantUsageService`), sin un segundo resolver paralelo.

Cada modulo compone el nuevo guard de entitlement (`ensureTenantCapability`/`ensureTenantLimit`, ambos en `shared/application/services/entitlementGuards.ts`) ADEMAS de sus guards de permiso/tenant/branch existentes (`ensureCanXxx(permissions)`, `resolveXxxContext`), nunca en su lugar -- ver el patron ya establecido en cada `serviceHelpers.ts` de modulo (`ensureTenantCanUseInventory`, `ensureTenantCanUsePurchasing`, `ensureTenantCanUseReceiving`, `ensureTenantCanUsePos`, `ensureTenantCanUseKits`, `ensureTenantCanCreateEmployee`/`ensureTenantCanCreateBranch`).

```text
Application Service.execute()
-> resolveXxxContext(repositories)      // tenant/actor/permissions desde la sesion, como siempre
-> ensureCanXxx(permissions)            // permiso de Role, sin cambios
-> ensureTenantCanUseXxx(repositories, tenantId)
   -> ResolveTenantEntitlementsService.execute(tenantId)
   -> ensureTenantCapability(entitlements, SaasCapabilityKey.xxx)
-> ... validaciones de negocio existentes (branch, ownership, factor, lote/serie) ...
-> repository write
```

`EntitlementProvider` (`src/shared/providers/EntitlementProvider.tsx`) sigue el mismo patron que `CurrentSessionProvider`: `reloadVersion` ref como guarda de carrera, carga inicial diferida con `window.queueMicrotask`, revalidacion via `useDataEvent("auth.changed"/"user.changed", ...)` con un predicado puro exportado y testeable. Montado en `src/app/(private)/layout.tsx` dentro de `RequireSession` (necesita sesion resuelta) y antes de `AuthorizedPrivateShell`/`RequirePermission`.

Storefront/Customer publico no usa este flujo modular -- el unico punto de entrada realmente enforced es `ResolvePublicStorefrontContextService.execute()` (modo estricto, sin `allowDisabled`), que ademas de Tenant activo + `EcommerceConfig.enabled` (ya existente) ahora exige Subscription active + Plan active + capability `ecommerce`. Cubre `CreateStorefrontCheckoutService` (el unico escritor comercial real). Los 4 read services de discovery/detalle/tracking siguen aceptando `tenantId` como parametro ya resuelto por el caller sin re-validarlo -- gap preexistente a esta PR, documentado como follow-up (retrofitarlos rompia harnesses no relacionados que los invocan con fixtures minimos).

Flujo actual:

```text
UI
-> module service / mapper
-> Repository contract
-> MockRepository
-> MockDatabase
```

Flujo futuro:

```text
UI
-> Repository contract
-> ApiRepository
-> Backend
```

## Customer En Storefront

La presentacion de imagenes de Catalog y Storefront pasa por el resolver canonico de `CatalogImageSource`. Las rutas/URLs seguras se usan directamente; los `mockAsset` se recuperan de IndexedDB mediante un contrato tenant-scoped y se convierten en Object URLs efimeras. Product no absorbe multimedia, Category solo mantiene una referencia opcional y ningun Blob entra en la base mock serializada.

`ResolvePublicStorefrontContextService` deriva el tenant de la tienda desde el slug configurado y valida tenant/configuracion activa sin aceptar `tenantId` del caller. `GetPublicStorefrontConfigService` construye el DTO público de configuración y ubicaciones `active + store`; `PublicTenantProvider` lo refresca ante `business-config.changed` y `branch.changed`, ignorando eventos de otros tenants. El checkout revalida el boundary autoritativo y conserva `defaultBranchId` y las reglas operacionales de fulfillment. La identidad opcional se deriva de los repositories de sesion y se vincula solamente cuando pertenece al mismo tenant publico.

`EcommerceConfig.enabled` cierra exclusivamente el route group comercial del Storefront. El layout público es el único owner de `PublicTenantProvider`, Header y Footer; el layout comercial agrega únicamente `CommercialStorefrontGate`, sin montar otro shell. El grupo público accesible hereda el chrome común sin gate y conserva login, registro, recuperación, seguimiento y `/cuenta/*`, de modo que autenticación y backoffice no dependan del estado del canal de venta. `PublicTenantProvider` continúa exponiendo el tenant resuelto cuando el canal está deshabilitado; los services de compra mantienen su propio enforcement.

```text
ResolvePublicStorefrontContextService -> PublicTenantProvider
-> CreateStorefrontCheckoutService
-> Current Session -> active Customer User -> active Customer
-> tenant match
-> Order.customerId
-> OrderRepository.getByCustomer para /cuenta/pedidos
```

Guest y sesiones de personal no producen contexto Customer. Una sesion Customer invalida o inactiva falla cerrada; una identidad valida de otro tenant no se atribuye a la Order del Storefront actual.

## Order Reservation Lifecycle

`MockOrderRepository` crea o confirma una Order y todas sus reservas dentro de una sola llamada a `MockDatabaseStore.transact`. Las mutaciones de reserva sobre el draft viven en helpers de infraestructura compartidos con `MockInventoryRepository` y `MockOrderPaymentConfirmationRepository`; asi los repositorios usan el mismo algoritmo sin abrir transacciones anidadas ni duplicar la logica de allocations.

```text
OrderRepository.create / updateStatus
-> MockOrderRepository
-> MockDatabaseStore.transact
-> Order + InventoryReservation + InventoryBalance
```

El checkout e-commerce crea primero `Order.pending` y `Payment.pending`. Cada `OrderItem.id` queda namespaced por el `idempotencyKey` estable del intento, por lo que un retry conserva identidad y Orders distintas no comparten lineas. Para el pago mock con tarjeta, `OrderPaymentConfirmationRepository.confirm` valida Order, Payment, tenant, branch activa, relacion, importe y estados; en una unica transaccion reserva inventario y cambia ambos estados. Si falta disponibilidad, la transaccion de confirmacion revierte y el boundary compensa eliminando exclusivamente la pareja inmediata `pending/pending` sin reservas ni dependencias. Confirmar otra vez la misma pareja ya confirmada es idempotente.

```text
CreateStorefrontCheckoutService
-> OrderRepository.createWithPayment
-> OrderPaymentConfirmationRepository.confirm
-> MockDatabaseStore.transact
-> Payment.approved + Order.confirmed + InventoryReservation + InventoryBalance.reservedQuantity
```

Esta confirmacion no reduce `InventoryBalance.quantity` ni crea `InventoryMovement`; ese consumo fisico continua perteneciendo a Picking.

`MockPickingRepository.updateItem` usa el mismo patron transaccional para persistir el incremento de `PickingItem.pickedQuantity`, consumir las allocations originales de la reserva y crear los movimientos OUT por ubicacion. La mutacion de consumo se comparte con `MockInventoryRepository` y no abre una transaccion anidada.

```text
PickingRepository.updateItem
-> MockPickingRepository
-> MockDatabaseStore.transact
-> PickingItem + InventoryReservation + InventoryBalance + InventoryMovement
```

La asignacion tambien cambia `Order.confirmed -> preparing` dentro de una sola transaccion. El primer incremento positivo agrega `Order.preparing -> picking` a la transaccion anterior. Completion cambia `PickingOrder -> completed`, mueve la Order a `packing` y crea Packing `in_progress` atomicamente, sin tocar inventario. Packing persiste preparacion y finaliza junto con la Order hacia `ready_for_dispatch` o `ready_for_pickup`; tampoco consume inventario.

```text
DispatchApplicationService
-> DispatchAuthorizationContext (Session -> User -> Role -> Branch)
-> DispatchRepository.confirm
-> MockDatabaseStore.transact
-> Dispatch.dispatched + Order.dispatched + Notification email simulada opcional
```

Dispatch solo verifica que Picking haya consumido las reservas stock-tracked. No actualiza `InventoryBalance`, `InventoryReservation`, `InventoryMovement`, lotes ni seriales. `Order.status` permanece como unica fuente del tracking; no se agrega timeline persistido.

Para retiro en tienda, `StorePickupDeliveryRepository.confirm` es un boundary separado de Dispatch: valida la Order `store_pickup` tenant+sucursal scoped, persiste evidencia del actor y fecha, y cambia atomicamente `ready_for_pickup -> delivered`. No vuelve a consumir inventario. La lectura historica de trazabilidad usa `InventoryRepository.getPickingFulfillmentTrace`, basada en reservas y movimientos ya persistidos.

`DispatchRepository.markDelivered` reutiliza el mismo contexto confiable y una unica transaccion para cambiar el Dispatch canonico y su Order de `dispatched` a `delivered`, persistiendo `deliveredAt`. El retry del par ya entregado es idempotente. Esta operacion no acepta cambios de envio, no toca inventario y no vuelve a crear la notificacion de despacho.

`MockSaleConfirmationRepository.confirm` valida dentro de su transaccion si `sourceOrderId` acredita ownership mediante la Order y sus reservas. Las ventas directas conservan el OUT propio; las vinculadas validas persisten Sale, Payment y CashMovement sin modificar reservas, balances ni movimientos de inventario.

## Cash Shift Lifecycle

`CashShiftRepository` administra exclusivamente el turno y expone consultas tenant-scoped.
`CashMovementRepository` administra los movimientos y valida el ownership del turno antes de
consultar o registrar. Los mocks protegen apertura unica, estado y relaciones dentro de
`MockDatabaseStore.transact`.

```text
POS cash application services
-> CashShiftRepository + CashMovementRepository
-> MockDatabaseStore.transact
-> CashShift + CashMovement
```

`core/cash/cashShiftTotals` es la semantica monetaria compartida por el resumen de aplicacion y el
cierre de infraestructura. Los movimientos referenciados a Sale ya representan el componente cash
de la venta, por lo que el resumen no vuelve a sumar Sale ni Payment.

## Returns And Voids

`SaleReversalRepository` es el boundary compartido para consultar elegibilidad y procesar una
devolucion o anulacion. Su implementacion mock usa una sola llamada a
`MockDatabaseStore.transact`: Return/SaleVoid, refunds, entradas de inventario, salida cash,
estado de Payment y Sale, y CreditNote mock se confirman juntos. Los eventos se emiten solamente
despues del commit.

La anulacion POS normal exige que `Sale.cashShiftId` sea el turno original que continua abierto
para el actor y la sucursal. Una devolucion puede ocurrir en un turno posterior, pero cualquier
componente cash exige un turno abierto del actor en esa sucursal. La reversion de inventario usa
la ubicacion de los movimientos OUT historicos referenciados a la Sale. Lote, serial y kit se
bloquean mientras no exista una huella historica por linea suficiente para reconstruirlos.

## POS Sales History

El historial POS es una proyeccion de solo lectura. El tenant se deriva del User autenticado y la
sucursal activa vuelve a validarse contra User, Role y Branch antes de consultar datos. El repository
reduce el dataset por tenant+sucursal antes de que application aplique busqueda o filtros visuales.

```text
PosTerminalPage -> PosSalesHistoryModal -> usePosSalesHistory
-> GetPosSalesHistoryService -> RepositoryRegistry
-> SalesRepository.listByBranch + OrderRepository.getByIdsScoped
-> PaymentRepository.getBySaleScoped para el detalle de pagos
```

`Sale.status` conserva el estado comercial y `Order.status` el operativo. Una Sale inmediata no
presenta un estado logistico ficticio; una referencia legacy o fuera de scope permanece visible como
Order no disponible sin exponer datos de otro tenant o sucursal. Esta proyeccion no habilita acciones
de devolucion/anulacion y no escribe Sale, Order, reservas, balances ni movimientos.

## Navegacion Privada

Los modulos declaran sus entradas en `src/modules/*/navigation.ts`.
`src/config/navigation.ts` agrega esas listas junto con la navegacion base y
el layout privado entrega `navigationConfig` al `Sidebar`.

```text
modules/*/navigation.ts
-> config/navigation.ts
-> PrivateLayout
-> Sidebar
```

`Sidebar` renderiza `NavigationItem[]` sin importar modulos concretos. La
metadata de permisos se conserva en los items; cuando Auth este integrado, la
sesion podra filtrar la navegacion antes de renderizar el Sidebar.

## Private Shell

El shell privado organiza el backoffice como una barra lateral de altura
completa y una columna de contenido con header ligero y main.

```text
PrivateShell
|-- Sidebar
`-- Content column
    |-- PrivateHeader
    |   |-- ActiveBranch
    |   |-- Notifications
    |   `-- User slot
    `-- Main
```

La sucursal actual es contexto global del shell privado. `CurrentSessionProvider` reconstruye la
identidad operativa y `ActiveBranchProvider` consulta primero
`BranchRepository.getActiveByTenant(user.tenantId)`; despues aplica `Role.branchScope`. Tanto `all`
como `selected` quedan encerrados en ese tenant y la autorizacion final exige coincidencia de tenant
entre User, Role y Branch. Notifications queda preparado para
conectarse al centro de notificaciones real. UserMenu queda reservado para
Session -> User -> Profile.

Los servicios privados de Catalog resuelven el tenant desde la sesion canonica, no desde DTOs ni
desde el primer registro disponible. Product, Category y Unit se consultan y mutan mediante
operaciones tenant-scoped del repository; las operaciones globales permanecen solo para callers
legacy que aun las requieren.
