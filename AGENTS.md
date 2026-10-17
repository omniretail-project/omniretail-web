<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# OmniRetail Agent Instructions

This file is a lightweight entry point for Codex and other coding agents. Do not
turn it into a full project manual.

## Source Of Truth

- `docs/AI_CONTEXT.md`
- `docs/SOURCE_OF_TRUTH.md`
- `docs/ARCHITECTURE.md`
- `docs/CONTRACTS.md`
- `docs/GIT_WORKFLOW.md`
- `docs/MODULE_OWNERSHIP.md`
- `docs/AI_WORKFLOW.md`

## Before Working

1. Run `git branch --show-current` and `git status`.
2. Read `docs/AI_CONTEXT.md`.
3. Read the README of the affected module.
4. Read additional docs only when relevant to the task.
5. Inspect existing implementation before creating new code.

## Invariants

- Shared entities live in `src/core/entities`.
- Repository contracts live in `src/core/repositories`.
- DTOs, mappers, and feature services stay inside the owning module.
- Modules must not access `localStorage` directly.
- Do not duplicate entities or contracts.
- `src/shared` must not contain business logic.
- `InventoryMovement` and `AuditLog` are append-only.
- Navigation and permissions are distributed by module and aggregated in config.
- `feature/*` branches must start from `development`.
- Run `npm run lint` and `npm run build` before finishing.
- Do not commit, push, or merge unless explicitly requested.

## Reusable Playbooks

Read only the playbook that matches the current task:

- `.ai/skills/feature-development/SKILL.md`
- `.ai/skills/shared-component/SKILL.md`
- `.ai/skills/contract-change/SKILL.md`
- `.ai/skills/pr-review/SKILL.md`
