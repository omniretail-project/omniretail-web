# pos

Responsable: Riquelme

## Territorio del modulo

Este modulo desarrolla su funcionalidad propia sin duplicar contratos compartidos.

## Contracts que consume

ProductRepository, InventoryRepository, SalesRepository, PaymentRepository, OrderRepository,
CashShiftRepository, CashMovementRepository, SaleReversalRepository

## Reglas

- No duplicar entities de `core/`.
- No acceder directamente a LocalStorage.
- Usar repositories desde `RepositoryProvider`.
- Usar `shared/` para componentes globales.
- Crear DTO, Mappers y Services propios dentro del modulo cuando empiece cada feature.
- Los servicios de caja protegen permisos y branch scope; repositories protegen integridad y tenant.
- `CashMovement` es la fuente canonica del efectivo esperado para evitar doble conteo de ventas.
- Returns/anulaciones consumen el read model y los servicios de aplicacion POS; React no consulta
  repositorios ni deriva elegibilidad, refund, cantidades retornables o estado final.
- `pos.returns.read` autoriza explicitamente la consulta de ventas para preparar una devolucion;
  `pos.returns.create` y `pos.sales.void` protegen las operaciones mutables correspondientes.

## Estructura futura

```text
pos/
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
