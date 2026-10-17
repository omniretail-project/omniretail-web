# contracting

Flujo público de contratación de MARJYM Base en `/contratar`.

## Límites del módulo

- El DTO público sólo acepta nombre del negocio y credenciales del administrador.
- El slug se deriva del nombre dentro de `CreatePublicContractService`.
- El plan siempre se resuelve como `plan-basic` desde el catálogo canónico.
- Los complementos iniciales siempre son vacíos; no existen controles para elegirlos.
- La creación atómica se delega por completo a `TenantOnboardingService`.
- No procesa pagos, no inicia sesión y no copia datos operativos de `tenant-demo`.

## Dependencias

Consume los repositorios ya agregados en `RepositoryRegistry`, la política de contraseñas de
`config/auth-policy` y el onboarding propietario de `administration`. No accede directamente a
`localStorage`.
