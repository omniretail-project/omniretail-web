# OmniRetail AI Context

## Stack

- Next.js 16
- React 19
- TypeScript
- App Router
- Tailwind CSS

## Arquitectura

`app/`: rutas y layouts Next.js.

`core/`: contratos compartidos, entities, enums, types y repository interfaces.

`infrastructure/`: backend simulado, mock repositories, eventos y persistencia.

`modules/`: features por dominio e integrante.

`shared/`: UI, hooks y utilidades transversales.

`config/`: configuracion comun, navegacion, permisos, estados y politicas.

## Flujo De Datos Actual

```text
UI
-> Module application/service
-> Repository contract
-> MockRepository
-> MockDatabaseStore
-> LocalStorage
```

## Flujo Futuro

```text
UI
-> Repository contract
-> ApiRepository
-> Backend
```

## Reglas Invariantes

- una sola Entity por concepto;
- no duplicar Product;
- no duplicar Order;
- no duplicar Customer;
- modulos no acceden directamente a localStorage;
- Repository contracts viven en core;
- DTO/Mappers especificos viven en el modulo;
- MockRepositories comparten MockDatabaseStore;
- Product.tracking controla lote/vencimiento/serie/stock por producto;
- InventoryMovement es append-only;
- AuditLog es append-only;
- Shared no contiene logica de negocio;
- navegacion/permisos estan distribuidos por modulo;
- `config/navigation.ts` agrega la navegacion y el shell privado la entrega a `Sidebar`;
- feature branches nacen de development;
- Authentication != Entitlement != Role Permission != Branch Scope: ninguna capa sustituye a las demas; una mutacion Employee exige TENANT ENTITLEMENT AND ROLE PERMISSION AND BRANCH ACCESS AND RESOURCE OWNERSHIP;
- `BusinessCapabilitiesConfig` (config operativa) != SaaS capability (derecho comercial del Plan) -- `effectiveFeatureEnabled = planHasCapability AND businessConfigSetting`;
- `ResolveTenantEntitlementsService` vive en `shared/application/` (nunca en `administration`) para que cualquier modulo lo consuma sin invertir dependencias.

Para decisiones completas consultar:

- `docs/SOURCE_OF_TRUTH.md`
- `docs/ARCHITECTURE.md`
- `docs/CONTRACTS.md`
- `docs/GIT_WORKFLOW.md`
- `docs/MODULE_OWNERSHIP.md`
- `docs/AI_WORKFLOW.md`
