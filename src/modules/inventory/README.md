# inventory

Responsable: Melbyn

## Territorio del modulo

Este modulo desarrolla su funcionalidad propia sin duplicar contratos compartidos.

## Contracts que consume

InventoryRepository, InventoryTransferRequestRepository, ProductRepository

## Reglas

- No duplicar entities de `core/`.
- No acceder directamente a LocalStorage.
- Usar repositories desde `RepositoryProvider`.
- Usar `shared/` para componentes globales.
- Crear DTO, Mappers y Services propios dentro del modulo cuando empiece cada feature.

## Inventario y alertas

Implementado en esta rama:

- Panel `/inventario/alertas` con KPIs, busqueda, filtros por sucursal/categoria/estado, tabla de existencias y panel contextual.
- Existencia y reservado desde `InventoryBalance`; disponible desde el calculo canonico que respeta reservas y trazabilidad. Minimo y reposicion provienen de `ProductInventorySettings`.
- Caducidad desde `StockLot.expirationDate` con regla local de proximidad de 30 dias.
- Ajustes de entrada, salida/merma y conteo exacto mediante `InventoryRepository.registerMovement`.
- Solicitudes de traslado entre sucursales: crear y rechazar no reservan stock ni crean Picking; aceptar aprueba la solicitud y crea atómicamente Transfer, reserva y Picking. El stock físico sale únicamente en Dispatch.

## Estructura futura

```text
inventory/
|-- pages/
|-- components/
|-- application/
|   |-- dto/
|   |-- mappers/
|   `-- services/
|-- hooks/
|-- validation/
|-- navigation.ts
|-- permissions.ts
`-- index.ts
```
