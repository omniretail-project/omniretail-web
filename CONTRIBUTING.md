# Guia de contribucion

Flujo oficial:

```text
main
-> development
-> feature/*
-> development
-> production
```

- `main`: rama inicial base. No recibe PR durante el desarrollo.
- `development`: rama de integracion.
- `feature/*`: nace desde `development` y hace PR hacia `development`.
- `production`: se crea o usa al final para despliegue.

Antes de abrir PR:

- actualizar la rama con `development`
- ejecutar `npm run lint`
- ejecutar `npm run build`
- probar funcionalmente la feature

Zonas comunes:

- `core/`
- `infrastructure/`
- `shared/`
- `config/`
- `styles/`

Los cambios importantes en zonas comunes requieren coordinacion. No duplicar entities, no acceder directamente a LocalStorage desde modulos y no crear componentes visuales globales dentro de un modulo.
