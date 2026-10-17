# administration

## Plan y suscripción modular

La ruta `/administracion/plan` muestra MARJYM Base obligatorio (Q199/mes), E-commerce +
Entregas (Q129/mes) y Reportes avanzados (Q99/mes). Los complementos se guardan en la
suscripción del tenant con `admin.plans.manage`; la lectura exige `admin.plans.read`. El acceso
operativo a nuevas compras de tienda y a reportes avanzados exige capability comercial;
los permisos de rol siguen siendo independientes. Desactivar E-commerce + Entregas no bloquea
Picking, Packing, Dispatch ni tracking de pedidos existentes: esas acciones conservan sus
controles de sesión, tenant, sucursal, permisos, recurso y estado. El historial mensual es
simulado, no fiscal ni evidencia de pago; sus importes son snapshots
por tenant y ciclo. Basic legacy migra sin extras y Enterprise con ambos extras. El Plan Básico
no limita empleados ni sucursales: la pantalla muestra su uso sin cupos. POS está incluido sin
cupo comercial de cajas; permanece la regla operativa de un turno abierto por usuario y sucursal.

| `SaasCapabilityKey` | MARJYM Base | E-commerce + Entregas | Reportes avanzados |
| --- | --- | --- | --- |
| `inventory` | Sí | — | — |
| `purchasing` | Sí | — | — |
| `receiving` | Sí | — | — |
| `pos` | Sí | — | — |
| `ecommerce` | — | Sí | — |
| `delivery` | — | Sí | — |
| `advancedReports` (`reports.advanced`) | — | — | Sí |
| `catalogKits` (`catalog.kits`) | — | — | — |
| `traceabilityLots`, `traceabilityExpiration`, `traceabilitySerials` | — | — | — |

No existe una key comercial `catalog`: el catálogo base y la administración básica se gobiernan
por sus permisos y reglas propias. `delivery` identifica el módulo comprado, pero **no** es un
kill-switch de Logistics para obligaciones ya existentes. El checkout público, que origina un
nuevo pedido Ecommerce, exige `ecommerce` y configuración operativa activa; hoy no hay un
Application Service independiente para crear fulfillment Ecommerce sin una Order previa.

Responsable: Jose

## Territorio del modulo

Este modulo desarrolla su funcionalidad propia sin duplicar contratos compartidos.

El alcance completo del modulo, los contratos verificados, los bloqueantes y el orden de trabajo
estan en `SCOPE.md`.

## Contracts que consume

UserRepository, RoleRepository, BranchRepository, BusinessConfigRepository, TenantRepository, SupplierRepository, BankAccountRepository, CustomerRepository, AuditLogRepository, CashShiftRepository, SalesRepository, OrderRepository, InventoryRepository, ReceiptRepository, IncidentTypeRepository, PurchaseOrderRepository, PaymentRepository, ProductRepository, AuthRepository

## Usuarios (admin-users)

Implementado en esta rama (`feature/admin-users`):

- Administracion de Employees (nunca Customers) reutilizando el Auth existente de Andy --
  `inviteEmployee`/`activateEmployeeAccount` ya existian, este modulo nunca crea `AuthAccount`
  directamente.
- Dos contratos Auth nuevos, chicos y aditivos (autorizados para esta misma rama):
  `getEmployeeAuthSummariesByUserIds` (lectura batch, nunca N+1) y `revokeAllSessionsByUserId`
  (se dispara solo cuando cambia `status`/`roleId`/`allowedBranchIds`, nunca en updates de solo
  nombre/telefono).
