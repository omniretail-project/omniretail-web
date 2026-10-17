# Módulo `administration` — Especificación técnica

**Responsable:** José · **Ruta base:** `/administracion` · **14 pantallas**

> Documento de referencia único del módulo. Fusiona la especificación funcional derivada de
> `Arquitectura_Frontend_SaaS.pdf` con los contratos **verificados contra el código**.
>
> Regla de jerarquía (`docs/SOURCE_OF_TRUTH.md`): el código TypeScript actual es la verdad
> ejecutable. Donde el PDF y el código difieren, **manda el código** y la diferencia queda
> registrada en la sección 6. El `README.md` del módulo registra lo ya implementado; este
> documento registra el territorio completo.

---

## 1. Orientación rápida

- No hay backend. Todo vive detrás de los `Repository contracts` de `src/core/repositories`,
  implementados por `Mock*Repository` sobre `MockDatabaseStore` → `localStorage`.
- Se programa **siempre** contra los contratos. Nunca contra `localStorage`, seeds ni assets.
- Este módulo no inventa entidades. Lo que otro módulo posee (`Product`, `Order`) se **lee**
  por su repositorio compartido, jamás se copia.
- Dos pantallas (**Planes y facturación**, **Sincronización**) no tienen modelo definido. Van al
  final; no frenan el resto.
- El acceso a datos se resuelve con `useRepositories()` de
  `@/infrastructure/providers/RepositoryProvider`. El `tenantId` sale de `useCurrentSession()`
  (`@/modules/auth/hooks/useCurrentSession`), montado en `src/app/(private)/layout.tsx`.

---

## 2. Tabla maestra de pantallas

| #   | Pantalla                  | Ruta                                    | Entidad principal             | Estado                              |
| --- | ------------------------- | --------------------------------------- | ----------------------------- | ----------------------------------- |
| 1   | Configuración del negocio | `/administracion/configuracion-negocio` | `BusinessCapabilitiesConfig`  | ✅ **Implementada**                 |
| 2   | Sucursales                | `/administracion/sucursales`            | `Branch`                      | ✅ **Implementada**                 |
| 3   | Proveedores               | `/administracion/proveedores`           | `Supplier`                    | ✅ **Implementada**                 |
| 4   | Cuentas bancarias         | `/administracion/cuentas-bancarias`     | `BankAccount`                 | ✅ **Implementada**                 |
| 5   | Diseño E-commerce         | `/administracion/diseno-ecommerce`      | `EcommerceConfig`             | ✅ **Implementada** — sin branding  |
| 6   | Clientes                  | `/administracion/clientes`              | `Customer`, `CustomerSegment` | ✅ **Implementada** — solo lectura, ranking por frecuencia |
| 7   | Auditoría                 | `/administracion/auditoria`             | `AuditLog`                    | ⛔ Removida — riesgo de privacidad  |
| 8   | Caja                      | `/administracion/caja`                  | `CashShift`, `CashMovement`   | ✅ **Implementada** — solo lectura  |
| 9   | Dashboard                 | `/administracion/dashboard`             | Agregación                    | ✅ **Implementada**                 |
| 10  | Reportes                  | `/administracion/reportes`              | Agregación                    | ✅ **Implementada**                 |
| 11  | Roles y permisos          | `/administracion/roles-permisos`        | `Role`, `Permission`          | ✅ **Implementada** (`feature/admin-roles-permissions`) |
| 12  | Usuarios                  | `/administracion/usuarios`              | `User` (+ `AuthAccount`)      | ✅ **Implementada** (`feature/admin-users`) |
| 13  | Planes y facturación SaaS | `/administracion/planes-facturacion`    | _(sin definir)_               | ⛔ Bloqueada — modelo               |
| 14  | Sincronización            | `/administracion/sincronizacion`        | _(sin definir)_               | ⛔ Bloqueada — modelo               |

---

## 3. Estructura del módulo

Convención **plana**, igual que `catalog` e `inventory`. No carpetas por pantalla.

```text
src/modules/administration/
├── application/
│   ├── dto/            BusinessConfigDto.ts, CreateUserDto.ts, ...
│   ├── mappers/        BusinessConfigMapper.ts, UserMapper.ts, ...
│   └── services/       GetXService.ts, SaveXService.ts, serviceHelpers.ts
├── components/         BusinessConfigForm.tsx, BusinessConfigToggle.tsx, ...
├── hooks/              useBusinessConfig.ts, useUsers.ts, ...
├── pages/              BusinessConfigPage.tsx, UsersPage.tsx, ...
├── validation/         businessConfig.validation.ts, ...
├── navigation.ts       entradas del acordeón "Administración"
├── permissions.ts      define PermissionDefinition[] del módulo
├── index.ts            barrel: exporta solo las pages
├── README.md           registro de lo implementado por rama
└── SCOPE.md            este documento
```

**Nombres:** `Get<X>Service` / `Save<X>Service` / `Create|Update|Archive|Restore<X>Service` ·
`use<X>` · `<X>Page` · `<x>.validation.ts`.

### Patrón obligatorio (three-layer)

```text
Page → Hook → Service → Repository contract → MockRepository → MockDatabaseStore
```

```ts
// Service: recibe el registry por constructor, expone execute()
export class GetBusinessConfigService {
  constructor(private readonly repositories: RepositoryRegistry) {}
  async execute(tenantId: string): Promise<BusinessConfigDto> { ... }
}

// Hook: resuelve el registry del contexto, instancia con useMemo, escucha eventos
const repositories = useRepositories();
const service = useMemo(() => new GetBusinessConfigService(repositories), [repositories]);
useDataEvent("business-config.changed", reload);

// Page: solo consume hooks y compone components/. No toca repositorios ni services.
```

**Regla aprendida en la rama 1:** las invariantes de negocio van en el **service**, no solo en la
página. La UI es una de las formas de entrar al dominio, no la única. Y cuidado con encadenar
normalización + validación: si normalizás primero, la validación no puede fallar nunca.

---

## 4. Contratos verificados

Firmas reales leídas de `src/core/repositories/`.

