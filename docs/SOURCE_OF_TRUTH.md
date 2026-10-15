# OmniRetail Source Of Truth

Este documento es la fuente funcional autoritativa. El codigo TypeScript actual sigue siendo la verdad ejecutable de firmas y estructuras exactas.

## Jerarquia Documental

1. Codigo TypeScript actual.
2. `docs/SOURCE_OF_TRUTH.md`.
3. `docs/ARCHITECTURE.md`.
4. `docs/CONTRACTS.md`.
5. `docs/GIT_WORKFLOW.md`.
6. `docs/MODULE_OWNERSHIP.md`.
7. `docs/AI_WORKFLOW.md`.
8. `AGENTS.md` y `CLAUDE.md`.

Si dos documentos contradicen el codigo actual, no corregir silenciosamente el codigo. Reportar la inconsistencia antes de cambiar contratos compartidos.

## Multi-Tenant

Jerarquia: Platform -> Tenant / negocio -> Branch / sucursal. Las entidades de negocio pertenecen a tenant; las operativas relevantes tambien pertenecen a branch. El aislamiento entre tenants es obligatorio conceptualmente.

## SaaS Entitlement

Authentication ("quien sos"), Entitlement ("que tiene derecho a usar/comprar tu negocio"), Role
Permission ("que puede hacer este Employee") y Branch Scope ("en que sucursal puede operar")
son cuatro capas independientes. Ninguna sustituye a las demas. Para una mutacion Employee, la
decision final exige TENANT ENTITLEMENT AND ROLE PERMISSION AND BRANCH ACCESS (cuando aplica)
AND RESOURCE OWNERSHIP (cuando aplica). Un Plan con `pos` NO otorga `pos.sales.create`; un Role
con `pos.sales.create` NO otorga la capability `pos` si el Plan no la incluye.

`ResolveTenantEntitlementsService` (`src/shared/application/services`, movido fuera de
`administration` para que Inventory/Purchasing/Receiving/POS/Storefront/Catalog puedan
consumirlo sin invertir la direccion de dependencias) es el UNICO resolver de entitlements.
Fail-closed: sin `TenantSubscription`, o con una Subscription que referencia un
`PlanDefinition` inexistente, lanza `SaasEntitlementError` (nunca asume Enterprise ni ningun
plan por default, nunca cae a `tenant-demo`). `effectiveCapabilities` es
`subscriptionStatus === active && planStatus === active ? plan.capabilities : []` -- una
Subscription suspendida/cancelada o un Plan archivado nunca otorgan capabilities para
operaciones comerciales nuevas, aunque el Plan las incluya nominalmente. `SaasEntitlementError`
expone un `code` machine-readable (`CAPABILITY_REQUIRED`, `LIMIT_REACHED`,
`SUBSCRIPTION_INACTIVE`, `PLAN_INACTIVE`, `SUBSCRIPTION_MISSING`, `PLAN_MISSING`) para que la UI
distinga una restriccion de Plan de un error de permisos sin parsear el mensaje.

El catalogo de `SaasCapabilityKey` (`inventory`, `purchasing`, `receiving`, `pos`, `ecommerce`,
`traceability.lots`, `traceability.expiration`, `traceability.serials`, `catalog.kits`) gatea
exclusivamente mutaciones activas (crear/actualizar/aprobar/confirmar/ajustar/transferir/
ejecutar/habilitar feature), nunca lectura historica: un Employee con `purchasing.orders.read`
sigue viendo ordenes de compra existentes aunque el Plan ya no incluya `purchasing`; lo que se
bloquea es `UpdatePurchaseOrderStatusService`/`PurchaseOrderEditorService.createOrder`. No existe
capability para Administration (sigue gobernada solo por `admin.*` permissions) ni para
Logistics (sin `SaasCapabilityKey` propia).

`SaasLimitKey` (`maxEmployees`, `maxBranches`) gatea unicamente `CreateEmployeeService`/
`CreateBranchService`. Ausente en `PlanDefinition.limits` significa sin limite (nunca "0"
implicito). El Plan Básico actual deja ambas keys ausentes; los conteos son informativos y no
bloquean nuevas altas. El mecanismo genérico se conserva para futuros planes que sí definan
cupos. Un downgrade de limite NUNCA archiva/borra empleados o sucursales existentes -- solo
bloquea la PROXIMA alta mientras el conteo actual (`type === employee && status !== archived`;
`status !== archived` para Branch) sea mayor o igual al limite.

