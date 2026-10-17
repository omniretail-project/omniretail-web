# AI Workflow

Este documento define como debe trabajar cualquier agente de programacion en OmniRetail.

## Antes De Editar

1. Ejecutar `git branch --show-current`.
2. Ejecutar `git status`.
3. Leer `AGENTS.md` o `CLAUDE.md` segun agente.
4. Leer `docs/AI_CONTEXT.md`.
5. Leer README del modulo afectado.
6. Leer solo documentacion adicional necesaria.
7. Inspeccionar implementacion existente.
8. Reutilizar antes de crear.

## Anti-Token-Waste

Los agentes no deben leer todo `docs/` en cada tarea. Por defecto:

1. Leer `docs/AI_CONTEXT.md`.
2. Leer README del modulo afectado.
3. Inspeccionar codigo directamente relacionado.

Luego leer bajo demanda:

- `SOURCE_OF_TRUTH`: duda funcional o cross-module.
- `ARCHITECTURE`: cambio de estructura.
- `CONTRACTS`: Entity, DTO, Mapper o Repository.
- `GIT_WORKFLOW`: ramas o PR.
- `MODULE_OWNERSHIP`: contratos compartidos o coordinacion.
- Skill: solo el playbook correspondiente al workflow actual.

## Durante Implementacion

- Trabajar solo en scope solicitado.
- No refactorizar archivos no relacionados.
- No crear entidades duplicadas.
- No modificar `core/` por comodidad.
- No acceder a LocalStorage desde `modules/`.
- Usar Shared antes de crear equivalente.
- Componente especifico permanece en modulo.
- Componente transversal puede proponerse para `shared/`.
- No introducir librerias sin necesidad.
- No alterar stack.
- No crear backend.

## Areas Comunes

Para cambios en `core/`, `infrastructure/`, `shared/`, `config/` o `styles/`, el agente debe reconocer que toca area comun, revisar consumidores, mantener backward compatibility si es razonable, reportar impacto y no hacer cambios silenciosos de contrato.

## Reusable Playbooks

Leer solamente el skill que corresponda a la tarea actual:

- `.ai/skills/feature-development/SKILL.md`
- `.ai/skills/shared-component/SKILL.md`
- `.ai/skills/contract-change/SKILL.md`
- `.ai/skills/pr-review/SKILL.md`

## Validacion Final

Ejecutar:

```bash
npm run lint
npm run build
git status
```

No commit, push ni merge salvo instruccion explicita.

## Drift Documental

- Decision funcional cambia: actualizar `SOURCE_OF_TRUTH`.
- Estructura tecnica cambia: actualizar `ARCHITECTURE`.
- Patron conceptual de contratos cambia: actualizar codigo primero y luego `CONTRACTS` si aplica.
- Flujo Git cambia: actualizar `GIT_WORKFLOW`.
- Ownership cambia: actualizar `MODULE_OWNERSHIP`.
- `AGENTS.md` y `CLAUDE.md` deben seguir siendo entry points ligeros.
