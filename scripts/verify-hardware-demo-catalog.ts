import assert from "node:assert/strict";
import { publicStorefrontSlug } from "@/config/publicStorefront";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ProductType } from "@/core/enums";
import { calculateEffectivePrice, resolveQuantityPrice } from "@/core/pricing";
import type { CatalogImageSource } from "@/core/entities";
import { getProductMediaSource, normalizeCatalogImageSource } from "@/core/media/catalogImage";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { createMockDatabase } from "@/infrastructure/mock/database/createMockDatabase";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockCategoryRepository } from "@/infrastructure/mock/repositories/MockCategoryRepository";
import { MockBusinessConfigRepository } from "@/infrastructure/mock/repositories/MockBusinessConfigRepository";
import { MockInventoryRepository } from "@/infrastructure/mock/repositories/MockInventoryRepository";
import { MockPlanRepository } from "@/infrastructure/mock/repositories/MockPlanRepository";
import { MockProductKitComponentRepository } from "@/infrastructure/mock/repositories/MockProductKitComponentRepository";
import { MockProductMediaRepository } from "@/infrastructure/mock/repositories/MockProductMediaRepository";
import { MockProductRepository } from "@/infrastructure/mock/repositories/MockProductRepository";
import { MockProductSalesPriceTierRepository } from "@/infrastructure/mock/repositories/MockProductSalesPriceTierRepository";
import { MockTenantRepository } from "@/infrastructure/mock/repositories/MockTenantRepository";
import { MockTenantSubscriptionRepository } from "@/infrastructure/mock/repositories/MockTenantSubscriptionRepository";
import { MockUnitRepository } from "@/infrastructure/mock/repositories/MockUnitRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { MOCK_DATABASE_STORAGE_KEY } from "@/infrastructure/storage/storageKeys";
import { GetStorefrontDiscoveryService } from "@/modules/storefront/application/services/GetStorefrontDiscoveryService";

const TENANT_ID = "tenant-demo";
const EXPECTED_CATEGORY_SLUGS = [
  "herramientas-manuales",
  "herramientas-electricas",
  "tornilleria-fijaciones",
  "electricidad",
  "plomeria",
  "pintura-accesorios",
  "construccion-albanileria",
  "cerrajeria-seguridad",
  "adhesivos-selladores",
  "jardineria",
] as const;

class MemoryStorageAdapter extends LocalStorageAdapter {
  private readonly values = new Map<string, string>();

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

function assertUnique(values: string[], label: string): void {
  assert.equal(new Set(values).size, values.length, `${label} debe ser único`);
}

function assertPublicAsset(source: CatalogImageSource | undefined, label: string): void {
  assert.equal(source?.kind, "url", `${label} debe usar una URL estática segura`);
  assert.ok(
    source?.kind === "url" && source.src.startsWith("/images/"),
    `${label} debe apuntar a /images`,
  );
  assert.ok(
    existsSync(resolve(process.cwd(), "public", source.src.slice(1))),
    `${label} no existe`,
  );
}

function assertEan13(value: string): void {
  assert.match(value, /^\d{13}$/);
  const digits = [...value].map(Number);
  const sum = digits
    .slice(0, 12)
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 1 : 3), 0);
  assert.equal(digits[12], (10 - (sum % 10)) % 10, `checksum EAN-13 inválido: ${value}`);
}

