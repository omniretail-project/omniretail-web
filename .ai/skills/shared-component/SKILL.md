# OmniRetail Shared Component

## Cuando Usar

Cuando se crea o modifica un componente transversal.

## Antes De Crear

- Buscar componente existente.
- Verificar si realmente lo usan o usaran varios modulos.

## Reglas

- Sin logica de negocio.
- Props genericas.
- TypeScript estricto.
- Accesibilidad.
- Tokens del design system.
- No hardcode de colores arbitrarios.
- Reutilizable.
- Documentar API minima.
- Evitar mega-componente.

Si solo sirve a un modulo, crearlo dentro de `modules/<module>/components`, no en `shared`.

## Validacion

Ejecutar:

- `npm run lint`
- `npm run build`