| Repositorio                 | Métodos                                                                                        | Estado                                             |
| --------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `BusinessConfigRepository`  | `getCapabilities` · `updateCapabilities` · `getEcommerceConfig` · `updateEcommerceConfig`      | ✅ Completo                                         |
| `BranchRepository`          | `getAll` · `getById` · `getActive` · `create` · `update`                                       | ✅ Completo                                         |
| `SupplierRepository`        | `getAll` · `getById` · `getActive` · `getProductsBySupplier` · `create` · `update` · `archive` | ✅ Completo                                         |
| `BankAccountRepository`     | `getAll` · `getActive` · `getById` · `create` · `update`                                       | ✅ Completo                                         |
| `UserRepository`            | `getAll` · `getById` · `getByEmail` · `listByTenant` · `getByIdScoped` · `create` · `update` · `updateScoped` · `updateStatus` | ✅ Completo (`feature/admin-users`) |
| `AuditLogRepository`        | `getByTenant` · `append`                                                                       | Sin filtros funcionales ni paginacion server-side   |
| `TenantRepository`          | `getAll` · `getById`                                                                           | Sin `create` ni `update`                            |
| `CustomerRepository`        | `getAll` · `listByTenant` · `getById` · `getByUserId` · `getByEmail` · `create` · `update`     | Sin segmentos                                       |
| `RoleRepository`            | `listByTenant` · `getByIdScoped` · `create` · `updateScoped` · `archiveScoped`                  | ✅ Completo (`chore/admin-role-contracts`)          |
| `CustomerSegmentRepository` | —                                                                                               | ⛔ **No existe**                                    |

---

## 5. Entidades reales

Copiadas del código, no del PDF. Todas viven en `src/core/entities/`.

### 5.1 CRUD propio de este módulo

```ts
interface Tenant {
  id: string;
  name: string;
  legalName?: string;
  slug: string;
  status: TenantStatus;
  defaultCurrency: CurrencyCode;
  timezone: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

interface Branch {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  type: BranchType; // main | store | warehouse
  address?: string;
  phone?: string;
  email?: string;
  status: BranchStatus; // active | inactive | archived
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
// NO existe `schedule`.

interface BusinessCapabilitiesConfig {
  tenantId: string; // no tiene id ni timestamps
  preset: BusinessPreset;
  supportsInventory: boolean;
  supportsLots: boolean;
  supportsExpiration: boolean;
  supportsSerials: boolean;
  supportsMultipleLocations: boolean;
  supportsUnitsAndPackaging: boolean;
  supportsProductAttributes: boolean;
  supportsKits: boolean;
  supportsServices: boolean;
  defaultProductTracking: ProductTrackingConfig; // { stock, lot, expiration, serial }
}

interface EcommerceConfig {
  tenantId: string;
  enabled: boolean;
  storeName: string;
  requireAccountForCheckout: boolean;
  guestTrackingEnabled: boolean;
  allowedDeliveryMethods: DeliveryMethod[];
  allowedPaymentMethods: PaymentMethod[];
  defaultBranchId?: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
// NO existe `theme`.

interface User {
  id: string;
  tenantId: string;
  customerId?: string;
  employeeCode?: string;
  name: string;
  email: string;
  phone?: string;
  type: UserType; // customer | employee
  status: UserStatus; // active | inactive | blocked | archived
  roleId?: string;
  branchId?: string;
  allowedBranchIds?: string[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

type BranchScope = "assigned" | "selected" | "all";

interface Role {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  isSystem: boolean;
  permissions: string[];
  branchScope: BranchScope;
  status: RoleStatus; // active | inactive | archived -- agregado en chore/admin-role-contracts
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
// `branchScope` vive en Role, NO en User. Role no tiene `preset`.

interface Permission {
  key: string;
  module: string;
  name: string;
  description: string;
}

interface Supplier {
  id: string;
  tenantId: string;
  name: string;
  legalName?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  leadTimeDays?: number; // rollup derivado/read-only de SupplierProduct activos
  status: SupplierStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
// NO existen contacts[], paymentTerms ni currency.
// SupplierProduct.leadTimeDays es el dato específico; Supplier.leadTimeDays es su rollup MAX.

type BankAccountType = "monetary" | "savings";
type BankAccountStatus = "active" | "inactive" | "archived";

interface BankAccount {
  id: string;
  tenantId: string;
  bankName: string;
  holderName: string; // NO accountHolder
  accountNumber: string; // fuente de verdad; NO input editable en Update, no viaja en DTOs de listado
  accountNumberMasked: string; // SIEMPRE derivado de accountNumber (maskAccountNumber), no es input
  accountType: BankAccountType;
  currency: CurrencyCode;
  alias: string; // obligatorio
  branchIds: string[]; // obligatorio
  transferInstructions?: string;
  status: BankAccountStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

interface CustomerSegment {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  active: boolean; // booleano, NO status
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
```

`BusinessPreset` es un **enum** en `src/core/enums`, no una entity:
`hardware_store | pharmacy | grocery | services | custom`.
Sus valores por defecto viven en `src/config/business-defaults.ts` (`custom` excluido).

### 5.2 Compartidas o de solo lectura

```ts
interface Customer {
  id: string;
  tenantId: string;
  userId?: string;
  code: string;
  name: string;
  email: string;
  phone?: string;
  segmentId?: string;
  status: CustomerStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
// NO existe `type: registered|b2b|guest` ni `taxId`.

interface AuditLog {
  id: string;
  tenantId: string;
  actorUserId?: string; // NO userId
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  createdAt: ISODateString; // NO timestamp
}
// NO existe `module`.

interface CashShift {
  id: string;
  tenantId: string;
  branchId: string;
  userId: string; // NO cashierUserId
  registerCode: string; // NO registerId
  status: CashShiftStatus; // open | closed | closed_with_difference
  openedAt: ISODateString;
  openingAmount: number;
  closedAt?: ISODateString;
  expectedAmount?: number;
  countedAmount?: number;
  difference?: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

interface CashMovement {
  id: string;
  cashShiftId: string;
  type: CashMovementType; // in | out
  amount: number;
  reason: string;
  referenceType?: string;
  referenceId?: string;
  createdByUserId: string;
  createdAt: ISODateString;
}

interface Notification {
  id: string;
  tenantId: string;
  userId?: string;
  customerId?: string;
  channel: NotificationChannel;
  type: string;
  title: string;
  message: string;
  status: NotificationStatus;
  relatedEntityType?: string;
  relatedEntityId?: string;
  createdAt: ISODateString;
  readAt?: ISODateString;
}
```