function assertAllReferencesExist(db: ReturnType<typeof createMockDatabase>): void {
  const productIds = new Set(db.products.map(({ id }) => id));
  const categoryIds = new Set(db.categories.map(({ id }) => id));
  const supplierIds = new Set(db.suppliers.map(({ id }) => id));
  const supplierProductIds = new Set(db.supplierProducts.map(({ id }) => id));
  const branchIds = new Set(db.branches.map(({ id }) => id));
  const locationIds = new Set(db.storageLocations.map(({ id }) => id));
  const orderIds = new Set(db.orders.map(({ id }) => id));
  const orderItemIds = new Set(db.orderItems.map(({ id }) => id));
  const purchaseOrderIds = new Set(db.purchaseOrders.map(({ id }) => id));
  const balanceIds = new Set(db.inventoryBalances.map(({ id }) => id));
  const pickingOrderIds = new Set(db.pickingOrders.map(({ id }) => id));
  const dispatchIds = new Set(db.dispatches.map(({ id }) => id));

  db.products.forEach((item) =>
    assert.ok(categoryIds.has(item.categoryId), `category rota: ${item.id}`),
  );
  [
    ...db.productMedia,
    ...db.productPriceHistory,
    ...db.productSalesPriceTiers,
    ...db.productInventorySettings,
    ...db.inventoryBalances,
    ...db.inventoryMovements,
    ...db.inventoryReservations,
    ...db.inventoryTransferRequests,
    ...db.inventoryTransferItems,
    ...db.stockLots,
    ...db.serialNumbers,
    ...db.supplierProducts,
    ...db.purchaseOrderItems,
    ...db.receiptLines,
    ...db.orderItems,
    ...db.pickingItems,
    ...db.saleItems,
  ].forEach((item) => assert.ok(productIds.has(item.productId), `product FK rota: ${item.id}`));
  db.productAttributeValues.forEach((item) =>
    assert.ok(productIds.has(item.productId), `attribute product roto: ${item.id}`),
  );
  db.productKitComponents.forEach((item) => {
    assert.ok(productIds.has(item.kitProductId), `kit roto: ${item.id}`);
    assert.ok(productIds.has(item.componentProductId), `componente roto: ${item.id}`);
  });
  db.promotions.forEach((item) =>
    item.productIds.forEach((id) => assert.ok(productIds.has(id), `promotion product roto: ${id}`)),
  );
  db.supplierProducts.forEach((item) =>
    assert.ok(supplierIds.has(item.supplierId), `supplier roto: ${item.id}`),
  );
  db.supplierCostTiers.forEach((item) =>
    assert.ok(supplierProductIds.has(item.supplierProductId), `supplier tier roto: ${item.id}`),
  );
  db.productInventorySettings.forEach((item) => {
    assert.ok(branchIds.has(item.branchId), `settings branch roto: ${item.id}`);
    assert.ok(
      !item.defaultLocationId || locationIds.has(item.defaultLocationId),
      `settings location rota: ${item.id}`,
    );
  });
  db.inventoryBalances.forEach((item) => {
    assert.ok(branchIds.has(item.branchId), `balance branch roto: ${item.id}`);
    assert.ok(
      item.locationId && locationIds.has(item.locationId),
      `balance location rota: ${item.id}`,
    );
  });
  db.inventoryReservations.forEach((item) =>
    item.allocations.forEach((allocation) =>
      assert.ok(balanceIds.has(allocation.balanceId), `allocation rota: ${item.id}`),
    ),
  );
  db.orderItems.forEach((item) =>
    assert.ok(orderIds.has(item.orderId), `order item roto: ${item.id}`),
  );
  db.purchaseOrderItems.forEach((item) =>
    assert.ok(purchaseOrderIds.has(item.purchaseOrderId), `purchase item roto: ${item.id}`),
  );
  db.pickingItems.forEach((item) => {
    assert.ok(pickingOrderIds.has(item.pickingOrderId), `picking order roto: ${item.id}`);
    assert.ok(orderItemIds.has(item.orderItemId), `picking item/order item roto: ${item.id}`);
  });
  db.dispatches.filter((item) => item.sourceType !== "transfer").forEach((item) =>
    assert.ok(item.orderId && orderIds.has(item.orderId), `dispatch order rota: ${item.id}`),
  );
  db.packages.forEach((item) =>
    assert.ok(dispatchIds.has(item.dispatchId), `package dispatch roto: ${item.id}`),
  );
}

