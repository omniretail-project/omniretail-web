# Git Workflow

Flujo oficial:

```text
main
-> development
-> feature/*
-> development
-> production
```

## main

- Contiene la base inicial.
- Permanece congelada.
- No recibe PR durante desarrollo.

## development

- Rama de integracion.
- Todo el equipo parte de ella.

## feature/*

- Nace desde `development`.
- Representa una feature concreta.
- Hace PR hacia `development`.

Ejemplos:

- `feature/auth-login`
- `feature/storefront-home`
- `feature/admin-users`
- `feature/catalog-products`
- `feature/inventory-stock`
- `feature/pos-terminal`
- `feature/logistics-picking`

## production

- Version final destinada a despliegue.
- Recibe `development` cuando el proyecto este terminado/estable.

## Reglas

- No `feature/*` hacia `main`.
- No `feature/*` hacia `production`.
- PR pequenos y revisables.
- Actualizar `development` antes de crear o refrescar la feature.
- Ejecutar `npm run lint` y `npm run build` antes de PR.
- No force push en ramas compartidas.
- No desarrollar directamente sobre `main`.