- `UserRepository` gana `listByTenant`/`getByIdScoped`/`updateScoped` (mismo patron que
  `RoleRepository` de PR #88) sin tocar los metodos existentes.
- Delegacion de privilegios al asignar Role: mismo `ensureDelegatablePermissions` de PR #88,
  ahora tambien sobre el Role completo (`ensureDelegatableRole`) -- un actor no puede asignar un
  Role con permisos que el mismo no tiene, sin excepcion de "super admin"/`isSystem` (no existe
  ese concepto en el codigo, se busco explicitamente de nuevo).
- Branch access vive en `User.allowedBranchIds`, no en `Role.branchScope` (PR #88 ya saco esa
  responsabilidad del Role).
- Email unico globalmente para Employees, misma politica que ya usa `login()`
  (`UserRepository.getByEmail`, sin `tenantId` a proposito).
- `User.status` (laboral) vs `AuthAccount.status` (tecnico) vs `Role.status` (disponibilidad del
  rol) nunca se mezclan en la UI.
- Ruta privada `/administracion/usuarios` y entrada de navegacion con `admin.users.manage`.

Detalle completo (justificacion de cada decision, seccion por seccion del ticket original) en
`SCOPE.md`, seccion 12.12.

## Roles y permisos

Implementado en esta rama (`feature/admin-roles-permissions`, sobre el contrato de
`chore/admin-role-contracts`):

- Listado de roles aislado por el `tenantId` de la sesion; alta, edicion y archivado mediante
  services separados sobre `RoleRepository`.
- Enforcement de `admin.roles.manage` para mutar; `admin.roles.read` o `admin.roles.manage` para
  consultar. La entrada de navegacion se protege con `manage`, mismo criterio que Sucursales.
- Los permisos de un rol nunca son texto libre: el formulario ofrece un checkbox por permiso,
  agrupado por modulo, sobre el catalogo completo de `src/config/permissions.ts`
  (`permissionsConfig`). El service valida igual que cada key exista en ese catalogo.
- Sin presets de arranque a proposito: los roles por defecto (Administrador, Inventario, Cajero,
  Bodeguero, Cliente) ya existen sembrados y son `isSystem`; ofrecer plantillas que los imitan en
  el alta seria redundante. "Nuevo rol" arranca en blanco -- el administrador arma el suyo permiso
  por permiso.
- Cada rol expone su detalle de permisos en modo lectura ("Ver permisos" en `RoleTable`), incluidos
  los `isSystem`, que no tienen boton de editar -- sin esto no habria forma de inspeccionar los
  permisos de un rol protegido desde la UI.
- Los roles `isSystem: true` (los del seed) quedan protegidos: no se pueden editar ni archivar
  desde esta pantalla (`ensureRoleNotSystem` en `serviceHelpers.ts`). El repositorio en si es CRUD
  generico y no aplica esta regla -- vive en la capa de aplicacion.
- `Role.status` (`RoleStatus`) es nuevo (ver `chore/admin-role-contracts`); archivar un rol no
  revoca el acceso de las cuentas que ya lo tienen asignado, solo evita asignarlo a cuentas nuevas.
- Auditoria en alta, edicion y archivado (`role.created` / `role.updated` / `role.archived`).
- Ruta privada `/administracion/roles-permisos` y entrada de navegacion con `admin.roles.manage`.
- **PR #88 -- Role vs User:** `branchScope` sale del formulario Create/Edit (`RoleInputDto` ya no
  lo incluye); `CreateRoleService` lo fija a `"assigned"` sin exponerlo como decision funcional.
  El campo sigue en `Role`/`RoleRepository` -- lo siguen leyendo Auth, POS, Picking/Dispatch y
  Caja, no se puede borrar sin romperlos. Que sucursales puede operar un usuario queda para
  `admin-users` (`User.roleId` + sucursales asignadas), no para el Rol.
- **PR #88 -- delegacion de privilegios:** un actor con `admin.roles.manage` solo puede otorgar
  permisos que el mismo posee (`ensureDelegatablePermissions`, subset literal contra la sesion
  actual). No existe un bypass de "super admin"/`isSystem` -- se busco explicitamente y no hay
  ningun concepto asi en el codigo, asi que no se invento ninguno.
- **PR #88 -- estado editable:** Create/Edit solo ofrece `active`/`inactive`; `archived` se
  rechaza si llega por ese camino, incluso via llamada directa al service. Solo
  `ArchiveRoleService` archiva.

## Configuracion del negocio

Implementado en esta rama:

- Formulario de capacidades operativas y trazabilidad por defecto del tenant.
- Presets de ferreteria, farmacia, abarroteria y servicios, con ajustes personalizados.
- Coherencia entre control de inventario, capacidades dependientes y tracking de productos.
- Lectura y actualizacion mediante `BusinessConfigRepository`, resuelto por `RepositoryProvider`.
- Sincronizacion de cambios mediante el evento `business-config.changed`.
- Ruta privada `/administracion/configuracion-negocio` y entrada de navegacion con permiso de administracion.
- Enforcement del permiso `admin.business_config.manage`: `SaveBusinessConfigService` recibe los
  permisos de la sesion y rechaza el guardado sin ese permiso; la pantalla ademas no renderiza el
  formulario. Ocultar el menu no se considera enforcement porque la configuracion es tenant-wide.

## Clientes

Pantalla de solo lectura: la administración únicamente puede **ver** el listado de clientes
ordenado por frecuencia de compra. No hay alta, edición ni archivado desde acá.

Implementado en esta rama:

- Listado comercial de clientes aislado por el `tenantId` de la sesión, con búsqueda por código,
  nombre o correo y filtro por estado, ordenado por cantidad de compras descendente.
