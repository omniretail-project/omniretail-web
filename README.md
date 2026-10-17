# OmniRetail

Frontend Web para el SaaS OmniRetail.

Este repositorio contiene la base tecnica del frontend: Next.js, React, TypeScript, App Router, Tailwind CSS, ESLint, Prettier y estructura por modulos.

## Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- App Router
- npm

## Arquitectura

- `src/app`: rutas y layouts de Next.js.
- `src/core`: contratos oficiales compartidos por todo OmniRetail.
- `src/infrastructure`: implementacion simulada de backend, storage, eventos y providers.
- `src/modules`: funcionalidades por dominio y responsable.
- `src/shared`: componentes, layouts, hooks, utilidades y constantes reutilizables.
- `src/config`: configuracion global de navegacion, permisos, estados y politicas.
- `src/styles`: tokens visuales y utilidades CSS.

## Ownership

Maria

- `storefront`

Andy

- `auth`
- `customer`

Jose

- `administration`

Melbyn

- `catalog`
- `inventory`
- `purchasing`
- `receiving`

Riquelme

- `pos`
- `logistics`

Yimmy

- aplicacion movil
- repositorio independiente

## Instalacion

```bash
npm install
```

## Ejecucion local

```bash
npm run dev
```

## Compilacion

```bash
npm run build
```

## Flujo Git

Trabajar en ramas `feature/*`, mantener PR pequenos y ejecutar `npm run lint` y `npm run build` antes de solicitar revision. Las zonas comunes (`core/`, `infrastructure/`, `shared/`, `config/`, `styles/`) requieren coordinacion cuando el cambio afecte a mas de un modulo.

## AI-assisted development

El proyecto admite herramientas de programacion asistida por IA sin repetir toda la arquitectura en cada prompt. El contexto neutral esta en `docs/AI_CONTEXT.md` y las decisiones funcionales en `docs/SOURCE_OF_TRUTH.md`.

- Codex: leer `AGENTS.md`.
- Claude Code: leer `CLAUDE.md`.
- Playbooks portables: ver `.ai/skills/`.