`BusinessCapabilitiesConfig` (config operativa del Tenant, p.ej. `supportsLots`) y SaaS
capability (derecho comercial contratado) son conceptos independientes -- ninguno sustituye al
otro. `effectiveFeatureEnabled = planHasCapability AND businessConfigSetting`
(`isEffectiveBusinessCapabilityEnabled`, `src/shared/application/services/
businessCapabilityEntitlement.ts`), aplicable a `supportsLots`/`supportsExpiration`/
`supportsSerials`/`supportsKits` (los unicos 4 campos de `BusinessCapabilitiesConfig` con
`SaasCapabilityKey` equivalente). `SaveBusinessConfigService` deniega habilitar (false -> true)
una business capability cuyo Plan no la incluye, pero SIEMPRE permite deshabilitarla (evita
lockout). Un downgrade de Plan nunca muta `BusinessCapabilitiesConfig` -- el setting persistido
puede seguir en `true`, pero el efecto real cae a `false` hasta que el Tenant vuelva a un Plan
que lo incluya, momento en el que el setting previo vuelve a ser efectivo sin reconfigurar nada.

Storefront/Customer publico usa un eje de autorizacion DISTINTO: nunca `Role.permissions` ni
`User.allowedBranchIds`. El checkout (`CreateStorefrontCheckoutService`, via
`ResolvePublicStorefrontContextService` en modo estricto) exige Subscription active AND Plan
active AND capability `ecommerce` AND `EcommerceConfig.enabled` -- las 4 condiciones son
independientes; cualquiera ausente deja el canal comercial no disponible.

`EntitlementProvider` (`src/shared/providers`, montado en `(private)/layout.tsx` dentro de
`RequireSession`) es la UNICA fuente de entitlements para la UI -- ningun componente resuelve
`plans`/`tenantSubscriptions` directo. Si la resolucion falla, `entitlements` queda `null` y
`hasCapability`/`getLimit` devuelven `false`/`undefined`; un fallo aca NUNCA dispara logout ni
redirige (Authentication y Entitlement son capas distintas). La suscripción comercial usa Plan
Básico obligatorio (Q199/mes, sin cupos de empleados ni sucursales), E-commerce + Entregas (Q129/mes) y
Reportes avanzados (Q99/mes). Los complementos persisten en `TenantSubscription.addonCodes`; el
resolver compone sus capabilities con las del plan base. El acceso exige entitlement Y permiso
de rol. La facturación es simulada: un snapshot por ciclo mensual y tenant, sin cobros, impuestos,
prorrateos ni factura fiscal. `UpdateTenantSubscriptionService` cambia los complementos y propaga por
`tenant-subscription.changed` -- solo dentro de la misma pestana: DataEventBus es in-memory, no
cross-tab. La capacidad comercial `ecommerce` bloquea nuevas compras cuando el complemento se
desactiva; no bloquea el cumplimiento de Orders anteriores. Picking, Packing, Dispatch y
seguimiento histórico conservan autorización por sesión, tenant, sucursal, permiso y propiedad
del recurso según corresponda. `delivery` no debe utilizarse como veto global de Logistics.

## Producto

Existe una sola Entity `Product`. No crear `StorefrontProduct`, `InventoryProduct` ni `PosProduct`. Product es consumido por Catalog, Storefront, Inventory, POS, Logistics y Purchasing cuando corresponde.

Termino visible estandar: Codigo / SKU. Diferenciar `id`, `sku`, `barcode` opcional y `supplierSku` en `SupplierProduct`.

## Product Media

`Product` y `ProductMedia` son conceptos separados. Product no contiene imagenes directamente; ProductMedia guarda una fuente `url` o `mockAsset` y conserva `url` para compatibilidad con registros legacy. Permite cero, una o multiples imagenes por producto. Solo una imagen debe ser primaria y `sortOrder` define el orden visual.

Las imagenes demo actuales viven en `public/images/products/`. Los modulos deben consultar `ProductMediaRepository`; no deben importar `demoSeed` ni resolver logica leyendo `public/` directamente. `placeholder-product.webp` se usa solo como fallback de UI. Los uploads mock se guardan como Blob mediante `CatalogImageAssetRepository` (IndexedDB), nunca dentro de `MockDatabaseStore`/LocalStorage. `Category.image` es presentacion opcional y usa la misma fuente.

El seed canonico para instalaciones mock nuevas representa Ferretería Demo con exactamente
10 categorias y 30 productos fisicos. Sus existencias viven en `InventoryBalance`, sus minimos en
`ProductInventorySettings`, y atributos, escalas de precio y relaciones de proveedor usan sus
contratos propios. Cambiar `demoSeed` nunca autoriza a borrar ni reemplazar automaticamente
`omniretail.mock.database.v2`; una base local ya persistida conserva los datos del usuario. Cuando el seed demo cambia de forma incompatible (p.ej. el seed de actividad de la demo publica) se incrementa la version de la key (`v1` -> `v2`), de modo que los navegadores cargan el seed nuevo; los datos de la key anterior quedan huerfanos, no se migran.