function verifyLegacyPriceTierNormalization(): void {
  const seeded = createMockDatabase();
  assert.ok(seeded.productSalesPriceTiers.length > 0);

  const legacyStorage = new MemoryStorageAdapter();
  const legacy: Partial<ReturnType<typeof createMockDatabase>> = createMockDatabase();
  delete legacy.productSalesPriceTiers;
  legacyStorage.set(MOCK_DATABASE_STORAGE_KEY, legacy);
  const restored = new MockDatabaseStore(legacyStorage).getSnapshot();
  assert.deepEqual(restored.productSalesPriceTiers, seeded.productSalesPriceTiers);
  assert.deepEqual(
    new MockDatabaseStore(legacyStorage).getSnapshot().productSalesPriceTiers,
    restored.productSalesPriceTiers,
  );
  const seededTier = seeded.productSalesPriceTiers[0];
  const tierProduct = restored.products.find((product) => product.id === seededTier.productId);
  assert.ok(tierProduct);
  const productTiers = restored.productSalesPriceTiers.filter((tier) => tier.productId === tierProduct.id);
  const quantityPrice = resolveQuantityPrice({
    basePrice: tierProduct.salePrice, quantity: seededTier.minQuantity, tiers: productTiers,
  });
  assert.equal(quantityPrice, seededTier.unitPrice);
  assert.equal(calculateEffectivePrice(quantityPrice).effectivePrice, quantityPrice);

  const emptyStorage = new MemoryStorageAdapter();
  emptyStorage.set(MOCK_DATABASE_STORAGE_KEY, {
    ...createMockDatabase(), productSalesPriceTiers: [],
  });
  assert.deepEqual(new MockDatabaseStore(emptyStorage).getSnapshot().productSalesPriceTiers, []);
  assert.deepEqual(new MockDatabaseStore(emptyStorage).getSnapshot().productSalesPriceTiers, []);

  const custom = [{ ...seeded.productSalesPriceTiers[0], id: "custom-tier", unitPrice: 321 }];
  const customStorage = new MemoryStorageAdapter();
  customStorage.set(MOCK_DATABASE_STORAGE_KEY, {
    ...createMockDatabase(), productSalesPriceTiers: custom,
  });
  assert.deepEqual(new MockDatabaseStore(customStorage).getSnapshot().productSalesPriceTiers, custom);
  assert.deepEqual(new MockDatabaseStore(customStorage).getSnapshot().productSalesPriceTiers, custom);
}

