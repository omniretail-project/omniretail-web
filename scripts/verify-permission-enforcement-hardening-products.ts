import assert from "node:assert/strict";
import {
  BranchStatus,
  BranchType,
  BusinessPreset,
  CategoryStatus,
  ProductStatus,
  ProductType,
  RoleStatus,
  TenantStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockBusinessConfigRepository,
  MockCategoryRepository,
  MockProductMediaRepository,
  MockProductRepository,
  MockPromotionRepository,
  MockRoleRepository,
  MockTenantRepository,
  MockUnitRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import type { CreateProductDto } from "@/modules/catalog/application/dto/CreateProductDto";
import { ArchiveProductService } from "@/modules/catalog/application/services/ArchiveProductService";
import { CreateProductService } from "@/modules/catalog/application/services/CreateProductService";
import { FinalizeProductPromotionService } from "@/modules/catalog/application/services/FinalizeProductPromotionService";
import {
  GetProductsService,
  type GetProductsParams,
} from "@/modules/catalog/application/services/GetProductsService";
import { SaveProductPromotionService } from "@/modules/catalog/application/services/SaveProductPromotionService";
import { CatalogServiceError } from "@/modules/catalog/application/services/serviceHelpers";
import { UpdateProductService } from "@/modules/catalog/application/services/UpdateProductService";
import { GetStorefrontPublishedProductService } from "@/modules/storefront/application/services/GetStorefrontPublishedProductService";

const TENANT_A = "tenant-demo";
const TENANT_B = "tenant-products-hardening-b";
const NOW = "2026-09-15T12:00:00.000Z";
const PRODUCT_LIST_PARAMS: GetProductsParams = {
  page: 1,
  pageSize: 100,
  sort: "name,asc",
  filters: {
    search: "",
    status: "all",
    productType: "all",
    categoryId: "all",
    channels: [],
    promotion: "all",
  },
};

class MemoryStorageAdapter extends LocalStorageAdapter {
  readonly values = new Map<string, string>();

  override get<T>(key: string): T | null {
    const value = this.values.get(key);
    return value === undefined ? null : (JSON.parse(value) as T);
  }

  override set<T>(key: string, value: T): void {
    this.values.set(key, JSON.stringify(value));
  }

  override remove(key: string): void {
    this.values.delete(key);
  }
}

/**
 * `permissions` define el Role de prueba (read-only / create / update / sin nada). Reusa las
 * categorías/unidades REALES del seed demo (cat-hand-tools/unit-unit) en vez de sembrar fixtures
 * nuevas -- menos superficie de error, mismo patrón que otros harnesses de este repo.
 */
function createProductsHarness(permissions: string[]) {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();

  const testRole = {
    id: "role-products-hardening",
    tenantId: TENANT_A,
    name: "Role products hardening test",
    isSystem: false,
    permissions,
    branchScope: "all" as const,
    status: RoleStatus.active,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const testUser = {
    id: "user-products-hardening",
    tenantId: TENANT_A,
    name: "Products Hardening Tester",
    email: "products-hardening@hardening.test",
    type: UserType.employee,
    status: UserStatus.active,
    roleId: testRole.id,
    createdAt: NOW,
    updatedAt: NOW,
  };
  store.mutate((db) => {
    db.roles.push(testRole);
    db.users.push(testUser);
    db.tenants.push({
      id: TENANT_B,
      name: "Products Hardening Test Tenant B",
      slug: "products-hardening-b",
      status: TenantStatus.active,
      defaultCurrency: "GTQ",
      timezone: "America/Guatemala",
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.businessCapabilities.push({
      tenantId: TENANT_B,
      preset: BusinessPreset.custom,
      supportsInventory: true,
      supportsLots: false,
      supportsExpiration: false,
      supportsSerials: false,
      supportsMultipleLocations: false,
      supportsUnitsAndPackaging: true,
      supportsProductAttributes: false,
      supportsKits: false,
      supportsServices: false,
      defaultProductTracking: { stock: true, lot: false, expiration: false, serial: false },
    });
    db.branches.push({
      id: "branch-products-hardening-b",
      tenantId: TENANT_B,
      code: "PHB",
      name: "Sucursal B",
      type: BranchType.store,
      status: BranchStatus.active,
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.categories.push({
      id: "cat-products-hardening-b",
      tenantId: TENANT_B,
      name: "Categoria B",
      slug: "categoria-b",
      status: "active" as never,
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.units.push({
      id: "unit-products-hardening-b",
      tenantId: TENANT_B,
      code: "UNB",
      name: "Unidad B",
      symbol: "u",
      category: "unit" as never,
      allowsDecimals: false,
      status: "active" as never,
      createdAt: NOW,
      updatedAt: NOW,
    });
    // Producto de OTRO tenant (B) -- usado por el test de cross-tenant mutation (#9): un actor
    // autenticado en TENANT_A, con permisos completos, nunca debe poder mutarlo.
    db.products.push({
      id: "product-tenant-b",
      tenantId: TENANT_B,
      sku: "TENANT-B-SKU",
      name: "Producto Tenant B",
      productType: ProductType.physical,
      categoryId: "cat-products-hardening-b",
      baseUnitId: "unit-products-hardening-b",
      saleUnitId: "unit-products-hardening-b",
      salePrice: 100,
      status: ProductStatus.published,
      tracking: { stock: true, lot: false, expiration: false, serial: false },
      channels: { ecommerce: false, pos: true, mobileApp: false },
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  const session = { id: "session-products-hardening", userId: testUser.id };
  const repositories = {
    productDataSource: "mock",
    auth: {
      getCurrentSessionId: async () => session.id,
      getSession: async (sessionId: string) => (sessionId === session.id ? session : null),
    },
    users: new MockUserRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    tenants: new MockTenantRepository(store, eventBus),
    categories: new MockCategoryRepository(store, eventBus),
    units: new MockUnitRepository(store, eventBus),
    products: new MockProductRepository(store, eventBus),
    productMedia: new MockProductMediaRepository(store, eventBus),
    promotions: new MockPromotionRepository(store, eventBus),
    businessConfig: new MockBusinessConfigRepository(store, eventBus),
  } as unknown as RepositoryRegistry;

  return { repositories, store };
}

function buildProductDto(overrides: Partial<CreateProductDto> = {}): CreateProductDto {
  return {
    sku: `hardening-sku-${Math.random().toString(36).slice(2, 8)}`,
    name: "Producto hardening",
    productType: ProductType.physical,
    categoryId: "cat-hand-tools",
    baseUnitId: "unit-unit",
    saleUnitId: "unit-unit",
    salePrice: 50,
    status: ProductStatus.published,
    tracking: { stock: true, lot: false, expiration: false, serial: false },
    channels: { ecommerce: false, pos: true, mobileApp: false },
    ...overrides,
  };
}

// 1. read => list PASS
async function verifyReadPermissionAllowsList() {
  const { repositories } = createProductsHarness(["catalog.products.read"]);
  const result = await new GetProductsService(repositories).execute(PRODUCT_LIST_PARAMS);
  assert.ok(Array.isArray(result.items), "1: catalog.products.read debe poder listar productos");
}

// 2. sin read => backoffice read DENIED
async function verifyNoPermissionDeniesRead() {
  const { repositories } = createProductsHarness([]);
  await assert.rejects(
    new GetProductsService(repositories).execute(PRODUCT_LIST_PARAMS),
    CatalogServiceError,
    "2: sin ningún permiso catalog.products.*, el listado debe fallar",
  );
}

// 3-6. read-only -> mutaciones => DENIED
async function verifyReadOnlyDeniedForAllMutations() {
  const { repositories } = createProductsHarness(["catalog.products.read"]);

  await assert.rejects(
    new CreateProductService(repositories).execute(buildProductDto()),
    CatalogServiceError,
    "3: read-only -> CreateProductService debe ser DENIED",
  );

  // Para probar Update/Archive/Promotion primero hace falta un producto real -- se crea
  // directamente en el store (bypass del service) para no depender de una mutación previa.
  const { store } = createProductsHarness(["catalog.products.create", "catalog.products.update"]);
  const seeded = store.mutate((db) => {
    const product = {
      id: "product-hardening-readonly-target",
      tenantId: TENANT_A,
      sku: "HARDENING-READONLY",
      name: "Producto objetivo read-only",
      productType: ProductType.physical,
      categoryId: "cat-hand-tools",
      baseUnitId: "unit-unit",
      saleUnitId: "unit-unit",
      salePrice: 25,
      status: ProductStatus.published,
      tracking: { stock: true, lot: false, expiration: false, serial: false },
      channels: { ecommerce: false, pos: true, mobileApp: false },
      createdAt: NOW,
      updatedAt: NOW,
    };
    db.products.push(product);
    return product;
  });
  // Reusa el MISMO store que el producto sembrado, pero con un role read-only -- así
  // Update/Archive/Promotion se prueban contra un producto que realmente existe.
  const { repositories: readOnlyRepos } = attachRoleToStore(store, ["catalog.products.read"]);

  await assert.rejects(
    new UpdateProductService(readOnlyRepos).execute(seeded.id, {
      ...buildProductDto({ sku: seeded.sku }),
    }),
    CatalogServiceError,
    "4: read-only -> UpdateProductService debe ser DENIED",
  );
  await assert.rejects(
    new ArchiveProductService(readOnlyRepos).execute(seeded.id),
    CatalogServiceError,
    "5: read-only -> ArchiveProductService debe ser DENIED",
  );
  await assert.rejects(
    new SaveProductPromotionService(readOnlyRepos).execute({
      productId: seeded.id,
      tenantId: TENANT_A,
      productName: seeded.name,
      type: "percentage" as never,
      value: 10,
      startAt: NOW,
      endAt: undefined,
      channels: { pos: true, ecommerce: false, mobileApp: false } as never,
      untilStockEnds: false,
    }),
    CatalogServiceError,
    "6: read-only -> Promotion mutation (SaveProductPromotionService) debe ser DENIED",
  );
  await assert.rejects(
    new FinalizeProductPromotionService(readOnlyRepos).execute("any-promotion-id"),
    CatalogServiceError,
    "6: read-only -> Promotion mutation (FinalizeProductPromotionService) debe ser DENIED",
  );
}

/** Agrega un segundo Role/User de prueba al MISMO store, para reusar productos ya sembrados. */
function attachRoleToStore(store: MockDatabaseStore, permissions: string[]) {
  const roleId = `role-products-hardening-${Math.random().toString(36).slice(2, 8)}`;
  const userId = `user-products-hardening-${Math.random().toString(36).slice(2, 8)}`;
  store.mutate((db) => {
    db.roles.push({
      id: roleId,
      tenantId: TENANT_A,
      name: "Role products hardening secondary",
      isSystem: false,
      permissions,
      branchScope: "all",
      status: RoleStatus.active,
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.users.push({
      id: userId,
      tenantId: TENANT_A,
      name: "Secondary Tester",
      email: `${userId}@hardening.test`,
      type: UserType.employee,
      status: UserStatus.active,
      roleId,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
  const eventBus = new DataEventBus();
  const session = { id: `session-${userId}`, userId };
  const repositories = {
    productDataSource: "mock",
    auth: {
      getCurrentSessionId: async () => session.id,
      getSession: async (sessionId: string) => (sessionId === session.id ? session : null),
    },
    users: new MockUserRepository(store, eventBus),
    roles: new MockRoleRepository(store, eventBus),
    tenants: new MockTenantRepository(store, eventBus),
    categories: new MockCategoryRepository(store, eventBus),
    units: new MockUnitRepository(store, eventBus),
    products: new MockProductRepository(store, eventBus),
    productMedia: new MockProductMediaRepository(store, eventBus),
    promotions: new MockPromotionRepository(store, eventBus),
    businessConfig: new MockBusinessConfigRepository(store, eventBus),
  } as unknown as RepositoryRegistry;
  return { repositories };
}

// 7. create permission => create PASS
async function verifyCreatePermissionAllowsCreate() {
  const { repositories } = createProductsHarness(["catalog.products.create"]);
  const created = await new CreateProductService(repositories).execute(buildProductDto());
  assert.ok(created.id, "7: catalog.products.create debe poder crear productos");
}

// 8. update permission => update/archive/promotion PASS
async function verifyUpdatePermissionAllowsMutations() {
  const { repositories } = createProductsHarness([
    "catalog.products.create",
    "catalog.products.update",
  ]);
  const created = await new CreateProductService(repositories).execute(buildProductDto());

  const updated = await new UpdateProductService(repositories).execute(
    created.id,
    buildProductDto({ sku: created.sku, name: "Producto actualizado" }),
  );
  assert.equal(updated.name, "Producto actualizado", "8: update debe funcionar con .update");

  const promotion = await new SaveProductPromotionService(repositories).execute({
    productId: created.id,
    tenantId: TENANT_A,
    productName: updated.name,
    type: "percentage" as never,
    value: 15,
    startAt: NOW,
    endAt: undefined,
    channels: { pos: true, ecommerce: false, mobileApp: false } as never,
    untilStockEnds: false,
  });
  assert.ok(promotion.id, "8: promotion debe funcionar con .update");

  const archived = await new ArchiveProductService(repositories).execute(created.id);
  assert.equal(archived.status, ProductStatus.archived, "8: archive debe funcionar con .update");
}

// 9. cross-tenant mutation => DENIED
async function verifyCrossTenantMutationDenied() {
  const { repositories } = createProductsHarness([
    "catalog.products.create",
    "catalog.products.update",
  ]);
  // El actor está en TENANT_A con permisos completos; "product-tenant-b" pertenece a OTRO
  // tenant -- getByIdScoped(tenantId, id) tenant-scoped nunca debe encontrarlo.
  await assert.rejects(
    new UpdateProductService(repositories).execute(
      "product-tenant-b",
      buildProductDto({ sku: "TENANT-B-SKU" }),
    ),
    CatalogServiceError,
    "9: mutar un producto de OTRO tenant debe ser DENIED, aunque el actor tenga permisos completos",
  );
  await assert.rejects(
    new ArchiveProductService(repositories).execute("product-tenant-b"),
    CatalogServiceError,
    "9: archivar un producto de OTRO tenant debe ser DENIED",
  );
  // Un ID inexistente y uno de otro tenant responden igual (sin filtrar existencia cross-tenant).
  await assert.rejects(
    new ArchiveProductService(repositories).execute("product-does-not-exist"),
    (error: unknown) =>
      error instanceof CatalogServiceError &&
      error.message === "El producto solicitado no existe.",
    "9: archivar un ID inexistente debe responder CatalogServiceError 'no existe'",
  );
}

// 10. Storefront/public read no sufre regresión
async function verifyStorefrontReadUnaffected() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();
  const repositories = {
    productDataSource: "mock",
    products: new MockProductRepository(store, eventBus),
    tenants: new MockTenantRepository(store, eventBus),
  } as unknown as RepositoryRegistry;

  // GetStorefrontPublishedProductService NO pasa por resolveTenantContext/permissions de
  // Employee -- es la lectura pública del storefront, sin sesión de backoffice. No debe
  // lanzar CatalogServiceError ni exigir ningún permiso.
  const seededProduct = store.getSnapshot().products.find((p) => p.status === ProductStatus.published);
  assert.ok(seededProduct, "fixture: debe existir al menos un producto publicado en el seed");
  const result = await new GetStorefrontPublishedProductService(repositories).execute(
    seededProduct.tenantId,
    seededProduct.id,
  );
  assert.ok(result, "10: la lectura pública del storefront no debe verse afectada");
}

// 11. el listado expone las categorias ACTIVAS del tenant (sin pedir useProductFormOptions)
async function verifyProductsListExposesActiveTenantCategories() {
  const { repositories, store } = createProductsHarness(["catalog.products.read"]);
  store.mutate((db) => {
    db.categories.push({
      id: "cat-archived-products-test",
      tenantId: TENANT_A,
      name: "Categoria archivada",
      slug: "categoria-archivada",
      status: CategoryStatus.archived,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });
  const result = await new GetProductsService(repositories).execute(PRODUCT_LIST_PARAMS);
  assert.ok(result.categories.length > 0, "11: el listado trae categorias para los filtros");
  assert.ok(
    result.categories.every(
      (category) => category.tenantId === TENANT_A && category.status === CategoryStatus.active,
    ),
    "11: solo categorias activas del tenant actual",
  );
  assert.ok(
    !result.categories.some((category) => category.id === "cat-archived-products-test"),
    "11: una categoria archivada no aparece",
  );
  assert.ok(
    !result.categories.some((category) => category.id === "cat-products-hardening-b"),
    "11: una categoria de OTRO tenant no aparece",
  );
  const active = await repositories.categories.getActiveByTenant(TENANT_A);
  assert.deepEqual(
    result.categories.map((category) => category.id),
    active.map((category) => category.id),
    "11: mismo orden que getActiveByTenant",
  );
}

// 12. category.changed invalida el cache de categorias del service (solo el tenant indicado)
async function verifyCategoriesCacheInvalidation() {
  const { repositories } = createProductsHarness(["catalog.products.read"]);
  let categoryLoads = 0;
  const countingCategories = new Proxy(repositories.categories, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (prop === "getByTenant") categoryLoads += 1;
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  const apiService = new GetProductsService({
    ...repositories,
    productDataSource: "api",
    categories: countingCategories,
  } as unknown as RepositoryRegistry);

  await apiService.execute(PRODUCT_LIST_PARAMS);
  await apiService.execute(PRODUCT_LIST_PARAMS);
  assert.equal(categoryLoads, 1, "12: sin invalidacion se reutiliza el cache de categorias");
  apiService.invalidateCategories(TENANT_B);
  await apiService.execute(PRODUCT_LIST_PARAMS);
  assert.equal(categoryLoads, 1, "12: invalidar otro tenant no limpia el cache de este");
  apiService.invalidateCategories(TENANT_A);
  const result = await apiService.execute(PRODUCT_LIST_PARAMS);
  assert.equal(categoryLoads, 2, "12: category.changed fuerza una nueva lectura");
  assert.ok(result.categories.every((category) => category.status === CategoryStatus.active));
}

async function main() {
  await verifyReadPermissionAllowsList();
  console.log("1. catalog.products.read -> listado PASS: PASS");
  await verifyNoPermissionDeniesRead();
  console.log("2. sin permiso -> listado DENIED: PASS");
  await verifyReadOnlyDeniedForAllMutations();
  console.log("3-6. read-only -> create/update/archive/promotion DENIED: PASS");
  await verifyCreatePermissionAllowsCreate();
  console.log("7. catalog.products.create -> create PASS: PASS");
  await verifyUpdatePermissionAllowsMutations();
  console.log("8. catalog.products.update -> update/archive/promotion PASS: PASS");
  await verifyCrossTenantMutationDenied();
  console.log("9. mutación cross-tenant DENIED: PASS");
  await verifyStorefrontReadUnaffected();
  console.log("10. lectura pública de Storefront sin regresión: PASS");
  await verifyProductsListExposesActiveTenantCategories();
  console.log("11. listado expone solo categorías activas del tenant: PASS");
  await verifyCategoriesCacheInvalidation();
  console.log("12. category.changed invalida el cache de categorías por tenant: PASS");
}

void main();