### 5.3 Dominio de Auth (Andy) — solo referencia

La pantalla de Usuarios dispara acciones sobre esto, pero no lo implementa.

```ts
interface AuthAccount {
  id: string;
  userId: string;
  email: string;
  passwordHashMock: string;
  status: AccountStatus; // pending_verification | active |
  // temporarily_locked | password_reset_required |
  // disabled | archived
  failedLoginAttempts: number;
  lockedUntil?: ISODateString;
  passwordChangedAt?: ISODateString;
  lastLoginAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

interface MfaEnrollment {
  id: string;
  userId: string;
  enabled: boolean;
  method: "totp" | "email";
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
```

**Importante:** MFA es una entidad aparte, no un campo de `AuthAccount`. Y los estados que el PDF
pide para Usuarios (`disabled`, `password_reset_required`, `temporarily_locked`) viven en
`AccountStatus`, no en `UserStatus`. La pantalla necesita ambos, y hoy **no hay contrato expuesto
para `AuthAccount`**.

Políticas ya definidas: `src/config/auth-policy.ts` (`maxLoginAttempts: 5`,
`lockDurationMinutes: 15`, `passwordResetTokenMinutes: 30`, `emailVerificationTokenHours: 24`,
override `demoMode`) y `src/config/session-policy.ts` (`normalSessionHours: 8`,
`rememberMeDays: 30`).

---

## 6. Bloqueantes y gaps

1. ~~**`RoleRepository` solo expone `getById`.**~~ **Resuelto en `chore/admin-role-contracts`:**
   ahora expone CRUD tenant-scoped (`listByTenant`, `getByIdScoped`, `updateScoped`,
   `archiveScoped`) y `create`; `Role` ganó `status: RoleStatus` (`active`/`inactive`/`archived`).
   El payload mutable excluye identidad, tenant, `isSystem` y timestamps. La prohibición completa
   de editar/archivar roles sistema y los permisos siguen en los futuros application services.
2. **`Branch` sin `schedule`.** Sucursales no puede manejar horarios sin extender la entity.
3. **`EcommerceConfig` sin `theme`.** Diseño E-commerce no incluye branding.
4. **`Supplier` sin `contacts[]`, `paymentTerms` ni `currency`; `leadTimeDays` es derivado.**
5. **Sin contrato para `AuthAccount` ni `MfaEnrollment`.** Invitación, activación asistida y MFA
   quedan bloqueadas. Esto **sí** es dominio de Andy.
6. **`TenantRepository` sin `update`.** Bloquea escritura de datos del negocio.
7. **Sin `CustomerSegmentRepository`.**
8. **La pantalla de Auditoría se removió.** Exponía `login_success`/`login_failed` de todos los
   usuarios (incluyendo clientes) porque `MockAuthRepository.logAuthAudit` escribe en el mismo
   `db.auditLogs` que leía la pantalla. `AuditLogRepository.append()` sigue en uso por Sucursales,
   Proveedores y Cuentas bancarias para su propio rastro de auditoría; eso no se tocó.
9. **Planes y facturación / Sincronización sin entity.** No inventar; definir en equipo.
10. **El filtro de permisos del Sidebar no está conectado.** `filterNavigationItemsByPermissions`
    existe y funciona, pero `PrivateShell` nunca pasa `allowedPermissions`, así que hoy se ve
    todo el menú. Cae en tu dominio (permisos) y es `shared/`: coordinar.

---

## 7. Discrepancias PDF vs. código

Tabla de traducción. **La columna derecha es la que vale.**