async function main(): Promise<void> {
  verifyLegacyPriceTierNormalization();
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const db = store.getSnapshot();
  const eventBus = new DataEventBus();
  const repositories = {
    products: new MockProductRepository(store, eventBus),
    categories: new MockCategoryRepository(store, eventBus),
    productMedia: new MockProductMediaRepository(store, eventBus),
    productSalesPriceTiers: new MockProductSalesPriceTierRepository(store, eventBus),
    businessConfig: new MockBusinessConfigRepository(store, eventBus),
    inventory: new MockInventoryRepository(store, eventBus),
    productKitComponents: new MockProductKitComponentRepository(store, eventBus),
    units: new MockUnitRepository(store, eventBus),
    // Requeridos por ensurePublicStorefrontTenant/ResolvePublicStorefrontContextService/
    // ResolveTenantEntitlementsService (feature/saas-entitlement-enforcement, PR #103) --
    // GetStorefrontDiscoveryService.execute ahora revalida el boundary público antes de leer
    // catálogo. tenant-demo (slug "ferrepharma-demo" == publicStorefrontSlug) ya trae, vía
    // demoSeed, Subscription activa -> Plan Enterprise activo con SaasCapabilityKey.ecommerce y
    // EcommerceConfig.enabled=true -- no hace falta fixture nueva, solo exponer estos repos.
    tenants: new MockTenantRepository(store, eventBus),
    plans: new MockPlanRepository(store, eventBus),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
  } as unknown as RepositoryRegistry;

  assert.equal(db.categories.length, 10, "A: deben existir 10 categorías");
  assert.deepEqual(
    db.categories.map(({ slug }) => slug),
    [...EXPECTED_CATEGORY_SLUGS],
  );
  assert.equal(db.products.length, 30, "B: deben existir 30 productos");
  assert.equal(
    db.products.filter(({ productType }) => productType === ProductType.physical).length,
    30,
    "C",
  );
  assert.equal(db.productKitComponents.length, 0, "D/U: no debe haber kits");
  assert.equal(
    db.products.filter(({ productType }) => productType === ProductType.service).length,
    0,
    "E/T",
  );
  assertUnique(
    db.products.map(({ sku }) => sku),
    "F: SKU",
  );
  assertUnique(
    db.products.map(({ barcode }) => barcode ?? ""),
    "G: barcode",
  );
  db.products.forEach(({ barcode }) => assertEan13(barcode ?? ""));

  const productIds = new Set(db.products.map(({ id }) => id));
  const definitionIds = new Set(db.attributeDefinitions.map(({ id }) => id));
  const supplierIds = new Set(db.suppliers.map(({ id }) => id));
  const unitIds = new Set(db.units.map(({ id }) => id));
  const branches = new Map(db.branches.map((item) => [item.id, item]));
  const locations = new Map(db.storageLocations.map((item) => [item.id, item]));

  db.products.forEach((product) => {
    assert.ok(
      db.categories.some(
        (category) => category.id === product.categoryId && category.tenantId === product.tenantId,
      ),
      `H: ${product.id}`,
    );
    assert.ok(product.salePrice > 0, `M: precio inválido ${product.id}`);
    assert.ok(product.channels.ecommerce, `V: ${product.id} no es visible en Web`);
    assert.ok(product.tracking.stock, `Q: ${product.id} debe controlar stock`);
    assert.ok(
      product.saleUnitId && unitIds.has(product.baseUnitId) && unitIds.has(product.saleUnitId),
      `unidad rota: ${product.id}`,
    );
    const media = db.productMedia.filter((item) => item.productId === product.id);
    assert.equal(media.length, 1, `I: ${product.id} debe tener una media`);
    assert.equal(media[0].isPrimary, true);
    assert.equal(media[0].sortOrder, 0);
    assert.equal(media[0].source?.kind, "url");
    assert.equal(media[0].alt, product.name);
    assertPublicAsset(getProductMediaSource(media[0]) ?? undefined, `J: ${product.id}`);
    const attributes = db.productAttributeValues.filter((item) => item.productId === product.id);
    assert.ok(attributes.length >= 2, `L: faltan atributos en ${product.id}`);
    attributes.forEach((item) =>
      assert.ok(definitionIds.has(item.attributeDefinitionId), `definition rota: ${item.id}`),
    );
  });

  db.categories.forEach((category) =>
    assertPublicAsset(
      normalizeCatalogImageSource(category.image) ?? undefined,
      `K/W: ${category.id}`,
    ),
  );
  for (const product of db.products) {
    const tiers = db.productSalesPriceTiers.filter((item) => item.productId === product.id);
    const quantities = tiers.map(({ minQuantity }) => minQuantity);
    assert.deepEqual(
      quantities,
      [...quantities].sort((a, b) => a - b),
      `N: tiers desordenados ${product.id}`,
    );
    assertUnique(quantities.map(String), `N: tier ${product.id}`);
    tiers.forEach((tier) => {
      assert.ok(
        tier.minQuantity > 1 && tier.unitPrice > 0 && tier.unitPrice < product.salePrice,
        `N: tier inválido ${tier.id}`,
      );
    });
  }

  assert.equal(db.suppliers.length, 7, "P: deben existir 7 proveedores sin duplicados");
  assertUnique(
    db.suppliers.map(({ name }) => name.trim().toLocaleLowerCase("es")),
    "P: proveedor",
  );
  assert.equal(
    db.supplierProducts.length,
    30,
    "O: debe existir una relación proveedor por producto",
  );
  db.supplierProducts.forEach((item) => {
    assert.ok(
      productIds.has(item.productId) && supplierIds.has(item.supplierId),
      `O: relación rota ${item.id}`,
    );
    assert.equal(item.tenantId, TENANT_ID);
    assert.ok(item.lastCost > 0 && item.minimumOrderQuantity >= 1 && item.leadTimeDays >= 0);
    assert.ok(unitIds.has(item.purchaseUnitId));
  });

  assert.equal(db.productInventorySettings.length, 30, "Q: settings incompletos");
  assert.equal(db.inventoryBalances.length, 30, "Q: balances incompletos");
  db.inventoryBalances.forEach((balance) => {
    const branch = branches.get(balance.branchId);
    const location = balance.locationId ? locations.get(balance.locationId) : undefined;
    assert.equal(balance.tenantId, TENANT_ID, `X: balance tenant ${balance.id}`);
    assert.equal(branch?.tenantId, TENANT_ID, `Y: branch ${balance.id}`);
    assert.equal(location?.tenantId, TENANT_ID, `Y: location tenant ${balance.id}`);
    assert.equal(location?.branchId, balance.branchId, `Y: location branch ${balance.id}`);
    assert.ok(
      balance.quantity >= 0 &&
        balance.reservedQuantity >= 0 &&
        balance.reservedQuantity <= balance.quantity,
    );
  });
  const balanceBySku = (sku: string) => {
    const product = db.products.find((item) => item.sku === sku)!;
    return db.inventoryBalances.find((item) => item.productId === product.id)!;
  };
  assert.equal(balanceBySku("HER-ELE-002").quantity, 0, "R: Esmeril debe estar agotado");
  const switchBalance = balanceBySku("ELE-INT-001");
  assert.ok(
    switchBalance.minStock !== undefined &&
      switchBalance.quantity > 0 &&
      switchBalance.quantity < switchBalance.minStock,
    "S: Interruptor debe tener stock bajo",
  );

  const storefront = new GetStorefrontDiscoveryService(repositories);
  const tenantUnits = await repositories.units.getByTenant(TENANT_ID);
  const expectedTenantUnits = db.units.filter((unit) => unit.tenantId === TENANT_ID);
  assert.deepEqual(
    tenantUnits.map(({ id }) => id),
    expectedTenantUnits.map(({ id }) => id),
    "V: Storefront debe cargar todas y solo las unidades del tenant",
  );
  assert.ok(
    tenantUnits.length > 0 && tenantUnits.every((unit) => unit.tenantId === TENANT_ID),
    "V: Storefront debe cargar unidades del tenant correcto",
  );
  const discovery = await storefront.execute(publicStorefrontSlug, TENANT_ID);
  assert.equal(discovery.products.length, 30, "V: Ecommerce debe descubrir los 30 productos Web");
  assert.equal(discovery.categories.length, 10, "W: Ecommerce debe descubrir las 10 categorías");
  assert.ok(discovery.products.every(({ imageSource }) => imageSource?.kind === "url"));
  const tenantUnitsById = new Map(tenantUnits.map((unit) => [unit.id, unit]));
  const productsBySku = new Map(db.products.map((product) => [product.sku, product]));
  discovery.products.forEach((product) => {
    const sourceProduct = productsBySku.get(product.sku);
    assert.ok(sourceProduct, `V: producto Storefront sin origen ${product.sku}`);
    const expectedSaleUnitId = sourceProduct.saleUnitId ?? sourceProduct.baseUnitId;
    const expectedSaleUnit = tenantUnitsById.get(expectedSaleUnitId);
    assert.ok(expectedSaleUnit, `V: unidad de venta fuera del tenant ${product.sku}`);
    assert.equal(product.saleUnitId, expectedSaleUnit.id, `V: unit mapping ${product.sku}`);
    assert.equal(product.saleUnitName, expectedSaleUnit.name, `V: unit name ${product.sku}`);
  });
  const soldOutGrinder = discovery.products.find((item) => item.sku === "HER-ELE-002");
  assert.ok(soldOutGrinder, "V: Producto agotado debe continuar visible en ecommerce");
  assert.equal(soldOutGrinder.availableQuantity, 0, "V: Producto agotado debe informar disponibilidad cero");
  assert.ok(discovery.categories.every(({ imageSource }) => imageSource?.kind === "url"));
  // X: aislamiento entre tenants -- PR #103 cerró el bypass donde un tenantId ajeno al público
  // real (tenant-demo) obtenía un resultado filtrado-pero-vacío en vez de ser rechazado.
  // `ensurePublicStorefrontTenant` ahora revalida el tenantId contra el boundary público real
  // ANTES de leer cualquier dato -- un tenantId que no es el tenant público real se rechaza
  // directamente, nunca llega a devolver (ni vacío) catálogo de otro tenant.
  await assert.rejects(
    storefront.execute(publicStorefrontSlug, "tenant-other"),
    "X: un tenantId que no es el Storefront público real debe ser rechazado, nunca devolver datos",
  );

  assertAllReferencesExist(db);
  console.log("Hardware demo catalog A-Z: PASS");
  console.log(
    `categories=${db.categories.length} products=${db.products.length} media=${db.productMedia.length}`,
  );
  console.log(
    `attributes=${db.productAttributeValues.length} priceTiers=${db.productSalesPriceTiers.length} suppliers=${db.suppliers.length}`,
  );
}

void main();