- `purchaseCount` se calcula en `GetCustomersService` sumando `Order` (e-commerce) y `Sale`
  (mostrador) por `customerId`, excluyendo `cancelled` en ambos. `Order + Sale` vinculadas por
  `sourceOrderId` cuentan una sola vez cuando la Order relacionada ya fue contabilizada para el
  mismo cliente; una `Sale` legacy con `sourceOrderId` inexistente o no contabilizable se cuenta
  una vez si es válida.
- `GetCustomersService` lee `Customer`, `Order` y `Sale` mediante boundaries tenant-scoped
  (`listByTenant`) en los repositorios compartidos. No usa `getAll()` global ni carga registros de
  otros tenants para luego filtrarlos en memoria.
- Único permiso `admin.customers.read`; no hay permiso administrativo de gestión. La entrada de
  navegación usa el mismo permiso que el service, sin la ambigüedad manage-vs-read que tenían otras
  pantallas de este módulo.
- Sin mutaciones: no se crean, editan ni archivan clientes desde Administration, y por lo tanto no
  hay auditoría (`customer.created/updated/archived`) que emitir desde acá.
- Refresco reactivo ante `customer.changed`, emitido por el módulo `customer` (self-service) cuando
  el cliente edita su propio perfil.
- Segmentos fuera de alcance porque no existe `CustomerSegmentRepository`.
- Ruta privada `/administracion/clientes` y entrada de navegación con `admin.customers.read`.

### Contrato de integracion

Lo que esta pantalla expone al resto del sistema:

- Ruta `/administracion/clientes` e item `administration-customers` en la navegación de
  Administración, protegido por `admin.customers.read`.
- Permiso `admin.customers.read`, declarado en `permissions.ts` y asignado a `role-admin` en el
  seed demo.
- Refresco reactivo ante el evento `customer.changed`.
- No emite eventos ni acciones de auditoría propias: es solo lectura.

Lo que asume de la plataforma:

- `useCurrentSession()` entrega el `tenantId` y los permisos efectivos.
- `RepositoryRegistry` expone `customers`, `orders` y `sales` como fuentes de lectura.

Decisiones abiertas y coordinacion:

- Si en el futuro se necesita distinguir canal (online vs. mostrador) en el ranking, o un rango de
  fechas, hay que ampliar `GetCustomersService` -- sigue sin requerir contrato nuevo en `core`
  mientras la fuente siga siendo `orders`/`sales` ya expuestos.
- Los segmentos permanecen fuera de alcance hasta contar con `CustomerSegmentRepository`.

## Diseno E-commerce

Implementado en esta rama:

- Formulario tenant-wide para habilitar la tienda, definir su nombre y configurar el acceso de
  clientes e invitados.
- Seleccion de metodos de pago y entrega basada exclusivamente en `PaymentMethod` y
  `DeliveryMethod`, con validacion previa a la normalizacion.
- Selector de sucursal predeterminada con las sucursales activas del tenant. Si la seleccion
  persistida ya no esta activa, se muestra y conserva hasta que el usuario la cambie.
- Lectura y actualizacion mediante `BusinessConfigRepository`, sin enviar `tenantId`, `createdAt`
  ni `updatedAt` en el payload de guardado.
- Enforcement de `admin.ecommerce_config.manage` dentro de los services de lectura y escritura.
- Diseño E-commerce requiere además `SaasCapabilityKey.ecommerce` en navegación, ruta privada y
  services de lectura/escritura. Al desactivar el complemento se oculta y se deniega el acceso,
  pero `EcommerceConfig` permanece intacta para una eventual reactivación. Reactivar el
  complemento no fuerza `EcommerceConfig.enabled`: la tienda pública requiere ambas condiciones.
- Auditoria mediante `ecommerce_config.updated` y refresco reactivo ante
  `business-config.changed`.
- Ruta privada `/administracion/diseno-ecommerce` y entrada de navegacion con permiso y capability.

### Contrato de integracion

Lo que esta pantalla expone al resto del sistema:

- Ruta `/administracion/diseno-ecommerce` e item `administration-ecommerce-config` en la
  navegacion de Administracion.
- Permiso `admin.ecommerce_config.manage` para leer y modificar la configuracion.
- Accion de auditoria `ecommerce_config.updated`, con `entityType: "EcommerceConfig"`.
- Refresco ante el evento compartido `business-config.changed`.

Lo que asume de la plataforma:

- `useCurrentSession()` entrega el `tenantId`, el `id` del actor y los permisos efectivos.
- `RepositoryRegistry` expone `businessConfig`, `branches` y `auditLogs`.
- La fila de `EcommerceConfig` del tenant ya existe en el seed; el contrato no ofrece `create`.