Catalog / Crear-Editar Producto usa `FileUpload -> procesamiento/preview local -> CatalogImageAssetRepository -> ProductMediaRepository`. El asset se persiste antes de su referencia y se compensa si la referencia falla; reemplazo y borrado eliminan el Blob solo cuando ya no tiene referencias. Con backend real el adapter puede cambiar a `API -> Storage/CDN` sin cambiar el contrato de presentacion.

## Trazabilidad Adaptable

`BusinessCapabilitiesConfig` define capacidades/defaults del negocio. `Product.tracking` define el comportamiento real por producto: `stock`, `lot`, `expiration`, `serial`.

Ejemplos: taladro usa stock y serial; tornillos usan stock; medicamento usa stock, lote y vencimiento; servicio no usa inventario ni trazabilidad. No mostrar lote/vencimiento/serie cuando el producto no los utiliza. Aplica a Catalog, Receiving, Inventory y Picking.

## Product Type

`physical` puede requerir inventario y logistica. `service` no requiere inventario/picking. `kit` eventualmente resuelve componentes.

## Catalogo E Inventario

`Product` describe que es el producto. `InventoryBalance` describe cuanto existe y donde. No almacenar stock oficial dentro de Product.

Stock es por tenant, branch y location. Catalogo es global dentro del tenant. Precios son globales por tenant durante esta fase. `Product.baseUnitId` es la unidad minima indivisible y canonica: balances, movimientos, reservas, lotes y series siempre se expresan en ella. `Product.inventoryUnitId` es solo la presentacion preferida de entrada/display y, si falta en datos legados, se interpreta como `baseUnitId` sin reescalar stock. `Product.saleUnitId` es la unidad/presentacion comercial; POS y e-commerce convierten su cantidad a base antes de validar o mutar inventario. Toda presentacion distinta debe tener una conversion positiva y finita en direccion presentacion -> base; una conversion ausente nunca equivale a factor 1. `Product.salePrice` es el precio base; cualquier precio promocional se deriva y no se guarda como campo mutable en `Product`.

`Unit.category` es la clasificacion canonica de una unidad (`unit`, `weight`, `length`, `volume`, `other`). No depende de `Unit.code`, `Unit.name` ni `Unit.symbol`: cambiar el codigo o el simbolo no debe cambiar la categoria. `Unit.code` sigue siendo identificador interno, `Unit.symbol` sigue siendo representacion corta y `Unit.allowsDecimals` sigue indicando si permite cantidades fraccionarias.

`ProductInventorySettings` representa configuracion operativa por producto+sucursal. Es la fuente canonica para `minStock`, `reorderPoint` opcional y `defaultLocationId` opcional. La unicidad conceptual es `tenantId + productId + branchId`. `InventoryBalance.minStock/reorderPoint` se conserva solo como compatibilidad legacy temporal y no debe usarse como nueva fuente de verdad.

`defaultLocationId` no crea stock, no mueve stock y no crea `InventoryBalance`. Al asignarse debe apuntar a una `StorageLocation` existente, activa, del mismo tenant y de la misma sucursal. Una ubicacion asignada como `defaultLocationId` no puede inactivarse ni archivarse: primero debe cambiarse o limpiarse la asignacion de cada producto+sucursal. Cambiar o limpiar esta configuracion no mueve stock, no crea balances y no borra historial.

`ProductSalesPriceTier` representa precios mayoristas de venta por producto usando `minQuantity` y `unitPrice`. No mezclar estos precios de venta con costos por volumen de proveedor.

OmniRetail reconoce tres canales comerciales: POS (`pos`), e-commerce/web (`ecommerce`) y app movil (`mobileApp`). `Product.channels` define en que canales puede publicarse un producto.

Promociones V1 soporta descuento porcentual (`percentage`), descuento fijo (`fixedDiscount`) y precio promocional fijo (`fixedPrice`). Una promocion puede aplicar a uno o varios productos, a uno o varios canales y puede tener scope por sucursal. `branchIds: []` significa todas las sucursales del tenant; valores explicitos limitan la promocion a esas sucursales. No se permiten promociones solapadas para el mismo tenant, producto, canal, scope de sucursal y rango de fechas. `untilStockEnds` conserva la intencion contractual, pero la aplicacion efectiva contra stock debe validarla el servicio consumidor usando inventario, sin duplicar stock en Promotion.

