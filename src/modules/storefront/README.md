# storefront

Responsable: Maria

## Territorio del modulo

Este modulo desarrolla su funcionalidad propia sin duplicar contratos compartidos.

## Contracts que consume

ProductRepository, ProductMediaRepository, CatalogImageAssetRepository, CategoryRepository, InventoryRepository, OrderRepository, OrderPaymentConfirmationRepository, CustomerRepository

## Reglas

- No duplicar entities de `core/`.
- No acceder directamente a LocalStorage.
- Usar repositories desde `RepositoryProvider`.
- Usar `shared/` para componentes globales.
- Crear DTO, Mappers y Services propios dentro del modulo cuando empiece cada feature.
- Los read models publicos entregan `CatalogImageSource`; cards, detalle, ofertas y Home comparten la seleccion principal/orden/fuente valida/fallback, y resuelven assets locales solo dentro del tenant publico.
- El checkout con tarjeta simulada crea Order/Payment pending y usa el boundary de confirmacion para aprobar, confirmar y reservar atomicamente.

## Estructura futura

```text
storefront/
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