Decisiones abiertas y coordinacion:

- El branding sigue pendiente porque `EcommerceConfig` no tiene un campo `theme`. La trazabilidad
  pertenece a Configuracion del negocio y el diseño visual del storefront al modulo propietario.
- `business-config.changed` tambien se emite al cambiar capacidades; este over-refresh es
  inofensivo y el borrador local no se reemplaza cuando tiene cambios sin guardar.
- `SaveBusinessConfigService` no registra auditoria actualmente, una inconsistencia preexistente
  que debera resolverse por separado.
- `admin.ecommerce_config.manage` es un permiso nuevo. Se esperan colisiones en `permissions.ts`,
  `demoSeed.ts`, `navigation.ts`, `serviceHelpers.ts`, `README.md` y `SCOPE.md` con
  `feature/admin-branches`, `feature/admin-bank-accounts`, `feature/admin-suppliers` y
  `feature/admin-audit-log`; deben resolverse conservando las entradas de todas las pantallas.

## Auditoria (pantalla removida)

La pantalla `/administracion/auditoria` (listado de solo lectura sobre `AuditLogRepository`) se
removio por decision de producto: exponia `login_success`/`login_failed` de **todos** los usuarios,
incluyendo clientes (`MockAuthRepository.logAuthAudit` escribe en el mismo `db.auditLogs` que leia
esta pantalla), lo cual se considero demasiado invasivo para el valor que aportaba.

Se eliminaron: `AuditLogPage`, `useAuditLogs`, `AuditLogTable`, `AuditLogFilters`,
`GetAuditLogsService`, `AuditLogMapper`, `AuditLogDto`, el permiso `admin.audit.read`, la entrada de
navegacion `administration-audit` y la ruta privada.

**Lo que NO se toco, a proposito:** `AuditLogRepository`, `MockAuditLogRepository` y el metodo
`append()` siguen intactos. Sucursales, Proveedores y Cuentas bancarias siguen escribiendo su propio
rastro de auditoria en alta/edicion/archivado (ver sus secciones) -- eso es trazabilidad de negocio
legitima, no el problema de privacidad detectado. Tampoco se toco `logAuthAudit` en
`MockAuthRepository`: el conteo de intentos fallidos (`account.failedLoginAttempts`) vive en un
campo propio de la cuenta, no depende de leer `auditLogs`, asi que remover esta pantalla no afecta
el lockout de seguridad.

## Proveedores

Implementado en esta rama:

- Listado del maestro de proveedores aislado por el `tenantId` de la sesion.
- Alta, edicion y archivado mediante services separados sobre `SupplierRepository`; el archivado
  usa el metodo de contrato `archive(id)` y conserva el historial.
- Enforcement de `admin.suppliers.manage` dentro de todos los services, tanto para leer como para
  mutar.
- Normalizacion antes de validar: los textos opcionales vacios se convierten a `undefined`, el
  correo se recorta y pasa a minusculas, y luego se validan nombre, estado y formato de correo.
- `Supplier.leadTimeDays` se expone solo como rollup derivado de las relaciones activas de
  `SupplierProduct`; no forma parte del formulario ni del DTO de escritura administrativo.
- Auditoria append-only en alta, edicion y archivado mediante `AuditLogRepository`.
- Sincronizacion mediante el evento `supplier.changed` que emite `MockSupplierRepository`.
- Tabla con `DataTable`, formulario en `Modal`, confirmacion de archivado y estados resueltos con
  `StatusBadge`.
- Ruta privada `/administracion/proveedores` y entrada de navegacion con
  `admin.suppliers.manage`.

### Contrato de integracion

Lo que esta pantalla expone al resto del sistema:

- Ruta `/administracion/proveedores` y el item `administration-suppliers` en la navegacion de
  Administracion.
- Acceso de lectura y escritura protegido por `admin.suppliers.manage`; no existe un permiso
  separado de lectura.
- Acciones de auditoria `supplier.created`, `supplier.updated` y `supplier.archived`, con
  `entityType: "Supplier"`.
- Recarga reactiva ante el evento `supplier.changed`.

Lo que asume de la plataforma:

- `useCurrentSession()` entrega un usuario con `tenantId` e `id`, ademas de los permisos efectivos.
- `RepositoryRegistry` expone `suppliers` y `auditLogs` con los contratos compartidos vigentes.
- `config/statuses.ts` contiene las etiquetas para los valores de `SupplierStatus`.

Decisiones abiertas y coordinacion:

- Compras mantiene una vista de solo lectura sobre la misma entidad `Supplier`; no debe duplicar el
  maestro ni sus contratos.