| PDF / guía previa                                       | Código real                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Tenant.tradeName` / `.taxId` / `.defaultBranchId`      | no existen; hay `name`, `slug`, `timezone`                                                             |
| `BusinessCapabilitiesConfig.allow*`                     | `supports*` (y 4 campos más)                                                                           |
| `defaultProductTraceability`                            | `defaultProductTracking`                                                                               |
| `BusinessPreset` como entity                            | enum en `core/enums` + `config/business-defaults.ts`                                                   |
| `EcommerceConfig.guestCheckoutEnabled` / `.theme`       | `guestTrackingEnabled`; `theme` no existe                                                              |
| `EcommerceConfig.enabled*Methods`                       | `allowedDeliveryMethods` / `allowedPaymentMethods`                                                     |
| `Branch.schedule`                                       | no existe                                                                                              |
| `User.displayName` / `.assignedBranchId` / `.branchIds` | `name` / `branchId` / `allowedBranchIds`                                                               |
| `User.branchScope`                                      | vive en `Role.branchScope`                                                                             |
| `Role.preset` / `.status`                               | no existen; hay `isSystem`                                                                             |
| `Permission.action`                                     | `name`                                                                                                 |
| `Supplier.tradeName` / `.nit`                           | `name` / `taxId`                                                                                       |
| `BankAccount.accountHolder`                             | `holderName`                                                                                           |
| `BankAccount.accountNumberMasked` como input editable   | se deriva SIEMPRE de `accountNumber` (`maskAccountNumber`); el DTO de alta/edición usa `accountNumber` |
| `Customer.type` / `.taxId`                              | no existen; hay `code`                                                                                 |
| `AuditLog.userId` / `.timestamp` / `.module`            | `actorUserId` / `createdAt` / no existe                                                                |
| `CashShift.registerId` / `.cashierUserId`               | `registerCode` / `userId`                                                                              |
| `CashShiftStatus: balanced \| discrepancy`              | `open \| closed \| closed_with_difference`                                                             |
| `AuthAccount.mfaRequired` / `.mfaEnabled`               | entity aparte `MfaEnrollment`                                                                          |
| `admin.users.create`                                    | `admin.users.manage`                                                                                   |
| Tipografía Inter                                        | la app usa **Geist** (`src/app/layout.tsx`)                                                            |
| Rama `feature/administration-<tarea>`                   | `feature/admin-<funcionalidad>`                                                                        |

---

## 8. Permisos

Declarados hoy en `permissions.ts` de este módulo:

`admin.users.read` · `admin.users.manage` · `admin.roles.read` · `admin.roles.manage` ·
`admin.branches.read` · `admin.branches.manage` · `admin.business_config.manage` ·
`admin.suppliers.manage` · `admin.bank_accounts.manage` · `admin.cash.read` ·
`admin.customers.read` · `admin.dashboard.read` · `admin.reports.read` ·
`admin.reports.export` · `admin.ecommerce_config.manage`

**No existen** y hay que declararlos al construir sus pantallas:
`users.credentials.reset`

La granularidad del repo es `read` / `manage`, no `create/update/archive`. Mantenerla.

`src/config/permissions.ts` ya agrega `administrationPermissions` al catálogo global.

**Regla dura:** nunca `if (role === "gerente")`. Todo pasa por los `permissions[]` del rol activo.
El rol es una agrupación de permisos, nada más.

---

## 9. Componentes shared: verificado uno por uno

**Disponibles** (tienen `index.tsx`):
`Button` · `Input` · `Select` · `SearchInput` · `FormField` · `DataTable` · `Pagination` ·
`StatusBadge` · `Modal` · `ConfirmDialog` · `PageHeader` · `Toast` · `KPICard`

**Carpeta vacía — hay que construirlos:**
`Accordion` · `Checkbox` · `ContextPanel` · `CurrencyInput` · `DatePicker` · `Drawer` ·
`EmptyState` · `FileUpload` · `IconButton` · `LoadingState` · `NumberInput` ·
`RadioGroup` · `Tabs` · `Textarea`

**No existen ni como carpeta:** `SectionCard` · `FilterChip` · `Breadcrumbs`

Impacto: Dashboard agrega `KPICard`; los formularios complejos necesitan `Tabs` y `Textarea`;
los paneles de detalle necesitan `ContextPanel` o `Drawer`. Estos últimos aún no existen.

**Decisión tomada:** un componente que solo usa este módulo se construye en
`administration/components/`. Promoverlo a `shared/` es área común: requiere
`.ai/skills/shared-component/SKILL.md` y coordinación previa. Así se resolvió el toggle de
Configuración del negocio.

---

## 10. Sistema visual

Tokens reales de `src/styles/tokens.css`. Usar siempre `var(--color-*)`, nunca hex literal.

| Token                    | Valor     | Uso                    |
| ------------------------ | --------- | ---------------------- |
| `--color-app-background` | `#fff2d0` | Fondo de app           |
| `--color-surface`        | `#ffffff` | Superficies y tarjetas |
| `--color-structure`      | `#3e668f` | Sidebar y estructura   |
| `--color-topbar`         | `#1e293b` | Barra superior         |
| `--color-primary`        | `#81a9ee` | Acción primaria        |
| `--color-primary-hover`  | `#6f99de` | Hover primario         |
| `--color-title`          | `#315d8c` | Títulos                |
| `--color-text`           | `#23364d` | Texto base             |
| `--color-text-muted`     | `#7488a6` | Texto secundario       |
| `--color-border`         | `#a8b8f2` | Bordes                 |
| `--color-success`        | `#22a06b` | Éxito                  |
| `--color-warning`        | `#e0a11b` | Advertencia            |
| `--color-danger`         | `#d64545` | Peligro                |

Divergencias con la paleta del PDF: advertencia (`#D99A24` → `#e0a11b`), peligro
(`#DC4C4C` → `#d64545`), y el gris de archivado `#6B7280` **no tiene token**: `archived` se
resuelve con el tono `neutral` de `StatusBadge`.

**Tipografía:** la app carga **Geist** en `src/app/layout.tsx`. No cargar otra fuente desde un
módulo — la tipografía es decisión global.

**Layout:** pantallas de creación complejas (Nuevo usuario, Nuevo rol) van como **página
completa**, nunca modal.

**Estados:** nunca mostrar la key técnica. `src/config/statuses.ts` mapea key → `{ label, tone }`
con tonos `neutral | info | success | warning | danger`. Ya cubre `active`, `inactive`,
`archived`, `blocked`, `open`, `closed`, `closed_with_difference`, entre otros.
**Faltan** las etiquetas de `AccountStatus` (`temporarily_locked`, `password_reset_required`,
`disabled`, `pending_verification`): agregarlas ahí, no en la pantalla.

---

## 11. Reglas de plataforma

- **R-P01** Aislamiento de tenant: ningún registro de una empresa se ve o edita desde otra.
- **R-P02** Todo empleado pertenece a un tenant y tiene un rol principal.
- **R-P03** Acceso efectivo = permiso del rol + alcance de sucursal + estado activo.
- **R-P04** Toda acción sensible genera `AuditLog`. No condicional: siempre.
- **R-P05** Los `id` internos nunca sustituyen códigos comerciales visibles.
- **R-P06** Datos con historial se archivan, no se eliminan.
- **R-P07** Fechas en ISO 8601; se formatean solo en la UI.
- **R-P08** Los mocks respetan exactamente los mismos tipos que las pantallas.
- **R-P09** El storefront usa la marca del tenant. "FerrePharma" es un tenant de ejemplo, no el
  nombre del SaaS.

Sobre alcance de sucursal: aunque el tenant tenga una sola sucursal y otras pantallas oculten el
selector, el modelo **siempre** conserva `branchId`.

---

## 12. Especificación pantalla por pantalla

### 12.1 Configuración del negocio ✅ implementada

Rama `feature/admin-business-config`. Selector de preset + 9 toggles de capacidades + 4 de
trazabilidad por defecto. `BusinessPreset` solo **inicializa** valores (R-C13): el dueño puede
cambiarlos después. Tocar una capacidad a mano manda el preset a `custom`.

Coherencia: con `supportsInventory` apagado, lotes, vencimiento, series y ubicaciones se apagan y
deshabilitan, y toda la trazabilidad queda en `false`. La invariante se valida en
`SaveBusinessConfigService`, no solo en el formulario.

Fuera de alcance: `AttributeDefinition` / `ProductAttributeValue` se gestionan en
`/inventario/atributos` (Melbyn). Acá solo se prende o apaga `supportsProductAttributes`.

### 12.2 Sucursales ✅ implementada

