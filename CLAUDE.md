# OmniRetail Claude Code Instructions

## Quick Context

Read the quick project context first:

@docs/AI_CONTEXT.md

## Authoritative Documentation

Consult these only when the task needs them:

- `docs/SOURCE_OF_TRUTH.md`
- `docs/ARCHITECTURE.md`
- `docs/CONTRACTS.md`
- `docs/GIT_WORKFLOW.md`
- `docs/MODULE_OWNERSHIP.md`
- `docs/AI_WORKFLOW.md`

## Rules

- Do not import every large document automatically; preserve context.
- Shared entities and repository contracts live in `src/core`.
- DTOs, mappers, and feature services stay inside modules.
- Modules must not access `localStorage` directly.
- Do not duplicate entities, contracts, navigation, or permissions.
- `src/shared` must not contain business logic.
- `InventoryMovement` and `AuditLog` are append-only.
- `feature/*` branches start from `development`.
- Run `npm run lint`, `npm run build`, and `git status` before finishing.
- Do not commit, push, or merge unless explicitly requested.

## Reusable Playbooks

Read only the playbook that matches the current task:

- `.ai/skills/feature-development/SKILL.md`
- `.ai/skills/shared-component/SKILL.md`
- `.ai/skills/contract-change/SKILL.md`
- `.ai/skills/pr-review/SKILL.md`