- El orden definitivo del item en el menu se resolvera al integrar las pantallas paralelas.
- Se esperan colisiones de integracion en el array de permisos de `role-admin`, `navigation.ts`,
  `serviceHelpers.ts`, `README.md` y `SCOPE.md` con `feature/admin-branches` y
  `feature/admin-bank-accounts`; deben resolverse conservando las entradas de las tres pantallas.

## Consumo de la configuracion en otros modulos

La configuracion no describe al negocio: lo restringe. Los modulos consumidores la leen por
`BusinessConfigRepository` y no pueden ofrecer lo que esta deshabilitado.

- `supportsServices` y `supportsKits` limitan los tipos de producto que catalog permite crear.
- `supportsUnitsAndPackaging` desactivado obliga a una unica unidad por producto: la unidad de
  venta es la de inventario y no se persisten equivalencias.
- `supportsProductAttributes` desactivado oculta y descarta los atributos del producto.
- `supportsInventory`, `supportsLots`, `supportsExpiration` y `supportsSerials` acotan el tracking.

Un producto ya guardado con un tipo que despues se deshabilito conserva su tipo y puede editarse;
lo que se bloquea es crear uno nuevo o cambiar un producto hacia un tipo deshabilitado.

## Caja

La pantalla `/administracion/caja` expone un visor de conciliación de turnos de caja. Se integra
en la navegación como `administration-cash`, exige el permiso nuevo `admin.cash.read` y se
actualiza cuando recibe el evento `cash-shift.changed`.

La consulta muestra apertura, monto esperado, conteo, diferencia y estado. No abre ni cierra
turnos, no registra movimientos, no ajusta conciliaciones y no escribe auditoría. El desglose de
movimientos tampoco está disponible porque el contrato actual no expone lectura de
`CashMovement`.

### Contrato de integracion

La feature asume:

- `useCurrentSession()` para resolver `tenantId`, actor, permisos y estado de sesión. El service
  recarga el `User` y su `Role` para aplicar el `branchScope` real mediante
  `canUserAccessBranch()` antes de devolver resultados.
- `RepositoryRegistry.cashShifts` como fuente principal, más `branches` y `users` únicamente
  para resolver nombres dentro del mismo tenant.
- `formatCurrency` y `formatDate` de `shared/utils` para presentar montos y fechas.

Decisiones y coordinación:

- Caja es 100% solo lectura por decisión de producto. Un eventual ajuste necesita un método nuevo
  en `CashShiftRepository`, acordado con Riquelme como dueño del dominio de caja.
- `GetCashShiftsService` consulta por tenant y restringe cada turno al alcance `assigned`,
  `selected` o `all` del Role del actor. El filtrado visual nunca es la frontera de autorización.
- El contrato actual no permite consultar el desglose de movimientos.
- `admin.cash.read` es un permiso nuevo. Se esperan colisiones en `permissions.ts`,
  `demoSeed.ts`, `navigation.ts`, `serviceHelpers.ts`, `README.md` y `SCOPE.md` con las ramas
  `feature/admin-branches`, `feature/admin-bank-accounts`, `feature/admin-suppliers`,
  `feature/admin-audit-log`, `feature/admin-ecommerce-config` y `feature/admin-customers`; al
  integrarlas deben conservarse todas las entradas.

## Dashboard

La ruta `/administracion/dashboard` expone un resumen ejecutivo de solo lectura y se integra en la
navegación como `administration-dashboard`. Requiere el permiso nuevo
`admin.dashboard.read` y se refresca ante `sale.changed`, `order.changed`, `stock.changed` y
`receipt.changed`.

La pantalla agrega ventas del día y del mes calendario local, alertas de stock, pedidos que esperan
atención operativa y las cinco incidencias de recepción más recientes. No expone operaciones de
escritura. Esta rama también agrega `KPICard` como componente shared puramente presentacional;
su API acepta etiqueta, valor, texto secundario, tono y estado de carga.

### Contrato de integracion

La feature asume:

- `useCurrentSession()` para resolver `tenantId`, permisos y estado de sesión.
- `RepositoryRegistry.sales`, `orders`, `branches`, `receipts` e `incidentTypes` con sus
  contratos vigentes.
- `formatCurrency` y `formatDate` de `shared/utils` para presentar montos y fechas.

Decisiones y coordinación:

- Lee contratos compartidos de Riquelme (`sales`), María (`orders`) y Melbyn (`inventory`,
  `receipts`). Si esos contratos cambian, esta agregación debe revisarse.
