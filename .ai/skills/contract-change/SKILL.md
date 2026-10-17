# OmniRetail Shared Contract Change

## Cuando Usar

Para cambios en `core/entities`, `core/enums`, `core/types`, `core/repositories` o infrastructure relacionada con contratos.

## Workflow

1. Identificar consumidores.
2. Leer `docs/SOURCE_OF_TRUTH.md`.
3. Leer `docs/CONTRACTS.md`.
4. Identificar coordinador en `docs/MODULE_OWNERSHIP.md`.
5. Explicar por que el contrato actual no basta.
6. Preferir extension compatible.
7. No duplicar Entity.
8. Actualizar MockRepository si contrato cambia.
9. Actualizar seeds si aplica.
10. Actualizar EventBus si aplica.
11. Actualizar documentacion si cambia una decision.
12. Buscar usos en todo `src/`.
13. Ejecutar `npm run lint`.
14. Ejecutar `npm run build`.
15. Reportar impacto.

No realizar contract change por conveniencia de una sola pantalla si puede resolverse localmente con DTO/ViewModel.