`ProductPriceHistory` registra automaticamente cambios de `Product.salePrice` con precio anterior, precio nuevo, producto, tenant, fecha y `actorUserId` opcional para integracion futura con Auth. `AuditLog` puede registrar el mismo cambio como auditoria generica. `OrderItem` y `SaleItem` deben conservar snapshot de precio y descuento al crear la transaccion para no recalcular historia con promociones actuales.

## Inventory Movements

`InventoryMovement` es append-only. No modificar historia. Todo ajuste, entrada, salida o transferencia debe generar movimiento. Evitar doble registro de stock entre POS, Receiving, Picking y Dispatch. `quantityBefore` y `quantityAfter` son opcionales para registrar auditoria de stock cuando la operacion conoce esos valores en el momento de persistir el movimiento; no deben reconstruirse para movimientos historicos desde el balance actual.

`InventoryReservation` pertenece a un `OrderItem` y conserva allocations por `InventoryBalance`, incluyendo su `balanceId` y ubicacion. La reserva puede abarcar multiples ubicaciones y es agnostica al canal de origen. Reservar o liberar solo modifica `InventoryBalance.reservedQuantity` y no crea movimientos; consumir reduce `quantity` y `reservedQuantity` en el mismo balance y genera un `InventoryMovement` de salida por allocation consumida. Reserve es idempotente por tenant y linea de pedido, mientras consume exige un `operationId` idempotente persistido. En el seed demo, cada `reservedQuantity` esta respaldado por el remanente de reservas activas del balance.

En recepcion de mercaderia, la cantidad rechazada se deriva de la suma de incidencias activas de la linea. `Recibido ahora` representa la cantidad fisicamente recibida, `Aceptado ahora = Recibido ahora - Rechazado`, y solo lo aceptado genera entrada de inventario. Las incidencias justifican por tipo, observacion y evidencia el rechazo; no existe un ingreso manual paralelo de cantidad rechazada.

`InventoryAdjustment` representa el documento auditable de un ajuste de inventario con numero operativo `AJ-YYYY-#####` unico por tenant y anio. El documento conserva `quantityBefore`, `quantityAfter` y `delta` como snapshot de auditoria; `delta` es `quantityAfter - quantityBefore`. `InventoryAdjustmentRepository` solo persiste el documento y emite `inventory-adjustment.changed`; no modifica `InventoryBalance` ni crea `InventoryMovement`. La aplicacion futura que aplique stock debe registrar el movimiento una sola vez y relacionarlo con `referenceType = "inventoryAdjustment"` y `referenceId = adjustment.id`.

`InventoryTransferRequest` representa la solicitud operativa entre sucursales antes del movimiento fisico: una sucursal solicitante pide producto a una sucursal origen/proveedora. Crear o rechazar una solicitud no reserva stock ni crea Picking. Aceptarla desde la sucursal proveedora aprueba la solicitud y crea atómicamente un `InventoryTransfer` vinculado mediante `sourceRequestIds`, una reserva y exactamente un Picking; no genera `InventoryMovement` ni descuenta stock físico. Sus estados fisicos legacy se conservan solo por compatibilidad; una vez creado un `InventoryTransfer`, el estado fisico canonico vive en el traslado. `InventoryRepository.transferStock()` conserva su semantica actual de transferencia inmediata entre ubicaciones y no debe usarse para solicitudes pendientes.

`InventoryTransfer` representa la ejecucion fisica canonica de un traslado entre sucursales. Tiene numero operativo legible unico por tenant y anio, sucursal origen, sucursal destino, estado fisico e items. `getByNumber` debe buscar por `tenantId + number`, ya que distintos tenants pueden compartir el mismo correlativo. `InventoryTransferItem` conserva por producto cantidades solicitadas, despachadas y recibidas como conceptos separados; no debe asumirse que son iguales. `requestedQuantity` debe ser mayor que 0, `dispatchedQuantity` debe ser no negativa y menor o igual a lo solicitado, y `receivedQuantity` debe ser no negativa y menor o igual a lo despachado. Un traslado fisico puede relacionarse con una o varias solicitudes aprobadas mediante referencias a `InventoryTransferRequest`, sin convertir la solicitud monoproducto en multiproducto. El lifecycle fisico minimo es `preparing -> inTransit -> received`, con `cancelled` para cancelacion operativa desde `preparing` o `inTransit`. El repositorio de transferencias solo persiste el traslado y sus transiciones; no modifica `InventoryBalance`, no crea `InventoryMovement` y no genera PDF. Despacho y recepcion futuros deberan orquestar transferencia, movimientos y balance desde application services.

