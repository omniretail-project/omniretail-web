# auth

Responsable: Andy

## Territorio del modulo

Este modulo desarrolla su funcionalidad propia sin duplicar contratos compartidos.

## Contracts que consume

AuthRepository, UserRepository, TenantRepository, RoleRepository, BranchRepository

## Reglas

- No duplicar entities de `core/`.
- No acceder directamente a LocalStorage.
- Usar repositories desde `RepositoryProvider`.
- Para Employee exigir Tenant activo y Role `active` del mismo tenant antes de publicar o crear
  una sesion operativa; login, MFA y revalidacion de sesion fallan cerrados.
- `CurrentSessionProvider` escucha `role.changed` para retirar permisos cuando un Role se vuelve
  `inactive` o `archived`; el scope de Branch se aplica despues de reducir por tenant.
- Usar `shared/` para componentes globales.
- Crear DTO, Mappers y Services propios dentro del modulo cuando empiece cada feature.

## Modo api (login contra el backend real)

Por defecto el frontend usa datos simulados (`NEXT_PUBLIC_API_MODE=mock`). Para iniciar sesion
contra el backend real, en `.env.local` (ver `.env.example`):

```env
NEXT_PUBLIC_API_MODE=api
OMNIRETAIL_API_URL=http://localhost:8080/api/v1
```

`NEXT_PUBLIC_API_MODE` solo elige el modo y se lee al compilar: reinicia `npm run dev` al cambiarlo.
`OMNIRETAIL_API_URL` es solo de servidor; nunca usar el prefijo `NEXT_PUBLIC`.

Como funciona:

- Login, logout y sesion actual pasan por los Route Handlers `app/api/auth/{login,logout,me}`.
  El JWT queda en la cookie HttpOnly `omniretail_session`; nunca en localStorage, sessionStorage
  ni en respuestas al cliente.
- `infrastructure/api/withApiSession.ts` reemplaza `auth` por `ApiAuthRepository` y adapta
  `users`, `roles` y `tenants` para que usuario, rol con permisos y tienda de la sesion actual
  salgan de `/auth/me`. `CurrentSessionSnapshot`, `CurrentSessionProvider` y las pantallas no
  cambian.
- Login de clientes: el `tenantId` del storefront se traduce al slug de esa tienda y se envia como
  `tenantSlug`.
- MFA, registro, recuperacion y cambio de contraseña, activacion de cuenta y administracion de
  cuentas todavia no existen en el backend: en modo api lanzan "Esta función aún no está
  disponible en modo API.".

Limitaciones conocidas (temporales):

- Los datos simulados usan IDs como `tenant-demo`; el backend usa UUID. En modo api las pantallas
  de modulos no migrados aparecen vacias hasta migrar cada modulo.
- La sucursal activa elegida en el selector se guarda solo en memoria de la pestaña, hasta que el
  backend tenga un endpoint para persistirla. El backend nunca usa ese valor como autoridad.

## Llamar al backend en modo api

`/api/backend/<ruta>` (`app/api/backend/[...path]/route.ts`) es el puente generico hacia
`${OMNIRETAIL_API_URL}/<ruta>`. En el servidor agrega el JWT de la cookie HttpOnly; el navegador
nunca ve el token ni la URL del backend. Sin sesion se llama sin token (sirve para `/public/**`).

- `/auth/**` esta bloqueado (404): login, logout y sesion actual van solo por `app/api/auth/*`.
- Rutas con segmentos vacios, `.`, `..`, `/` o `\` responden 404.
- Solo se reenvia `Idempotency-Key` (y Content-Type json cuando hay cuerpo). Nunca Authorization
  ni Cookie del navegador, y la respuesta nunca trae Set-Cookie del backend.
- POST, PUT, PATCH y DELETE exigen `Origin` igual al del frontend; si no, 403.
- Un 401 del backend con sesion activa borra la cookie.

Desde un `Api*Repository` se usa `infrastructure/api/backendClient.ts`:

```ts
const result = await backendFetch<PaginatedResult<ApiProduct>>("/catalog/products", {
  query: { page: 1, size: 20 },
});
// Errores: BackendRequestError con status, code y fields del ApiError del backend.
```

Los puentes especificos del storefront (`/api/public/[slug]/checkout` y
`/api/public/[slug]/tracking/[token]`) siguen funcionando igual.

## Estructura futura

```text
auth/
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
