# OmniRetail Feature Development

## Cuando Usar

Cuando un integrante implementa una nueva feature, pantalla o flujo.

## Inputs

- Modulo.
- Feature.
- Requisitos.
- Prototipo/captura si existe.

## Workflow

1. Confirmar rama `feature/*`.
2. Confirmar que nacio de `development`.
3. Leer `docs/AI_CONTEXT.md`.
4. Leer README del modulo.
5. Leer entities/repositorios que consume.
6. Buscar Shared existente.
7. Crear estructura del modulo cuando falte: `pages/`, `components/`, `application/dto/`, `application/mappers/`, `application/services/`, `hooks/`, `validation/`, `navigation.ts`, `permissions.ts`.
8. DTO especifico dentro del modulo.
9. Mapper solo si existe transformacion real.
10. Consumir Repository contracts.
11. No tocar LocalStorage.
12. No duplicar Entity.
13. Implementar UI.
14. Validar navegacion/permisos.
15. Ejecutar `npm run lint`.
16. Ejecutar `npm run build`.
17. Ejecutar `git status`.
18. Reportar archivos modificados y areas comunes tocadas.
19. No commit/push automatico.