## Supplier

`Supplier` es entidad maestra comun. Administracion mantiene el CRUD maestro y Purchasing consume el mismo Supplier. `SupplierProduct.leadTimeDays` es la fuente de verdad del plazo para una relacion proveedor-producto. `Supplier.leadTimeDays` es un rollup derivado, read-only, con el maximo de las relaciones activas; cuando no existen relaciones activas es `undefined`. `SupplierProduct` tambien contiene supplierSku, costos, unidad de compra, factor hacia unidad base, minimos y proveedor preferido por producto. La unidad de compra depende del proveedor. `SupplierCostTier` representa costos por volumen de proveedor y no se mezcla con precios mayoristas de venta. No crear proveedores independientes por modulo.

## Customer

`Customer` puede estar asociado a `User`. Perfil y autenticacion son dominios relacionados pero distintos. Andy administra perfil, direcciones, metodos guardados y seguridad; Maria consume Customer para compras.

La identidad Customer autenticada se resuelve siempre desde la sesion persistida: Session -> User activo de tipo customer -> Customer activo asociado y del mismo tenant. El checkout no acepta `customerId` ni el tenant de identidad desde la UI. Una compra en el mismo tenant del Storefront guarda `Order.customerId`; una sesion de empleado o de otro tenant no se vincula y el aislamiento de "Mis pedidos" usa el Customer resuelto desde esa misma sesion.

## Customer Payment Methods

`CustomerPaymentMethod` representa un metodo de pago guardado y reutilizable del cliente. `Payment` representa un pago historico de una compra concreta; eliminar un metodo guardado no modifica pagos historicos.

`SavedPaymentMethod` es un alias legacy/de compatibilidad de `CustomerPaymentMethod`, no una segunda definicion de dominio.

Solo simulacion frontend. Nunca guardar full card number, CVV ni PIN. Guardar solo providerPaymentMethodId, brand, last4, vencimiento, cardholderName, estado e isDefault. Backend/pasarela real vendra despues.

## Ecommerce

Guest checkout permitido por defecto. `requireAccountForCheckout` permite al tenant decidir si exige cuenta. En compra invitado, email es obligatorio conceptualmente para seguimiento/envios. Toda Order e-commerce nueva captura el email normalizado en `Order.notificationContact = { emailMode: "send", email }`, tanto para Customer autenticado como para Guest; este snapshot historico no se vuelve a resolver desde `User`, `Customer` o `GuestCustomer`. El telefono del receptor de una entrega a domicilio vive en `Order.deliveryAddress.recipientPhone`, no en `GuestCustomer` ni en referencias libres. Guest tracking usa `trackingToken`. No existe correo real todavia: Dispatch persiste solamente evidencia de entrega simulada.

El tenant publico continua resolviendose por `PublicTenantProvider`; una sesion Customer solo complementa ese contexto. Si ambos tenants no coinciden, la Order no se atribuye al Customer autenticado. Una sesion Customer invalida o inactiva falla cerrada, mientras que la ausencia de sesion conserva el checkout invitado cuando la configuracion lo permite.

El checkout publico actual solo ofrece tarjeta simulada como metodo de aprobacion inmediata. `ecommercePaymentPolicy` es la fuente canonica de metodos inmediatos y el boundary valida el metodo del Payment persistido, no un valor del caller. Primero persiste `Order.pending` y `Payment.pending`; luego confirma atomica e idempotentemente la pareja como `Order.confirmed` y `Payment.approved` junto con sus reservas. Cada `OrderItem.id` incorpora el `idempotencyKey` normalizado del checkout: es estable al reintentar la misma Order y distinto entre Orders. Si no hay stock suficiente, la confirmacion completa se revierte y la pareja inmediata pending se elimina mediante compensacion segura para no dejar basura operacional. Efectivo, transferencia y mixto no deben aprobarse ni limpiarse automaticamente sin un lifecycle explicito.

## Order

`Order` representa pedido, preparacion y entrega. Puede provenir de ecommerce o POS. Puede ser de cliente registrado o invitado. Es compartido por Storefront, POS cuando aplica, Logistics y Customer Tracking.

Para `store_pickup`, `Order.storePickupContact` conserva el snapshot historico obligatorio de quien retira (`recipientName` y `recipientPhone`). El nombre se normaliza y el telefono usa la politica canonica de ocho digitos. Este contacto no es una direccion: `deliveryAddress` permanece exclusivo de `home_delivery` y `storePickupContact` se prohibe para cualquier otra modalidad.