Tabla: `code`, `name`, `type`, `address`, `status`, acciones. Formulario: `code`, `name`, `type`
(`main`/`store`/`warehouse`), `address`, `phone`, `email`, `status`.
Sin `schedule` hasta que se extienda la entity.
Impacto: toda sucursal creada debe aparecer en `BranchSelector` y en el alcance de Usuarios.

### 12.3 Proveedores ✅ implementada

Tabla: `name`, `taxId`, `email`, `phone`, `status`. Formulario: `name`, `legalName`, `taxId`,
`email`, `phone`, `address`, `notes`, `status`.
Un proveedor con historial se **archiva** (R-I06) — `SupplierRepository.archive` ya existe.
Compras (Melbyn) tiene vista de solo consulta sobre la **misma** entity. No duplicar el CRUD.

### 12.4 Cuentas bancarias ✅ implementada

⚠️ El diseño viejo (código/país/contacto de banco) quedó descartado. Modelo vigente: sección 5.1.
Tabla: `bankName`, `holderName`, `alias`, `accountType`, `accountNumberMasked`, `status`. Nunca
`accountNumber` completo en el listado.
Formulario: todos los anteriores + `accountNumber` (número completo, fuente de verdad —
`accountNumberMasked` se deriva automáticamente, no es un campo editable), `branchIds` (sucursales
habilitadas), `transferInstructions`.
Obligatorios: banco, titular, número (solo en alta; en edición vacío = conservar el actual), tipo,
moneda y estado.
Límite: acá se administra el maestro. La confirmación de cada transferencia la hace el cajero en
POS (Riquelme).

### 12.5 Diseño E-commerce ✅ implementada

Campos reales: `enabled`, `storeName`, `requireAccountForCheckout`, `guestTrackingEnabled`,
`allowedPaymentMethods[]`, `allowedDeliveryMethods[]`, `defaultBranchId`.
Sin branding hasta que se agregue `theme`.
No se configura acá la trazabilidad (eso es 12.1) ni el diseño visual del storefront (María).

### 12.6 Clientes ✅ implementada

Vista comercial de solo lectura, ranking por frecuencia de compra. Tabla: `code`, `name`, `email`,
`purchaseCount`, `status`. `purchaseCount` agrega `Order` + `Sale` por `customerId` (lectura
directa vía `RepositoryRegistry`, sin contrato nuevo en `core`). Sin alta, edición ni archivado.
El self-service del cliente (registro, login, direcciones, pedidos propios) vive en el módulo
`customer` de Andy. No duplicar.
Segmentos bloqueados hasta que exista `CustomerSegmentRepository`.

### 12.7 Auditoría ⛔ removida

Se removió por decisión de producto: la pantalla mostraba `login_success`/`login_failed` de
**todos** los usuarios, incluidos clientes, lo cual se consideró demasiado invasivo. El escritor
(`AuditLogRepository.append()`, usado por otros módulos vía R-P04) sigue intacto; solo se quitó la
pantalla de lectura, su service, su permiso (`admin.audit.read`) y su entrada de navegación.

### 12.8 Caja ✅ implementada

Solo consulta y conciliación sobre `CashShift` / `CashMovement` (dueño: POS).
Estados reales: `open`, `closed`, `closed_with_difference`.
Reglas a reflejar, no reimplementar: conteo ciego y comparación contra lo esperado (R-PS06); toda
diferencia requiere motivo y queda auditada (R-PS07).
**Definido:** 100% solo lectura; el ajuste queda bloqueado hasta acordar un método de contrato con
POS (Riquelme).

### 12.9 Dashboard ✅ implementada

KPIs agregados: ventas del día/mes, alertas de stock, pedidos pendientes, últimas incidencias.
Sin reglas propias: 100% agregación vía repositorios ajenos. `KPICard` se agrega en esta rama.

### 12.10 Reportes ✅ implementada

Agrega `Sale`, `PurchaseOrder`, `InventoryMovement`, `Payment` vía repositorios compartidos.
Nunca crear un almacén paralelo de reportes. Dejar para el final.

### 12.11 Roles y permisos ✅ implementada