- El KPI de stock NO recalcula disponibilidad por su cuenta: instancia
  `GetInventoryAlertsService` (módulo `inventory`, dueño de la disponibilidad canónica —
  físico + reservas + lotes + vencimiento + seriales + kits derivados) una vez por sucursal activa
  del tenant y suma `kpis.outOfStock`/`kpis.lowStock`. Administration no mantiene una segunda regla
  de bajo stock.
- El KPI de "pedidos pendientes" reutiliza `OrderRepository.getPendingForLogistics()` (la cola
  operativa real: `confirmed`, `preparing`, `picking`, `packing`, `ready_for_dispatch`), no
  `OrderStatus.pending` en solitario — ese estado todavía no entró a operación.
- `KPICard` es un componente shared nuevo y presentacional; coordinar su evolución si otro equipo
  necesita ampliar la API.
- Con el seed actual, ventas de hoy y del mes muestran cero porque todos los `createdAt` son
  `2026-01-01T12:00:00.000Z`. No se reemplaza el calendario real por una ventana móvil.
- `admin.dashboard.read` es un permiso nuevo. Se esperan colisiones en `permissions.ts`,
  `demoSeed.ts`, `navigation.ts`, `serviceHelpers.ts`, `README.md` y `SCOPE.md` con las ramas
  previas de administration; al integrarlas deben conservarse todas las entradas.

## Reportes

La ruta `/administracion/reportes` expone como **reportes básicos de MARJYM Base** los listados,
filtros y totales existentes de ventas, compras, movimientos de inventario y pagos. Se integra en
la navegación como `administration-reports` y exige `admin.reports.read`, pero no el complemento
avanzado. La **única funcionalidad avanzada implementada actualmente** es exportar el resultado
visible como Excel (`.xlsx`): requiere tanto `admin.reports.export` como
`SaasCapabilityKey.advancedReports` en la UI y en el service. No existen aún dashboards,
comparativas ni otros reportes premium. La pantalla se refresca ante `sale.changed`,
`purchase-order.changed`, `inventory.changed` y `payment.changed`.

La pantalla solo consulta contratos compartidos y agrega sus resultados en memoria. No persiste
reportes, no modifica las fuentes y no escribe auditoría. El helper de exportación vive dentro de
`administration` (`reportXlsx.ts`, sobre `exceljs`, mismo patrón que
`inventory/exportInventoryMovementsXlsx.ts`); no se promovió a `shared` porque esta entrega no
establece una API transversal. Al ser un archivo binario `.xlsx` (no texto plano), no depende de
BOM ni de codificación para los acentos y permite aplicar bordes y estilo real de tabla, algo que
un CSV no soporta.

### Contrato de integracion

La feature asume:

- `useCurrentSession()` únicamente para estados visuales. `GetReportsService` vuelve a resolver la
  sesión, el actor, su tenant y el Role mediante `auth`, `users` y `roles`; ni lectura ni exportación
  aceptan `tenantId` o permisos declarados por el caller.
- `RepositoryRegistry.sales`, `purchaseOrders`, `inventory`, `payments`, `branches`, `suppliers`
  y `products` con sus contratos vigentes.
- `formatCurrency` y `formatDate` de `shared/utils` para presentar montos y fechas.

Decisiones y coordinación:

- Lee contratos de Riquelme (`sales`, `payments`) y Melbyn (`purchaseOrders`, `inventory`,
  `suppliers`, `products`). Si cambian, esta agregación debe revisarse.
- La generación y descarga del Excel permanecen como helpers module-local.
- Compras permite filtrar por sucursal y movimientos por producto, usando los IDs ya disponibles
  en las entidades consultadas.
- Los rangos y las fechas exportadas usan el mismo día calendario local que muestra la tabla.
- Los totales de ventas incluyen únicamente ventas `completed`; los de compras excluyen
  `draft` y `cancelled`. La UI identifica expresamente los registros excluidos y la semántica del
  monto para no presentarlos como un total financiero indiferenciado.
- La mayoría de fechas del seed son `2026-01-01`; hay que ajustar el rango de fechas para ver esos
  datos en la demo.
- `admin.reports.read` y `admin.reports.export` son permisos nuevos. Se esperan colisiones en
  `permissions.ts`, `demoSeed.ts`, `navigation.ts`, `serviceHelpers.ts`, `README.md` y `SCOPE.md`
  con las ocho ramas previas de administration; al integrarlas deben conservarse todas las
  entradas.

## Sucursales

Implementado en esta rama:

- Listado aislado por el `tenantId` de la sesion y mapeado a un DTO propio del modulo.
- Alta, edicion y archivado mediante services separados; archivar cambia el estado a `archived`
  y conserva el registro y sus referencias.