`OrderStatus.pending` representa el estado previo a confirmacion. Una Order confirmada o en un estado posterior no puede regresar a `pending`. La politica de estado inicial es distinta de la matriz de transiciones: `OrderRepository.create` permite solamente `pending` y `confirmed`, mientras `createWithPayment` permite solamente `pending` porque el checkout persiste primero Order+Payment pendientes y usa el boundary de confirmacion de pago. Crear mediante `create` directamente como `confirmed`, o transicionar una Order `pending` a `confirmed`, reserva atomica e idempotentemente cada item cuyo Product sea `physical` y tenga `tracking.stock = true`. Ningun metodo generico de creacion admite estados operativos avanzados, terminales o cancelados. Servicios, productos sin stock y kits sin resolucion de componentes no crean reservas. Cancelar libera solamente el remanente de las reservas existentes, sin modificar stock fisico ni crear movimientos. Esta regla es identica para `ecommerce`, `mobileApp` y `pos`; el canal no decide la semantica de inventario.

La creacion de Order admite `idempotencyKey` opcional. Cuando se proporciona, la key es unica por tenant y se persiste junto con un fingerprint determinista del payload; un retry identico devuelve la misma Order y un payload diferente produce conflicto. El fingerprint incluye tenant, branch, source, identidad customer/guest, estado, entrega/transporte/direccion, `notificationContact`, snapshots de items, cantidades, importes, numero operativo y tracking token; excluye IDs y timestamps generados por el repositorio. `notificationContact` distingue `send + email` normalizado, `not_applicable` y `undefined` legacy/unknown; estos dos ultimos no son equivalentes.

La combinacion `Order.source + deliveryMethod` se valida tambien en el boundary de creacion: `ecommerce` y `mobileApp` admiten exclusivamente `home_delivery`; `pos` admite `immediate`, `store_pickup` y `home_delivery`. Los rechazos ocurren antes de abrir la transaccion y no dejan Order, Payment, reservas ni movimientos parciales. Esta politica no crea lifecycles distintos por canal; `pos + immediate` permanece fuera de Logistics.

La maquina operativa de entrega a domicilio es `confirmed -> preparing -> picking -> packing -> ready_for_dispatch -> dispatched -> delivered`. Picking completa su agregado, mueve la Order a `packing` y crea la Packing persistente en una sola transaccion. Packing es owner exclusivo de `packing -> ready_for_dispatch` para domicilio y `packing -> ready_for_pickup` para retiro; Dispatch conserva `ready_for_dispatch -> dispatched` y `dispatched -> delivered`. El `updateStatus` generico solo confirma, cancela o reintenta el mismo estado; se conserva la cancelacion historicamente admitida desde `dispatched` como excepcion legacy, mientras `delivered` sigue siendo terminal.

Confirmar Dispatch aplica solamente a `home_delivery` con transporte `third_party` u `own_fleet`, Picking completo, reservas stock-tracked consumidas y sin incidencias abiertas. `third_party` exige transportista y guia normalizados; `own_fleet` no exige guia. La operacion es tenant+sucursal+actor scoped, unica por `tenantId + orderId` e idempotente por `operationId` y fingerprint. Dispatch nunca cambia balances, reservas, movimientos, lotes ni seriales: esas mutaciones pertenecen exclusivamente a Picking.

`DispatchRepository.markDelivered` confirma entrega solamente sobre el Dispatch canonico de una Order `home_delivery` cuando ambos agregados estan `dispatched`. Cambia atomicamente Dispatch+Order a `delivered`, persiste `Dispatch.deliveredAt`, es idempotente para el par ya entregado y emite eventos despues del commit. No acepta ni modifica carrier, tracking o transport mode; tampoco toca inventario ni crea otra notificacion.

`StorePickupDeliveryRepository.confirm` es el owner exclusivo de `Order.ready_for_pickup -> delivered` para `store_pickup`. Persiste evidencia canonica con tenant, branch, Order, actor, operationId/fingerprint y `deliveredAt`; la operacion es atomica, permite retry identico y rechaza una segunda entrega u operationId incompatible. No modifica inventario ni crea `InventoryMovement`. Su integracion con UI/application authorization permanece pendiente de la key canonica de permiso de Store Pickup.

Cuando `notificationContact.emailMode = send`, la misma transaccion de Dispatch persiste exactamente una `Notification` email simulada con destinatario, Order, Dispatch, referencia, carrier/guia, deduplication key y timestamps. `Notification.status` sigue representando lectura; `deliveryStatus = simulated_sent` representa entrega simulada. `not_applicable` y `undefined` crean cero notificaciones y retornan respectivamente `not_applicable` y `legacy_unknown_skipped`.