**Decisión de dominio (PR #88): Role vs User.** `Role` determina `name`/`description`/`status`/
`permissions`. Qué sucursales puede operar un usuario es responsabilidad de `User`
(`roleId` + sucursales asignadas), no del Rol — se resuelve en `admin-users`, no acá.
Create/Edit Role **no** ofrece ni acepta `branchScope`: `RoleInputDto` no incluye ese campo.
`CreateRoleService` fija `branchScope: "assigned"` (el valor más restrictivo del contrato
actual — fail-closed) sin exponerlo como decisión funcional; `UpdateRoleService` no lo toca, así
que un rol conserva el valor con el que nació.

`branchScope` sigue existiendo en `Role` y en `RoleRepository` — **no se borró del dominio**.
Consumidores reales verificados antes de tocar nada (no se puede eliminar sin romperlos):
`core/scopes/userBranchAccess.ts` (`isBranchIdInUserScope`/`canUserAccessBranch`),
`resolveCurrentSessionSnapshot.ts` (auth), `ScopedActiveBranchProvider.tsx` (auth),
`PickingAuthorizationContext.ts` / `DispatchAuthorizationContext.ts` (logistics),
`cashShiftServiceContext.ts` / `returnOperationContext.ts` / `GetPosSalesHistoryService.ts` (pos),
`GetCashShiftsService.ts` (administration). Deuda de migración explícita: cuando `admin-users`
exista, el modelo objetivo es `canPerform = roleHasPermission AND userHasBranchAccess` (dos
chequeos independientes); hoy siguen combinados en una sola función porque `User` todavía no
tiene su propio mecanismo de alcance de sucursal fuera de `Role.branchScope`. No se implementa ese
resolver acá — pertenece a `rbac-foundation`/`admin-users`.

**Delegación de privilegios (seguridad).** Un actor con `admin.roles.manage` solo puede otorgar
permisos que él mismo posee: `requestedPermissions ⊆ actorEffectivePermissions`
(`ensureDelegatablePermissions` en `role.validation.ts`, aplicada en `CreateRoleService` y
`UpdateRoleService`). `actorEffectivePermissions` es el arreglo `permissions` de la sesión actual
(`useCurrentSession()` → mismo valor que ya viajaba a cada service). **No existe en el código un
concepto autoritativo de "super admin"/"platform admin"/bypass por `isSystem`** — se buscó
explícitamente antes de escribir esta regla (grep sin resultados) — así que no se agregó ninguna
excepción: ni siquiera `role-admin` (que hoy NO tiene los 36 permisos del catálogo, solo los
`admin.*`) puede delegar un permiso fuera de su propia lista. Es una limitación real y esperada de
esta entrega, no un bug. El resolver canónico manage→read (`resolvePermission.ts`,
`hasPermission`) existe en `feature/rbac-foundation` pero esa rama no está mergeada ni
reconciliada con ésta — la validación acá es subset literal, sin resolución manage→read; se puede
adoptar `resolvePermission.ts` como follow-up una vez reconciliada esa rama.

**Estado editable.** Create/Edit solo ofrece `active`/`inactive` — `archived` no es un valor
asignable por ese camino (`role.validation.ts` lo rechaza aunque llegue por una llamada directa
al service, no solo oculto en el `<select>`). Archivar es exclusivamente `ArchiveRoleService`
(`archiveScoped`), que conserva tenant scope, `ensureRoleNotSystem`, auditoría y el evento
`role.changed`. Un rol ya archivado no se puede volver a abrir en "Editar" desde esta pantalla
(no hay flujo de reactivación todavía).

**Lectura vs gestión.** `admin.roles.read` navega en modo lectura (ve tabla y "Ver permisos"),
`admin.roles.manage` además puede crear/editar/archivar — ya separado correctamente en
`RolesPage`/`RoleTable` (columna de acciones y botón "Nuevo rol" solo si `canManage`). La entrada
del menú lateral sigue protegida únicamente con `admin.roles.manage`, mismo criterio ya documentado
para Sucursales: `NavigationItem.permission` es un único string sin mecanismo "cualquiera de estos
permisos", así que un usuario con solo `admin.roles.read` no ve el ítem en el Sidebar aunque el
service/página ya lo dejarían entrar por URL directa. No es contradictorio a propósito — es la
misma limitación de plataforma que Sucursales, no algo nuevo de esta pantalla; resolverlo de raíz
(permiso múltiple en `NavigationItem`) es un cambio transversal a `shared/navigation` fuera de
alcance acá.

**Corrección de documentación:** la descripción original del PR #88 mencionaba haber reconciliado
con `docs/RBAC_PLAN.md`. Ese archivo **no está presente en esta rama** (solo existe, sin mergear,
en `feature/rbac-foundation`) — se corrige acá para no afirmar algo falso; la reconciliación real
fue solo sobre el contrato de `RoleRepository` (`chore/admin-role-contracts` + el hardening
posterior), no sobre el documento completo.

Listado: `name`, `branchScope`, detalle de permisos en modo lectura (modal, incluye conteo),
`isSystem`, acciones. El detalle de permisos está disponible para cualquier rol, incluidos los
`isSystem` (que no tienen edición) — es la única forma de inspeccionar qué permisos tiene un rol
protegido.
Editor: selector de permisos agrupado por dominio, con checkbox por permiso — nunca texto libre.
Sin presets de arranque: los roles por defecto (Administrador, Inventario, Cajero, Bodeguero,
Cliente) ya existen sembrados como `isSystem`; una plantilla que los imite sería redundante. "Nuevo
rol" arranca en blanco y el administrador lo arma permiso por permiso.
Validación: un rol no puede quedar sin nombre, sin permisos, ni con una key de permiso que no
exista en el catálogo.
Los roles `isSystem` quedan protegidos: no se pueden editar ni archivar desde esta pantalla — el
contrato `updateScoped` ya excluye `isSystem` del payload editable a nivel de tipo
(`fix(roles): harden tenant and session boundaries`), y los services además rechazan la operación
explícitamente (`ensureRoleNotSystem`) como defensa adicional.
Archivar un rol no revoca el acceso ya otorgado a cuentas existentes, solo impide asignarlo a
cuentas nuevas — no hay un mecanismo de revocación retroactiva en esta entrega.

### 12.12 Usuarios ✅ implementada

**Ownership (§1, admin-users):** administration es owner de `User` Employee (datos, `tenantId`,
`roleId`, `allowedBranchIds`, `User.status`, CRUD/listado, auditoría administrativa). Auth sigue
siendo owner exclusivo de `AuthAccount`, password, login, `EmployeeInvitation`,
`activateEmployeeAccount`, MFA, lockout, recovery, `Session`, `lastLoginAt`. Administration
**nunca** crea ni modifica `AuthAccount` directamente -- reutiliza
`AuthRepository.inviteEmployee(userId)` (ya existía, de Andy) para el alta y dos contratos nuevos,
chicos, agregados en esta misma rama porque `admin-users` los necesita directo:

- `AuthRepository.getEmployeeAuthSummariesByUserIds(tenantId, userIds)`: lectura batch (nunca
  `getById` en loop -- N+1, ver §27) de `{ userId, status: AccountStatus, mfaEnabled, lastLoginAt
  }`. Nunca expone `passwordHashMock`, `failedLoginAttempts`, secretos MFA, recovery codes,
  `MfaChallenge` ni tokens. Ver `AuthRepository.ts` para el detalle de qué pasa con userIds
  cross-tenant/inexistentes/sin `AuthAccount` (los tres se ven igual: ausentes del resultado).
- `AuthRepository.revokeAllSessionsByUserId(tenantId, userId)`: revoca todas las sesiones activas
  de un empleado (no solo la que originó el pedido). Idempotente, tenant-scoped, nunca toca
  sesiones de otro usuario. Se dispara automáticamente desde `UpdateEmployeeService` cuando
  cambia `status`, `roleId` o `allowedBranchIds` -- un update que solo toca nombre/teléfono NO
  revoca nada.

**`UserRepository` endurecido** (§5, mismo patrón que `RoleRepository` de PR #88):
`listByTenant`/`getByIdScoped`/`updateScoped` agregados como métodos NUEVOS; `getAll`/`getById`/
`update`/`updateStatus`/`getByEmail` se conservan sin cambios para no romper consumidores
existentes (p. ej. resolución de sesión, que resuelve `User` antes de tener `tenantId`
disponible). `updateScoped` excluye `tenantId`/`type`/`customerId` del payload editable a nivel de
tipo -- administration nunca puede convertir un Employee en Customer ni mudarlo de tenant editando
un usuario existente.

**Alcance de esta entrega (§29):** solo Employees, nunca Customers -- `GetEmployeesService`
filtra por `UserType.employee`, y un `userId` que resuelve a Customer se trata como inexistente
(`ensureEmployeeBelongsToTenant`). Sin alta de contraseña (R-A11: el admin nunca la ve ni la
define -- el empleado la elige al activar su invitación). Sin Owner/SaaS todavía (§23). Sin
recuperación asistida de contraseña desde esta pantalla, sin reset/disable de MFA (§19: solo
lectura, `mfaEnabled: boolean`).

**Política de unicidad de email** (§7, investigada antes de implementar, no asumida):
`UserRepository.getByEmail` es global a propósito (sin `tenantId`) porque es la misma fuente que
usa `login()` -- ahí, los candidatos Employee/Admin se buscan **sin restricción de tenant**
(`AuthRepository.ts`, `LoginInput.tenantId`). `CreateEmployeeService` reutiliza ese mismo
`getByEmail` global para rechazar duplicados: un email ya usado por CUALQUIER usuario (de
cualquier tenant, Employee o Customer) no puede reutilizarse para un alta nueva -- misma regla que
ya aplica el login, no una inventada.

**Delegación de privilegios al asignar Role** (§9, misma filosofía que PR #88
`ensureDelegatablePermissions`): un actor con `admin.users.manage` no puede asignar un Role cuyos
permisos excedan los propios (`targetRole.permissions ⊆ actorEffectivePermissions`,
`ensureDelegatableRole` en `employee.validation.ts`). Sin excepción por `isSystem`: se buscó de
nuevo un concepto autoritativo de "super admin"/bypass y no existe, así que no se inventó ninguno.
`isSystem` en un Role NO significa "no asignable" (solo "no editable/no archivable", ver PR #88) --
`role-admin`, `role-cashier`, etc. siguen siendo asignables a un empleado nuevo.

**Reglas de asignación de Role** (§8): debe existir, mismo tenant, `status === active` (ni
`archived` ni `inactive` son asignables -- preferencia explícita del ticket para `inactive`, sin
contrato que diga lo contrario todavía).

**Sucursales pertenecen a `User`, no a `Role`** (§10, consistente con PR #88: `Role.branchScope`
salió del formulario de Roles porque esta pantalla es la dueña real de "a qué sucursales puede
entrar un empleado"). `allowedBranchIds` reutiliza el campo que `User` ya tenía. Cada sucursal
debe existir, pertenecer al tenant y estar activa para asignarse de nuevo (`ensureEmployeeBranchIds`,
mismo patrón que `ensureBankAccountBranchIds`); las ya asignadas se conservan aunque hoy estén
inactivas. Un array vacío conserva la semántica que ya tenía en `core/scopes/userBranchAccess.ts`
-- no se inventó un significado nuevo de "todas las sucursales" para ese caso.

**Alta (`CreateEmployeeService`, §11):** sin boundary atómico cross-repository real entre crear el
`User` y `AuthRepository.inviteEmployee` (dos repositorios distintos, cada uno con su propia
transacción interna). Estrategia de falla elegida: NO hace falta compensación destructiva porque
el contrato ya es fail-closed sin ayuda -- un `User` sin `AuthAccount` simplemente no puede hacer
login (ningún candidato coincide), sin importar `User.status`. Si `inviteEmployee` falla después
de crear el `User`, éste queda visible en la tabla (para que el admin lo vea) y sin acceso
posible; no se borra automáticamente y no se inventa un mecanismo de rollback nuevo. El error se
reporta explícito para que el admin sepa que debe reintentar la invitación.

**Edición (`UpdateEmployeeService`, §13/§14):** campos editables: `name`, `phone`, `roleId`,
`allowedBranchIds`, `status`. `email` se valida por formato pero **no se persiste** -- `User.
email` y `AuthAccount.email` son campos independientes sin ningún contrato que los sincronice; sin
eso, cambiar uno sin el otro dejaría el login inconsistente. No es un olvido, es una decisión
explícita hasta que exista ese contrato. `password`/MFA secret/`AuthAccount.status`/lockout
counters nunca aparecen en `EmployeeInputDto` -- no hay forma de que este service los toque.
Cualquier cambio de `status`, `roleId` o `allowedBranchIds` dispara
`revokeAllSessionsByUserId` (§14) para que el empleado tenga que volver a autenticarse con su
contexto actual; un update que solo cambia nombre/teléfono no revoca nada.

**`User.status` vs `AuthAccount.status` vs `Role.status`** (§15): tres conceptos distintos, nunca
mezclados en la UI. `User.status` es laboral/administrativo (lo maneja esta pantalla).
`AuthAccount.status` es técnico (lo maneja Auth, se muestra de solo lectura acá). `Role.status`
es disponibilidad del rol para asignación (PR #88). Inactivar un empleado cambia únicamente
`User.status` y revoca sesiones -- nunca toca `AuthAccount.status` directamente.

**Auditoría** (§21): una sola entrada por acción (`employee.created`/`employee.updated`), con
metadata detallando qué cambió (`statusChanged`/`roleChanged`/`branchesChanged`/
`sessionsRevoked`) en vez de una fila separada por cada campo tocado en una misma edición. Nunca
incluye password, tokens, secretos MFA ni sesiones.

**Tabla** (§16/§17): batch real, sin N+1 -- `GetEmployeesService` hace 1 lectura de `users` + 1
lectura batch de Auth; nombres de rol/sucursal se resuelven en `useEmployees` con
`roles.listByTenant`/`branches.getActiveByTenant` (mismo patrón `ReadonlyMap` que ya usa
`CashShiftTable`), no en el service. Columnas: Empleado, Correo, Rol, Sucursales, Estado
empleado, Estado cuenta, MFA, Último acceso, Acciones. Sin IDs técnicos visibles.

Ruta privada `/administracion/usuarios` y entrada de navegación con `admin.users.manage` (mismo
criterio de único-permiso-en-nav que Roles/Sucursales: `admin.users.read` en solitario no ve el
ítem del menú, aunque el service/página ya lo dejarían entrar por URL directa).

### 12.13 Planes y facturación SaaS ⛔ GAP

Sin entity en el modelo canónico. Propuesta a discutir, no spec cerrada:

```ts
interface SaasPlan {
  id: string;
  tenantId: string;
  planName: string;
  modulesEnabled: string[];
  billingCycle: string;
  status: string;
}
```

### 12.14 Sincronización ⛔ GAP

"Vista simulada del estado de integraciones/nodos", sin entity. Lo más barato para esta fase es
un mock estático hasta que el equipo defina algo real.

---

## 13. Flujos transversales

```text
Administración de personal
  Admin → crea rol → asigna permisos/alcance → crea usuario → asigna rol y sucursal

Proveedor
  Administración mantiene Supplier → Compras lo consulta
    → SupplierProduct define costos/unidades → una OC usa esos acuerdos

Transferencia POS (solo poseés el maestro)
  Cajero elige transferencia → cuenta bancaria habilitada (tu maestro)
    → registra boleta/referencia y monto → confirma comprobante → venta pagada
```

---

## 14. Plan de trabajo

Convención de rama: `feature/admin-<funcionalidad>` (`docs/GIT_WORKFLOW.md`), siempre desde
`development`, PR de vuelta a `development`.

| #   | Rama                                | Pantalla                  | Depende de                  |
| --- | ----------------------------------- | ------------------------- | --------------------------- |
| 1   | `feature/admin-business-config`     | Configuración del negocio | — ✅ hecha                  |
| 2   | `feature/admin-branches`            | Sucursales                | —                           |
| 3   | `chore/admin-role-contracts`        | _(contrato)_              | — ✅ hecha, avisar a Andy   |
| 4   | `feature/admin-roles-permissions`   | Roles y permisos          | 3 ✅ hecha                  |
| 5   | `feature/admin-users`               | Usuarios                  | 2, 4 ✅ hecha (Auth: `getAuthAccountStatusByUserId` de Andy en PR #90 sin mergear; `getEmployeeAuthSummariesByUserIds`/`revokeAllSessionsByUserId` agregados en esta misma rama) |
| 6   | `feature/admin-suppliers`           | Proveedores               | —                           |
| 7   | `feature/admin-bank-accounts`       | Cuentas bancarias         | 2                           |
| 8   | `feature/admin-ecommerce-design`    | Diseño E-commerce         | 1                           |
| 9   | `feature/admin-customers`           | Clientes                  | contrato de segmentos       |
| 10  | `feature/admin-audit-log`           | Auditoría                 | que otros emitan AuditLog   |
| 11  | `feature/admin-cash-reconciliation` | Caja                      | datos de POS                |
| 12  | `feature/admin-dashboard`           | Dashboard                 | 1-9 + `KPICard`             |
| 13  | `feature/admin-reports`             | Reportes                  | casi todos los módulos      |
| 14  | —                                   | Planes / Sincronización   | modelo sin definir          |

Antes de cada PR: `npm run lint`, `npm run build`, `git status`. Sin commit, push ni merge salvo
instrucción explícita.

---

## 15. Seeds necesarios para demo

- Un rol con permisos completos y uno limitado, para probar la matriz de permisos.
- Usuarios cubriendo `active`, `inactive`, `blocked`, `archived` en `UserStatus`, y
  `temporarily_locked`, `disabled`, `password_reset_required` en `AccountStatus`.
- Un empleado en primer acceso (invitación) y uno sin correo (activación asistida).
- Un administrador con `MfaEnrollment` habilitado.
- Al menos 2 sucursales, para probar `branchScope: "selected"`.
- Al menos 1 proveedor con historial de compras, para ver archivado en vez de borrado.
- Al menos 1 cuenta bancaria habilitada para más de una sucursal.
- `AuditLog` con datos suficientes para que la pantalla no se vea vacía.

Estado actual del seed (`src/infrastructure/mock/seeds/demoSeed.ts`): tenant `tenant-demo`
(FerrePharma Demo) con `businessCapabilities` completas; roles `role-admin`, `role-inventory`,
`role-cashier`, `role-warehouse`; la sesión demo resuelve al **cajero**
(`cajero@ferrepharma.demo`), cuyo rol no tiene permisos de administración.

---

## 16. Preguntas abiertas para el equipo

1. `RoleRepository`: resuelto en `chore/admin-role-contracts` con fronteras tenant-scoped.
2. ~~`AuthAccount` / `MfaEnrollment`~~ **Resuelto en `feature/admin-users`:** `inviteEmployee`/
   `activateEmployeeAccount` ya existían (Andy); se agregaron `getEmployeeAuthSummariesByUserIds`
   (batch) y `revokeAllSessionsByUserId` a `AuthRepository`, ambos aditivos, sin tocar
   login/MFA/lockout/recovery existentes. Pendiente: coordinar con Andy la reconciliación con su
   PR #90 (`getAuthAccountStatusByUserId`, lectura de un solo usuario, no usada por esta
   pantalla -- se prefirió la variante batch para evitar N+1 en la tabla).
3. `Branch.schedule`: ¿se agrega o Sucursales no maneja horarios?
4. `EcommerceConfig.theme`: ¿se agrega o Diseño E-commerce va sin branding?
5. `Supplier`: ¿se extiende con contactos, términos de pago, moneda y lead time, o la pantalla se
   limita a los campos actuales? Confirmar con Melbyn que `SupplierProduct` y `SupplierCostTier`
   son de su lado.
6. `TenantRepository.update` y `CustomerRepository.update`: ¿se agregan o esas pantallas quedan de
   solo lectura?
7. `CustomerSegmentRepository`: ¿se define o se pospone la gestión de segmentos? Delimitar por
   escrito con Andy qué es "vista comercial" (tuya) y qué es "cuenta propia del cliente" (suya).
8. **Caja resuelta:** 100% solo lectura; cualquier ajuste futuro requiere coordinación contractual
   con POS (Riquelme).
9. Planes y facturación: ¿se define `SaasPlan`/`Subscription` o se pospone la pantalla?
10. Sincronización: ¿mock estático o estructura mínima de nodo/integración?
11. Filtro de permisos del Sidebar: ¿quién conecta `allowedPermissions` en `PrivateShell`?