- Enforcement de lectura en `GetBranchesService`: acepta `admin.branches.read` o
  `admin.branches.manage`. Las mutaciones exigen `admin.branches.manage` dentro del service.
- La UI distingue sin acceso, solo lectura y gestion completa según esos permisos.
- Navegacion y services comparten semantica: como `NavigationItem.permission` es un unico string y
  no hay mecanismo de "cualquiera de estos permisos", la entrada del menu se protege con
  `admin.branches.manage` (el permiso que tiene la audiencia real). El camino de solo lectura del
  service queda como capa defensiva para un futuro rol read-only.
- Auditoria obligatoria en alta, edicion y archivado mediante `AuditLogRepository`.
- Validacion del dato recibido antes de normalizar codigo, nombre y campos opcionales.
- Sincronizacion de la lista y del selector activo mediante el evento `branch.changed` que ya
  emite `MockBranchRepository`.
- Tabla con `DataTable`, formulario en `Modal` y estados resueltos mediante `StatusBadge`.
- Ruta privada `/administracion/sucursales` y entrada de navegacion con
  `admin.branches.manage`.

El tipo de una sucursal existente permanece editable porque el contrato actual no define una
restriccion adicional. Si inventario o usuarios asignados requieren bloquear ese cambio, debe
acordarse como una regla de dominio explicita antes de implementarla.

Reactivar una sucursal archivada desde la edicion es una accion soportada e intencional: se cambia
su `status` mediante `UpdateBranchService`, sin crear una operacion paralela. La auditoria conserva
la accion `branch.updated` y `metadata.previousStatus` permite distinguir cuando el estado anterior
era `archived`.

### Contrato de integracion

Lo que esta pantalla expone al resto del sistema:

- Ruta privada `/administracion/sucursales` y un item de navegacion bajo "Administracion"
  protegido por `admin.branches.manage`.
- Permisos `admin.branches.read` y `admin.branches.manage`, declarados en `permissions.ts` y
  asignados a `role-admin` en el seed demo. Los services aceptan cualquiera de los dos para
  lectura; la navegacion se protege con `manage` (ver "Sucursales" arriba).
- Escrituras de auditoria con las acciones `branch.created`, `branch.updated` y `branch.archived`
  sobre `entityType: "Branch"`.
- Reutiliza el evento `branch.changed` que ya emite `MockBranchRepository`; cualquier consumidor
  del listado o del `BranchSelector` se sincroniza con ese evento.

Lo que esta pantalla asume de la plataforma:

- Sesion resuelta con `tenantId` y `user.id`; sin eso la pantalla queda en estado de error.
- `RepositoryRegistry` provee `branches` y `auditLogs`.
- `config/statuses.ts` define los estados `active`, `inactive` y `archived`.

Decisiones abiertas para la integracion con los demas modulos:

- Alcance de `admin.branches.read` en otros roles: por ahora solo `role-admin`; depende de la
  matriz de roles que consensue el equipo.
- Mecanismo canonico de navegacion multi-permiso: hoy `NavigationItem.permission` es un unico
  string. Soportar "cualquiera de estos permisos" (para que un rol read-only vea el item con solo
  `admin.branches.read`) es un cambio transversal en `src/shared` (tipo + `filterNavigationItemsByPermissions`)
  que afecta a todos los modulos; queda fuera de esta pantalla.
- Orden definitivo del item "Sucursales" dentro del grupo "Administracion" cuando aterricen las
  demas pantallas del modulo.
- Bloquear el cambio de `type` de una sucursal con inventario o usuarios asignados: es una regla
  de dominio cross-modulo y debe acordarse antes de implementarla.
- La sesion demo esta fijada a un cajero; recorrer la pantalla en la demo requiere un switcher de
  rol o de usuario, que es responsabilidad del shell/plataforma.

## Cuentas bancarias

Implementado en esta rama:

- Maestro de cuentas bancarias aislado por el `tenantId` de la sesion y mapeado a un DTO propio
  del modulo.
- Alta, edicion y archivado mediante services separados; archivar cambia el estado a `archived`
  y conserva el registro y sus referencias historicas.
- Enforcement en la capa de aplicacion: `admin.bank_accounts.manage` es el unico permiso que
  expone el repositorio, asi que lectura y mutaciones lo exigen dentro del service. La pantalla
  ademas no renderiza el maestro sin ese permiso.
- Auditoria obligatoria en alta, edicion y archivado mediante `AuditLogRepository`
  (`bank_account.created` / `bank_account.updated` / `bank_account.archived`). La metadata solo
  incluye `accountNumberMasked` (nunca `accountNumber` completo); tampoco viaja en el payload del
  evento `payment.changed`, que solo lleva `entityId` / `tenantId` / `action`.