## Sale

`Sale` representa una venta POS. Order y Sale no son sinonimos. Una venta inmediata puede terminar sin logistica; una venta con retiro/envio puede generar Order.

Una Sale sin `sourceOrderId` conserva la salida directa de inventario. Una Sale con `sourceOrderId` solo omite esa salida cuando la Order coincide en tenant, branch, productos y cantidades, no esta cancelada y sus items fisicos con stock estan respaldados por reservas `active` o `consumed` coherentes. Picking sigue siendo quien consume esas reservas y genera los movimientos OUT; confirmar la Sale no modifica la Order ni duplica la salida.

## Delivery

`DeliveryMethod`: immediate, store_pickup, home_delivery. `TransportMode`: none, customer, own_fleet, third_party. No mezclar ambos conceptos. `AddressSnapshot.recipientPhone` es opcional para compatibilidad legacy y para metodos distintos de `home_delivery`; toda creacion `home_delivery` debe incluir un valor no vacio valido segun `validatePhoneNumber`.

## POS

Metodos: cash, card, transfer, mixed. Transferencia simula validacion manual de comprobante. No existe modulo independiente `bank_validator` ni integracion bancaria real.

Las devoluciones calculan la cantidad retornable como cantidad vendida menos cantidades de
Return completados. El caller elige lineas y cantidades, pero no el refund ni el estado final.
Devoluciones sucesivas terminan en `SaleStatus.returned` al agotar todas las lineas; no se
representan como cancelacion. Una anulacion es una operacion total separada, solo para una Sale
completada sin devoluciones previas y, en POS normal, dentro de su turno original aun abierto.

Los refunds se distribuyen sobre los Payment concretos persistidos. Solo cash genera
`CashMovement.out`; card y transfer son refunds mock sin movimiento de efectivo. Payment pasa a
`refunded` unicamente al agotarse todo su importe. Para inventario se reutiliza la huella OUT de
la Sale y se crea IN en la ubicacion historica. Servicios/no-stock no mueven inventario. Hasta que
la venta conserve huella historica suficiente por linea, lote, serial y kit se bloquean de forma
explicita. Cada operacion exitosa produce una nota de credito mock, no un documento fiscal real.

## Cash Shift

Solo puede existir un `CashShift` abierto por `tenantId + userId + branchId`; un mismo usuario
puede operar otra sucursal accesible mediante un turno independiente. Apertura, movimientos y
cierre validan tenant, relaciones, actor y estado dentro de la mutacion autoritativa.

`CashMovement` usa montos positivos y `type` (`in`/`out`) define la direccion. Los pagos POS se
descomponen en metodos concretos incluso cuando el checkout es mixto. La confirmacion de una venta
crea un unico movimiento `in` por la suma de sus pagos `cash`; card y transfer no crean movimientos
de caja. Por ello `CashMovement` es la fuente canonica del efectivo posterior a la apertura y no se
deben sumar `Sale` o `Payment` nuevamente.

El efectivo esperado se calcula en centavos como apertura + movimientos IN - movimientos OUT. El
resumen y el cierre usan la misma funcion pura; el caller del cierre solo entrega el efectivo
contado y nunca un expected cash arbitrario.

## Logistics

Flujo home delivery: `Order.confirmed -> preparing -> picking -> packing -> ready_for_dispatch -> dispatched -> delivered`; para store pickup, Picking tambien entra a `packing` y Packing finaliza en `ready_for_pickup`. Productos service no pasan por Picking. Trazabilidad debe respetar `Product.tracking`.

Cada incremento confirmado de `PickingItem.pickedQuantity` consume solamente el delta desde las allocations persistidas de su `InventoryReservation`, respetando su orden original. El consumo es atomico con la actualizacion del item e idempotente por `operationId`; una reserva multi-ubicacion genera un movimiento OUT por balance/ubicacion consumida y la trazabilidad existente selecciona lote/serie segun `Product.tracking`. Disminuir cantidades ya recogidas y reasignar ubicaciones siguen fuera del contrato.

`InventoryRepository.getPickingFulfillmentTrace` es la lectura tenant+sucursal+Order+Picking scoped de la evidencia ya consumida. Proyecta cada PickingItem y sus movimientos OUT enlazados a la `InventoryReservation`, incluyendo cantidades, ubicacion, lote/vencimiento y serie canonicos cuando existen. No usa `PickingItem.lotId` como evidencia definitiva, no consulta movimientos globales, no inventa allocations y no muta inventario.

