# catalog

Responsable: Melbyn

## Territorio del modulo

Este modulo desarrolla su funcionalidad propia sin duplicar contratos compartidos.

## Contracts que consume

ProductRepository, ProductMediaRepository, CategoryRepository, UnitRepository, AttributeRepository,
PromotionRepository

## Reglas

- No duplicar entities de `core/`.
- No acceder directamente a LocalStorage.
- Usar repositories desde `RepositoryProvider`.
- Derivar el tenant desde la sesion operativa y usar exclusivamente las operaciones tenant-scoped
  de Product, Category y Unit en rutas privadas.
- Usar `shared/` para componentes globales.
- Crear DTO, Mappers y Services propios dentro del modulo cuando empiece cada feature.

## Gestion de productos

Implementado en esta rama:

- Listado, busqueda, filtros, paginacion y detalle de productos.
- Creacion, edicion y archivo mediante `ProductRepository`.
- Listado, detalle, validacion de referencias y mutaciones fallan cerrados ante IDs de otro tenant.
- Hasta seis imagenes mediante `ProductMediaRepository`; mock conserva uploads procesados en
  `CatalogImageAssetRepository`/IndexedDB y API usa Product Media real con multipart, URLs
  externas, metadata, principal, reemplazo seguro, borrado y proxy `/api/media`.
- Opciones de categoria, unidad y capacidades de negocio desde repositories.
- Tracking adaptable por `BusinessCapabilitiesConfig`; productos `service` fuerzan tracking inactivo.
- Capacidades del negocio aplicadas de verdad, no solo mostradas: sin `supportsServices` o
  `supportsKits` no se puede crear ni convertir un producto a esos tipos; sin
  `supportsUnitsAndPackaging` la unidad de venta es siempre la de inventario y no se persisten
  equivalencias; sin `supportsProductAttributes` los atributos se ocultan y se descartan.
  `applyCapabilityRulesToEditor` es el unico lugar donde se proyectan esas reglas sobre el borrador,
  y los services la aplican antes de validar y persistir para que la regla valga aunque el borrador
  llegue desde otro consumidor.
- Rutas privadas `/catalogo/productos`, `/catalogo/productos/nuevo`, `/catalogo/productos/[id]` y `/catalogo/productos/[id]/editar`.

## Catalogo demo

Las bases mock nuevas reciben el catalogo coherente de **Ferreteria Los Simpson**: 10 categorias
principales y 30 productos fisicos, con atributos, precios por cantidad, proveedor, configuracion
de inventario, balance por ubicacion y una imagen principal estatica por producto. No crea kits ni
servicios, aunque esos contratos de dominio siguen disponibles. El cambio del seed no migra ni
reinicia automaticamente una base ya persistida en el navegador.

## Gestion de categorias

Implementado en esta rama:

- Listado, busqueda, filtro por estado, paginacion y panel contextual de categorias.
- Creacion, edicion, archivo y restauracion mediante `CategoryRepository`, incluida una imagen opcional que reutiliza el pipeline multimedia sin alterar slug ni jerarquia.
- Conteo real de productos asociados desde `ProductRepository`.
- Ruta privada `/catalogo/categorias`.

## Gestion de ubicaciones

Implementado en esta rama:

- Listado, busqueda, filtro por estado, paginacion y panel contextual de ubicaciones.
- Creacion, edicion, archivo y reactivacion mediante `InventoryRepository`.
- Conteo real de productos asociados desde `InventoryBalance.locationId`.
- Ruta privada `/catalogo/ubicaciones`.

## Gestion de unidades

Implementado en esta rama:

- Listado, busqueda, filtro por categoria canonica, filtro por estado, paginacion y panel contextual de unidades.
- Creacion, edicion, archivo y reactivacion mediante `UnitRepository`.
- Ruta privada `/catalogo/unidades`.
- `Unit.category` es la clasificacion canonica de la unidad; `code`, `symbol` y `name` no determinan la categoria.
- Esta feature no administra conversiones ni empaques.

## Integracion API de maestros

En modo `api`, categorias, ubicaciones, unidades y conversiones consumen los endpoints reales de
`/catalog` mediante `backendFetch`. Las listas paginadas se agregan dentro de los adapters para
mantener los contratos existentes. Categorias y ubicaciones conservan `parentId`; sus listados se
ordenan en preorden para reflejar la jerarquia. Inventory sigue en mock salvo las tres operaciones
del maestro de ubicaciones. La pantalla de unidades no agrega CRUD de conversiones: usa su listado
real para el read model existente y conserva las operaciones administrativas/globales en API.
Las conversiones administrativas globales y las conversiones product-scoped usan API real. El
editor solo reemplaza conversiones product-scoped cuando la sesion puede leerlas y gestionarlas.

## Integracion API de Products - Bloque 1

En modo `api`, Product core usa `ApiProductRepository` sin fallback a mocks. El listado
administrativo consume paginacion backend 1-based y enriquece unicamente la pagina actual con
categorias y unidades reales. Los consumidores legacy pueden agregar paginas del API de forma
temporal; el listado administrativo no usa ese camino.

La UI envia busqueda, estado, tipo, categoria, canales y promocion al backend; no filtra ni pagina
de nuevo la pagina recibida. Mock conserva su estrategia fetch-all, filtros y paginacion local.

## Integracion API de Products - Bloque 2

En modo `api`, el editor usa adapters reales para precio dedicado e historial, price tiers,
conversiones product-scoped, definiciones y valores de atributos, promociones, relaciones con
proveedores y sus escalas de costo, configuracion de inventario y componentes de kit. La
composicion explicita distingue Product core, relaciones Product y media para impedir que un UUID
del backend llegue a un repository mock.

La creacion de kits publica de forma segura: crea el core archivado, reemplaza componentes y solo
despues restaura. Las escrituras posteriores al core se reportan por seccion mediante un error de
guardado parcial; no se simula rollback y la UI recarga el estado canonico. Un kit archivado puede
reintentar sus componentes antes de usar la restauracion explicita.

## Integracion API de Products - Bloque 3

Product Media usa los endpoints reales on-demand en editor, detalle y Quick View. Los uploads son
multipart y las rutas administradas `/media/...` se renderizan mediante el proxy same-origin
`/api/media/...`. Los reemplazos locales no
mutan la URL administrada: crean un upload nuevo y retiran el anterior, liberando primero el slot
cuando el producto ya alcanzo el limite de seis. Los fallos posteriores al core se reportan como
guardado parcial y recargan el estado canonico, sin simular rollback.

Las imagenes de categoria usan sus endpoints multipart/delete dedicados en API. Mock conserva
`mockAsset`, IndexedDB, previews y limpieza de assets huerfanos sin mezclar UUID del backend. Si
el core de una categoria se guarda pero falla su imagen, la UI recarga la categoria y mantiene un
estado parcial recuperable para reintentar desde edicion, sin anunciar exito ni simular rollback.

## Integracion API de Products - Bloque 4A

El listado administrativo API usa filtros y paginacion server-side de `GET /catalog/products`.
`primaryImageUrl` pertenece exclusivamente a la proyeccion de lista: las rutas administradas se
convierten al proxy `/api/media/...` y llegan a `ProductTable` sin solicitar Product Media por fila.
La busqueda se envia tras 350 ms sin cambios, mientras los demas filtros y el tamano de pagina
reinician la consulta en pagina 1. Detail, Quick View y Editor conservan su carga on-demand.

## Estructura futura

```text
catalog/
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