- Validacion del dato recibido antes de normalizar banco, titular, alias, numero de cuenta,
  tipo, moneda, estado y `branchIds`.
- `accountNumber` es la fuente de verdad (numero completo, necesario para futuros flujos de
  transferencia/deposito). `accountNumberMasked` se deriva SIEMPRE de `accountNumber` mediante
  `maskAccountNumber` (conserva los ultimos 4 caracteres, p. ej. `123456789012` -> `********9012`):
  no es un input independiente ni se acepta desde el DTO de alta/edicion, para que nunca quede
  desincronizado del numero real.
- En alta, `accountNumber` es obligatorio. En edicion, dejarlo vacio conserva el numero actual (y
  su mascara) sin volver a mostrarlo en el formulario; el listado (`BankAccountTable`) solo
  renderiza `accountNumberMasked`, nunca el numero completo.
- El mock persiste `accountNumber` en texto plano porque el store es ficticio y los datos de
  `demoSeed` son inventados. En un backend real, `accountNumber` debe almacenarse
  protegido/cifrado, los endpoints de listado deben devolver solo `accountNumberMasked`/last4, y
  revelar el numero completo debe exigir autorizacion especifica y no registrarse nunca en logs o
  auditoria (ver punto de auditoria abajo). No se implementa cifrado de cliente en esta rama.
- `branchIds` se valida en `CreateBankAccountService` y `UpdateBankAccountService` contra el
  maestro real, no solo en la UI: cada sucursal debe existir y pertenecer al tenant; las nuevas
  ademas deben estar activas. Las sucursales que la cuenta ya tenia asignadas se conservan aunque
  hoy esten inactivas, pero no se puede agregar una sucursal inactiva o de otro tenant.
- Sincronizacion de la lista mediante los eventos `payment.changed` (que emite
  `MockBankAccountRepository`) y `branch.changed` (para refrescar las opciones de sucursal).
- Tabla con `DataTable`, formulario en `Modal` y estados resueltos mediante `StatusBadge`.
- Ruta privada `/administracion/cuentas-bancarias` y entrada de navegacion con
  `admin.bank_accounts.manage`.

La confirmacion de cada transferencia la hace el cajero en POS (Riquelme). Aca solo se administra
el maestro; no se duplica esa logica.

### Contrato de integracion

Lo que esta pantalla expone al resto del sistema:

- Ruta privada `/administracion/cuentas-bancarias` y un item de navegacion bajo "Administracion"
  protegido por `admin.bank_accounts.manage`.
- El permiso `admin.bank_accounts.manage`, ya declarado en `permissions.ts`, ahora asignado a
  `role-admin` en el seed demo.
- Escrituras de auditoria con las acciones `bank_account.created`, `bank_account.updated` y
  `bank_account.archived` sobre `entityType: "BankAccount"`.

Lo que esta pantalla asume de la plataforma:

- Sesion resuelta con `tenantId` y `user.id`; sin eso la pantalla queda en estado de error.
- `RepositoryRegistry` provee `bankAccounts`, `branches` y `auditLogs`.
- `config/statuses.ts` define los estados `active`, `inactive` y `archived`.
- No existe un evento `bank-account.changed` dedicado: `MockBankAccountRepository` emite
  `payment.changed`, un evento compartido con otros repositorios de pago.

Decisiones abiertas para la integracion con los demas modulos:

- Si `branchIds` debe exigir al menos una sucursal: el contrato no lo define y hoy se permite
  vacio. POS lo necesita para asociar transferencias, asi que conviene acordarlo.
- Orden definitivo del item dentro del grupo "Administracion" cuando aterricen las demas
  pantallas del modulo (colision esperable en `navigation.ts` y en el array de permisos de
  `role-admin` con las otras ramas de administration).
- La sesion demo esta fijada a un cajero; recorrer la pantalla en la demo requiere un switcher
  de rol o de usuario, que es responsabilidad del modulo auth / shell.

## Reglas

- No duplicar entities de `core/`.
- No acceder directamente a LocalStorage.
- Usar repositories desde `RepositoryProvider`.
- Usar `shared/` para componentes globales.
- Crear DTO, Mappers y Services propios dentro del modulo cuando empiece cada feature.

## Estructura futura

```text
administration/
|-- pages/
|-- components/
|-- application/
|   |-- dto/
|   |-- mappers/
|   `-- services/
|-- hooks/
|-- validation/
|-- navigation.ts
|-- permissions.ts
`-- index.ts
```