Toda operacion de Picking reconstruye `Session -> User activo -> Role del mismo tenant -> Branch activa autorizada -> actor`; tenant, actor y assignee nunca provienen de la UI. La cola y el detalle son read models tenant+sucursal scoped. La asignacion es atomica: el mismo actor puede reintentar y otro actor recibe conflicto. Liberar una asignacion conserva cantidades y reservas, deja `pending` sin progreso o `in_progress` con progreso, y agrega evidencia append-only con actor, motivo y fecha. Las incidencias son persistentes, tenant+sucursal scoped y deben resolverse antes de completar.

La disponibilidad para Picking pertenece a Inventory y distingue reserva propia, reservas ajenas y stock libre por balance/ubicacion/lote/serie. Una Order puede utilizar su reserva y el stock libre, nunca la reserva de otra Order. Completar es un workflow atomico e idempotente que cambia `PickingOrder -> completed`, la Order a `packing` y crea una Packing `in_progress`, sin descontar inventario nuevamente. `immediate` falla cerrado en Picking normal. Packing persiste checklist, peso/bultos y evidencia de etiqueta; tampoco modifica inventario. Su finalizacion atomica produce `ready_for_dispatch` para `home_delivery` o `ready_for_pickup` para `store_pickup`.

## Auth

Frontend simula auth; no es seguridad real. Diferenciar `temporarily_locked` de bloqueo/deshabilitacion administrativa. Nunca mostrar o almacenar password en texto plano. No usar preguntas de seguridad tradicionales.

Despues de login, un Customer vuelve al Storefront publico (`/`) y un Employee/Admin conserva `/inicio`. Un destino de retorno para Customer solo puede apuntar a rutas publicas del Storefront o a `/cuenta` y sus subrutas; destinos operativos se ignoran. Dentro del arbol privado, Customer queda limitado a `/cuenta/*` independientemente de permisos operativos asignados por error.

El header del Storefront deriva su enlace de cuenta desde la sesion existente: Guest ve `Ingresar` hacia `/iniciar-sesion`, Customer ve `Mi Cuenta` hacia `/cuenta/perfil` y Employee/Admin conserva el acceso a `/inicio` sin ser tratado como Customer.

Los cambios de sesion actualizan primero el puntero persistido y despues publican `auth.changed`. `CurrentSessionProvider` reconstruye la identidad desde repositories al montar y ante eventos de auth/user; nunca conserva una reconstruccion anterior si se solapa con un login, logout o cambio de usuario mas reciente. Para Employee la cadena obligatoria es `Session -> User activo -> Tenant activo -> Role existente del mismo tenant`; login y finalizacion MFA tampoco pueden crear una sesion operativa si esa cadena falla. Customer conserva su boundary propio.

## Branch Scope

Empleado puede tener assigned branch, selected branches o all branches. El universo inicial siempre son las branches activas de `User.tenantId`: `all` no cruza tenants y `selected` solo admite `allowedBranchIds` cuyo Branch pertenece al mismo tenant. Toda autorizacion exige `Role.tenantId === User.tenantId` y `Branch.tenantId === User.tenantId`. Branch selector solo aparece cuando puede cambiar de sucursal.

Los flujos privados de Catalog derivan `tenantId` de esa sesion operativa y usan lecturas y
mutaciones tenant-scoped para Product, Category y Unit. No se acepta `tenantId` desde la UI ni se
consulta el dataset global para filtrarlo despues cuando el repository puede reducirlo. Un recurso
de otro tenant se trata como inexistente y no puede editarse, archivarse ni usarse como referencia.

## Delete / Archive

Elementos nunca usados podrian eliminarse fisicamente en el futuro. Elementos con historial deben archivarse.

## Frontend Vs Backend

Frontend actual simula emails, pagos, persistencia, auth, notificaciones e integraciones mediante Repository, MockRepository, MockDatabase, LocalStorage y EventBus.

Backend futuro: API, DB, seguridad real, correo, pasarelas, SAT/FEL, transportistas y bancos.

## Prevencion De Drift Documental

- Si cambia una decision funcional, actualizar este documento.
- Si cambia estructura tecnica, actualizar `docs/ARCHITECTURE.md`.
- Si cambia un patron conceptual de Entity/Repository, actualizar codigo primero y `docs/CONTRACTS.md` si aplica.
- Si cambia flujo Git, actualizar `docs/GIT_WORKFLOW.md`.
- Si cambia ownership, actualizar `docs/MODULE_OWNERSHIP.md`.
- `AGENTS.md` y `CLAUDE.md` deben seguir siendo entry points, no historial acumulado.
