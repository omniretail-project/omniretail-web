import assert from "node:assert/strict";
import {
  BranchStatus,
  BranchType,
  BusinessPreset,
  PlanCode,
  PlanStatus,
  ProductStatus,
  ProductType,
  PurchaseOrderStatus,
  ReceiptStatus,
  RoleStatus,
  SaasCapabilityKey,
  SupplierStatus,
  TenantStatus,
  TenantSubscriptionStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import {
  MockBranchRepository,
  MockBusinessConfigRepository,
  MockCategoryRepository,
  MockIncidentTypeRepository,
  MockInventoryRepository,
  MockPlanRepository,
  MockProductRepository,
  MockPurchaseOrderRepository,
  MockReceiptRepository,
  MockRoleRepository,
  MockSupplierRepository,
  MockSupplierProductRepository,
  MockTenantRepository,
  MockTenantSubscriptionRepository,
  MockUnitRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { GetPurchaseOrdersReadModelService } from "@/modules/purchasing/application/services/GetPurchaseOrdersReadModelService";
import { PurchaseOrderEditorService } from "@/modules/purchasing/application/services/PurchaseOrderEditorService";
import { PurchaseOrderPdfService } from "@/modules/purchasing/application/services/PurchaseOrderPdfService";
import { UpdatePurchaseOrderStatusService } from "@/modules/purchasing/application/services/UpdatePurchaseOrderStatusService";
import { PurchasingServiceError } from "@/modules/purchasing/application/services/serviceHelpers";
import { ReceivingDocumentDetailService } from "@/modules/receiving/application/services/ReceivingDocumentDetailService";
import { ReceivingServiceError } from "@/modules/receiving/application/services/serviceHelpers";

const TENANT_A = "tenant-demo";
const TENANT_B = "tenant-purchasing-receiving-b";

/**
 * feature/saas-entitlement-enforcement agregó un guard de entitlement SaaS (Plan/Subscription)
 * delante de las mutaciones de Purchasing/Receiving/Inventory/POS -- este harness prueba
 * permisos/tenant/branch, no entitlements (eso vive en verify-saas-entitlement-enforcement.ts),
 * así que TENANT_B necesita un Plan "full" (todas las capabilities, sin límites) para no quedar
 * bloqueado por una capa que este script no está probando. TENANT_A reusa tenant-demo, cuya
 * Subscription real ya es Enterprise (todas las capabilities).
 */
function seedFullEntitlementPlan(db: MockDatabase, tenantId: string) {
  const planId = `plan-full-${tenantId}`;
  db.planDefinitions.push({
    id: planId,
    code: PlanCode.enterprise,
    name: `Plan full (fixture ${tenantId})`,
    status: PlanStatus.active,
    capabilities: Object.values(SaasCapabilityKey),
    limits: {},
    createdAt: NOW,
    updatedAt: NOW,
  });
  db.tenantSubscriptions.push({
    id: `tenant-subscription-${tenantId}`,
    tenantId,
    planId,
    status: TenantSubscriptionStatus.active,
    startedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  });
}
const NOW = "2026-09-15T12:00:00.000Z";

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

interface Session {
  id: string;
  userId: string;
}

/**
 * Un harness compartido (mismo store) con 3 tenants involucrados:
 * - TENANT_A ("tenant-demo", seed real): branch-centro/branch-norte ya existen.
 * - TENANT_B: tenant + branch + categoria + unidad + producto + proveedor propios, para probar
 *   aislamiento cruzado real (no solo "otro id", sino datos que EXISTEN en otro tenant).
 *
 * `createSession(permissions, branchId, allowedBranchIds)` agrega un Role/User nuevos al MISMO
 * store y devuelve un RepositoryRegistry "autenticado" como ese User -- permite probar múltiples
 * combinaciones de permisos/sucursal sin recrear todo el fixture cada vez.
 */
function createHarness() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const eventBus = new DataEventBus();

  store.mutate((db) => {
    db.tenants.push({
      id: TENANT_B,
      name: "Purchasing/Receiving Hardening Tenant B",
      slug: "purchasing-receiving-b",
      status: TenantStatus.active,
      defaultCurrency: "GTQ",
      timezone: "America/Guatemala",
      createdAt: NOW,
      updatedAt: NOW,
    });
    seedFullEntitlementPlan(db, TENANT_B);
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
      id: "branch-hardening-b",
      tenantId: TENANT_B,
      code: "PRB",
      name: "Sucursal B",
      type: BranchType.store,
      status: BranchStatus.active,
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.categories.push({
      id: "cat-hardening-b",
      tenantId: TENANT_B,
      name: "Categoria B",
      slug: "categoria-b",
      status: "active" as never,
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.units.push({
      id: "unit-hardening-b",
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
    db.products.push({
      id: "product-hardening-b",
      tenantId: TENANT_B,
      sku: "HARDENING-B-SKU",
      name: "Producto B",
      productType: ProductType.physical,
      categoryId: "cat-hardening-b",
      baseUnitId: "unit-hardening-b",
      saleUnitId: "unit-hardening-b",
      salePrice: 10,
      status: ProductStatus.published,
      tracking: { stock: true, lot: false, expiration: false, serial: false },
      channels: { ecommerce: false, pos: true, mobileApp: false },
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.suppliers.push({
      id: "supplier-hardening-b",
      tenantId: TENANT_B,
      name: "Proveedor B",
      status: SupplierStatus.active,
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.supplierProducts.push({
      id: "supplier-product-hardening-b",
      tenantId: TENANT_B,
      supplierId: "supplier-hardening-b",
      productId: "product-hardening-b",
      purchaseUnitId: "unit-hardening-b",
      purchaseToBaseFactor: 1,
      lastCost: 5,
      leadTimeDays: 3,
      minimumOrderQuantity: 1,
      preferred: true,
      active: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
    // Fixture de Tenant A: reusa cat-hand-tools/unit-unit del seed real, agrega un Supplier +
    // SupplierProduct propios con un purchaseToBaseFactor DISTINTO de 1 (5) -- exactamente lo
    // que el test #11 necesita para probar que el snapshot no se recalcula ni se pierde.
    db.suppliers.push({
      id: "supplier-hardening-a",
      tenantId: TENANT_A,
      name: "Proveedor A",
      status: SupplierStatus.active,
      createdAt: NOW,
      updatedAt: NOW,
    });
    db.supplierProducts.push({
      id: "supplier-product-hardening-a",
      tenantId: TENANT_A,
      supplierId: "supplier-hardening-a",
      productId: "prod-hammer",
      purchaseUnitId: "unit-box",
      purchaseToBaseFactor: 5,
      lastCost: 20,
      leadTimeDays: 2,
      minimumOrderQuantity: 1,
      preferred: true,
      active: true,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  const sessions = new Map<string, Session>();

  function buildRepositories(session: Session): RepositoryRegistry {
    return {
      auth: {
        getCurrentSessionId: async () => session.id,
        getSession: async (sessionId: string) =>
          sessionId === session.id ? { ...session } : null,
      },
      users: new MockUserRepository(store, eventBus),
      roles: new MockRoleRepository(store, eventBus),
      tenants: new MockTenantRepository(store, eventBus),
      branches: new MockBranchRepository(store, eventBus),
      categories: new MockCategoryRepository(store, eventBus),
      units: new MockUnitRepository(store, eventBus),
      products: new MockProductRepository(store, eventBus),
      suppliers: new MockSupplierRepository(store, eventBus),
      supplierProducts: new MockSupplierProductRepository(store, eventBus),
      purchaseOrders: new MockPurchaseOrderRepository(store, eventBus),
      receipts: new MockReceiptRepository(store, eventBus),
      incidentTypes: new MockIncidentTypeRepository(store, eventBus),
      inventory: new MockInventoryRepository(store, eventBus),
      businessConfig: new MockBusinessConfigRepository(store, eventBus),
      plans: new MockPlanRepository(store, eventBus),
      tenantSubscriptions: new MockTenantSubscriptionRepository(store, eventBus),
    } as unknown as RepositoryRegistry;
  }

  /**
   * Crea un Role+User nuevos en el MISMO store y devuelve un RepositoryRegistry autenticado
   * como ese User. `allowedBranchIds` por defecto es `[]` (sin acceso a ninguna sucursal) --
   * cada test que necesite operar una sucursal debe pedirlo explicitamente.
   */
  function createSession(
    tenantId: string,
    permissions: string[],
    allowedBranchIds: string[] = [],
  ): RepositoryRegistry {
    const suffix = Math.random().toString(36).slice(2, 9);
    const roleId = `role-hardening-${suffix}`;
    const userId = `user-hardening-${suffix}`;
    const sessionId = `session-hardening-${suffix}`;
    store.mutate((db) => {
      db.roles.push({
        id: roleId,
        tenantId,
        name: "Role hardening test",
        isSystem: false,
        permissions,
        branchScope: "all",
        status: RoleStatus.active,
        createdAt: NOW,
        updatedAt: NOW,
      });
      db.users.push({
        id: userId,
        tenantId,
        name: "Hardening Tester",
        email: `${userId}@hardening.test`,
        type: UserType.employee,
        status: UserStatus.active,
        roleId,
        allowedBranchIds,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    const session = { id: sessionId, userId };
    sessions.set(sessionId, session);
    return buildRepositories(session);
  }

  return { store, createSession };
}

function buildOrderLine(
  overrides: {
    productId?: string;
    unitId?: string;
    purchaseToBaseFactor?: number;
  } = {},
) {
  return {
    id: "line-1",
    productId: overrides.productId ?? "prod-hammer",
    productName: "Martillo",
    sku: "HAMMER",
    supplierSku: "-",
    unitId: overrides.unitId ?? "unit-box",
    unitLabel: "cj",
    unitAllowsDecimals: false,
    purchaseToBaseFactor: overrides.purchaseToBaseFactor ?? 5,
    quantity: 2,
    baseCost: 20,
    suggestedCost: 20,
    agreedCost: 20,
    subtotal: 40,
    manualCost: true,
    minimumOrderQuantity: 1,
    tiers: [],
    stockQuantity: 0,
    minStock: 0,
    shortage: 0,
    suggestedReorder: 0,
    availabilityLabel: "Disponible",
  };
}

/**
 * Envuelve `repositories.receipts` en un Proxy que registra cuantas veces se llama `getAll()`
 * y con que `tenantId` se llama `listByTenant()`, delegando el resto sin modificar comportamiento
 * -- usado por el test B para probar (desde afuera, sin tocar el metodo privado `getPdfData`) que
 * `PurchaseOrderPdfService` consulta receipts EXCLUSIVAMENTE via `listByTenant(tenantId)` y nunca
 * via `getAll()` (BLOCKER #2: antes cargaba receipts de todos los tenants al Application Service).
 */
function wrapReceiptsWithSpy(receipts: RepositoryRegistry["receipts"]) {
  const calls = { getAll: 0, listByTenant: [] as string[] };
  const proxy = new Proxy(receipts, {
    get(target, prop) {
      if (prop === "getAll") {
        return (...args: unknown[]) => {
          calls.getAll += 1;
          return (target.getAll as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      if (prop === "listByTenant") {
        return (...args: unknown[]) => {
          calls.listByTenant.push(args[0] as string);
          return (target.listByTenant as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      const value = Reflect.get(target, prop as keyof typeof target);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  }) as RepositoryRegistry["receipts"];
  return { proxy, calls };
}

// 1. tenant A no lista ordenes B
async function verifyPurchaseOrdersListTenantIsolation() {
  const { createSession } = createHarness();
  const repositoriesA = createSession(TENANT_A, ["purchasing.orders.create"], ["branch-centro"]);
  const repositoriesB = createSession(TENANT_B, ["purchasing.orders.create"], [
    "branch-hardening-b",
  ]);

  const orderB = await new PurchaseOrderEditorService(repositoriesB).createOrder({
    branchId: "branch-hardening-b",
    supplierId: "supplier-hardening-b",
    expectedDate: "2026-10-01",
    notes: "",
    lines: [
      buildOrderLine({
        productId: "product-hardening-b",
        unitId: "unit-hardening-b",
        purchaseToBaseFactor: 1,
      }),
    ],
  });

  const listA = await new GetPurchaseOrdersReadModelService(repositoriesA).execute();
  assert.ok(
    !listA.orders.some((order) => order.id === orderB.id),
    "1: la orden de Tenant B no debe aparecer en el listado de Tenant A",
  );
}

// 2. cross-tenant detail denied (Purchasing editor)
async function verifyPurchasingCrossTenantDetailDenied() {
  const { createSession } = createHarness();
  const repositoriesA = createSession(TENANT_A, ["purchasing.orders.create"], ["branch-centro"]);
  const repositoriesB = createSession(TENANT_B, ["purchasing.orders.create"], [
    "branch-hardening-b",
  ]);

  const orderB = await new PurchaseOrderEditorService(repositoriesB).createOrder({
    branchId: "branch-hardening-b",
    supplierId: "supplier-hardening-b",
    expectedDate: "2026-10-01",
    notes: "",
    lines: [
      buildOrderLine({
        productId: "product-hardening-b",
        unitId: "unit-hardening-b",
        purchaseToBaseFactor: 1,
      }),
    ],
  });
  // createOrder deja la orden en pending_approval -- volverla a draft directo en el store para
  // que getOrderForEdit (solo edita drafts) tenga algo que rechazar por TENANT, no por status.
  await backdoorSetStatus(repositoriesA, orderB.id, PurchaseOrderStatus.draft);

  await assert.rejects(
    new PurchaseOrderEditorService(repositoriesA).getOrderForEdit(orderB.id),
    PurchasingServiceError,
    "2: Tenant A no debe poder abrir el editor de una orden de Tenant B",
  );
}

async function backdoorSetStatus(
  repositories: RepositoryRegistry,
  orderId: string,
  status: PurchaseOrderStatus,
) {
  // Bypass deliberado SOLO para preparar fixtures del test (nunca para probar autorizacion) --
  // usa el repositorio global sin scope porque el actor de este harness puede no pertenecer al
  // tenant de la orden.
  await repositories.purchaseOrders.updateStatus(orderId, status);
}

// 3. read-only list PASS
async function verifyReadOnlyListPass() {
  const { createSession } = createHarness();
  const repositories = createSession(TENANT_A, ["purchasing.orders.read"], ["branch-centro"]);
  const result = await new GetPurchaseOrdersReadModelService(repositories).execute();
  assert.ok(Array.isArray(result.orders), "3: read-only debe poder listar ordenes");
}

// 4. read-only -> create denied
async function verifyReadOnlyCreateDenied() {
  const { createSession } = createHarness();
  const repositories = createSession(TENANT_A, ["purchasing.orders.read"], ["branch-centro"]);
  await assert.rejects(
    new PurchaseOrderEditorService(repositories).createOrder({
      branchId: "branch-centro",
      supplierId: "supplier-hardening-a",
      expectedDate: "2026-10-01",
      notes: "",
      lines: [buildOrderLine()],
    }),
    PurchasingServiceError,
    "4: read-only -> createOrder debe ser DENIED",
  );
  await assert.rejects(
    new PurchaseOrderEditorService(repositories).saveDraft({
      branchId: "branch-centro",
      supplierId: "supplier-hardening-a",
      expectedDate: "2026-10-01",
      notes: "",
      lines: [buildOrderLine()],
    }),
    PurchasingServiceError,
    "4: read-only -> saveDraft debe ser DENIED",
  );
}

// 5. read-only -> approve/cancel denied
async function verifyReadOnlyApproveDenied() {
  const { createSession } = createHarness();
  const repositoriesCreator = createSession(
    TENANT_A,
    ["purchasing.orders.create"],
    ["branch-centro"],
  );
  const order = await new PurchaseOrderEditorService(repositoriesCreator).createOrder({
    branchId: "branch-centro",
    supplierId: "supplier-hardening-a",
    expectedDate: "2026-10-01",
    notes: "",
    lines: [buildOrderLine()],
  });

  const repositoriesReadOnly = createSession(
    TENANT_A,
    ["purchasing.orders.read"],
    ["branch-centro"],
  );
  await assert.rejects(
    new UpdatePurchaseOrderStatusService(repositoriesReadOnly).execute(
      order.id,
      PurchaseOrderStatus.approved,
    ),
    PurchasingServiceError,
    "5: read-only -> aprobar debe ser DENIED",
  );
  await assert.rejects(
    new UpdatePurchaseOrderStatusService(repositoriesReadOnly).execute(
      order.id,
      PurchaseOrderStatus.cancelled,
    ),
    PurchasingServiceError,
    "5: read-only -> cancelar debe ser DENIED",
  );
}

// 6. direct service bypass denied -- el DTO ya no acepta tenantId; el bypass real a probar es
// que un actor de TENANT_A no puede tocar (ni leer para editar) una orden de TENANT_B llamando
// al service DIRECTO, sin pasar por ningun hook/UI.
async function verifyDirectServiceBypassDenied() {
  const { createSession } = createHarness();
  const repositoriesB = createSession(TENANT_B, ["purchasing.orders.create"], [
    "branch-hardening-b",
  ]);
  const orderB = await new PurchaseOrderEditorService(repositoriesB).createOrder({
    branchId: "branch-hardening-b",
    supplierId: "supplier-hardening-b",
    expectedDate: "2026-10-01",
    notes: "",
    lines: [
      buildOrderLine({
        productId: "product-hardening-b",
        unitId: "unit-hardening-b",
        purchaseToBaseFactor: 1,
      }),
    ],
  });

  const repositoriesA = createSession(
    TENANT_A,
    ["purchasing.orders.create", "purchasing.orders.approve"],
    ["branch-centro"],
  );
  await assert.rejects(
    new PurchaseOrderEditorService(repositoriesA).saveDraft({
      orderId: orderB.id,
      branchId: "branch-centro",
      supplierId: "supplier-hardening-a",
      expectedDate: "2026-10-01",
      notes: "intento de bypass",
      lines: [buildOrderLine()],
    }),
    PurchasingServiceError,
    "6: saveDraft con un orderId de OTRO tenant debe ser DENIED, sin importar los permisos del actor",
  );
  await assert.rejects(
    new UpdatePurchaseOrderStatusService(repositoriesA).execute(
      orderB.id,
      PurchaseOrderStatus.approved,
    ),
    PurchasingServiceError,
    "6: aprobar directamente una orden de OTRO tenant debe ser DENIED",
  );
}

// 7. receiving cross-tenant denied
async function verifyReceivingCrossTenantDenied() {
  const { createSession } = createHarness();
  const repositoriesB = createSession(
    TENANT_B,
    ["purchasing.orders.create", "purchasing.orders.approve"],
    ["branch-hardening-b"],
  );
  const orderB = await new PurchaseOrderEditorService(repositoriesB).createOrder({
    branchId: "branch-hardening-b",
    supplierId: "supplier-hardening-b",
    expectedDate: "2026-10-01",
    notes: "",
    lines: [
      buildOrderLine({
        productId: "product-hardening-b",
        unitId: "unit-hardening-b",
        purchaseToBaseFactor: 1,
      }),
    ],
  });
  await new UpdatePurchaseOrderStatusService(repositoriesB).execute(
    orderB.id,
    PurchaseOrderStatus.approved,
  );

  const repositoriesA = createSession(
    TENANT_A,
    ["receiving.receipts.read", "receiving.receipts.confirm"],
    ["branch-centro"],
  );
  await assert.rejects(
    new ReceivingDocumentDetailService(repositoriesA).getDocument("purchase_order", orderB.id),
    ReceivingServiceError,
    "7: Tenant A no debe poder abrir el detalle de recepcion de una orden de Tenant B",
  );
  await assert.rejects(
    new ReceivingDocumentDetailService(repositoriesA).confirm({
      documentType: "purchase_order",
      documentId: orderB.id,
      confirmationId: "confirm-cross-tenant",
      lines: [],
      incidents: [],
    }),
    ReceivingServiceError,
    "7: confirmar la recepcion de una orden de Tenant B desde Tenant A debe ser DENIED",
  );
}

// 8. receiving foreign branch denied
async function verifyReceivingForeignBranchDenied() {
  const { createSession } = createHarness();
  const repositoriesCreator = createSession(
    TENANT_A,
    ["purchasing.orders.create", "purchasing.orders.approve"],
    ["branch-centro"],
  );
  const order = await new PurchaseOrderEditorService(repositoriesCreator).createOrder({
    branchId: "branch-centro",
    supplierId: "supplier-hardening-a",
    expectedDate: "2026-10-01",
    notes: "",
    lines: [buildOrderLine()],
  });
  await new UpdatePurchaseOrderStatusService(repositoriesCreator).execute(
    order.id,
    PurchaseOrderStatus.approved,
  );

  // Mismo TENANT, pero sin branch-centro en allowedBranchIds (solo branch-norte) -- debe
  // denegarse por sucursal, no por tenant.
  const repositoriesForeignBranch = createSession(
    TENANT_A,
    ["receiving.receipts.read", "receiving.receipts.confirm"],
    ["branch-norte"],
  );
  await assert.rejects(
    new ReceivingDocumentDetailService(repositoriesForeignBranch).getDocument(
      "purchase_order",
      order.id,
    ),
    ReceivingServiceError,
    "8: un actor sin branch-centro en allowedBranchIds debe ser DENIED aunque sea del mismo tenant",
  );
}

// 9. confirm without permission denied
async function verifyConfirmWithoutPermissionDenied() {
  const { createSession } = createHarness();
  const repositoriesCreator = createSession(
    TENANT_A,
    ["purchasing.orders.create", "purchasing.orders.approve"],
    ["branch-centro"],
  );
  const order = await new PurchaseOrderEditorService(repositoriesCreator).createOrder({
    branchId: "branch-centro",
    supplierId: "supplier-hardening-a",
    expectedDate: "2026-10-01",
    notes: "",
    lines: [buildOrderLine()],
  });
  await new UpdatePurchaseOrderStatusService(repositoriesCreator).execute(
    order.id,
    PurchaseOrderStatus.approved,
  );

  const repositoriesReadOnly = createSession(
    TENANT_A,
    ["receiving.receipts.read"],
    ["branch-centro"],
  );
  const detail = await new ReceivingDocumentDetailService(repositoriesReadOnly).getDocument(
    "purchase_order",
    order.id,
  );
  assert.ok(detail, "9 (fixture): read-only SI puede ver el detalle de recepcion");
  await assert.rejects(
    new ReceivingDocumentDetailService(repositoriesReadOnly).confirm({
      documentType: "purchase_order",
      documentId: order.id,
      confirmationId: "confirm-no-permission",
      lines: detail.lines.map((line) => ({ ...line, receivedNow: line.orderedQuantity })),
      incidents: [],
    }),
    ReceivingServiceError,
    "9: confirmar sin receiving.receipts.confirm debe ser DENIED",
  );
  await assert.rejects(
    new ReceivingDocumentDetailService(repositoriesReadOnly).saveProgress({
      documentType: "purchase_order",
      documentId: order.id,
      lines: detail.lines,
      incidents: [],
    }),
    ReceivingServiceError,
    "9: guardar avance sin receiving.receipts.create/confirm debe ser DENIED",
  );
}

// 10. authorized flows PASS (end-to-end: crear -> aprobar -> recibir -> confirmar)
// 11. purchaseToBaseFactor snapshot intacto (verificado en cada paso de este mismo flujo)
async function verifyAuthorizedFlowsPassAndSnapshotPreserved() {
  const { createSession } = createHarness();
  const purchaser = createSession(
    TENANT_A,
    ["purchasing.orders.create", "purchasing.orders.approve"],
    ["branch-centro"],
  );
  const receiver = createSession(
    TENANT_A,
    ["receiving.receipts.create", "receiving.receipts.confirm"],
    ["branch-centro"],
  );

  const draft = await new PurchaseOrderEditorService(purchaser).saveDraft({
    branchId: "branch-centro",
    supplierId: "supplier-hardening-a",
    expectedDate: "2026-10-01",
    notes: "",
    lines: [buildOrderLine({ purchaseToBaseFactor: 5 })],
  });
  assert.equal(draft.status, PurchaseOrderStatus.draft, "10: saveDraft debe crear un borrador");
  assert.equal(
    draft.items?.[0]?.purchaseToBaseFactor,
    5,
    "11: purchaseToBaseFactor debe persistirse tal cual en el draft",
  );

  const submitted = await new PurchaseOrderEditorService(purchaser).createOrder({
    orderId: draft.id,
    branchId: "branch-centro",
    supplierId: "supplier-hardening-a",
    expectedDate: "2026-10-01",
    notes: "",
    lines: [buildOrderLine({ purchaseToBaseFactor: 5 })],
  });
  assert.equal(submitted.status, PurchaseOrderStatus.pending_approval, "10: submit -> pending_approval");
  assert.equal(
    submitted.items?.[0]?.purchaseToBaseFactor,
    5,
    "11: purchaseToBaseFactor debe sobrevivir a updateScoped (draft -> pending_approval)",
  );

  const approved = await new UpdatePurchaseOrderStatusService(purchaser).execute(
    submitted.id,
    PurchaseOrderStatus.approved,
  );
  assert.equal(approved.status, PurchaseOrderStatus.approved, "10: aprobar -> approved");
  assert.equal(
    approved.items?.[0]?.purchaseToBaseFactor,
    5,
    "11: purchaseToBaseFactor debe sobrevivir a updateStatusScoped",
  );

  const detail = await new ReceivingDocumentDetailService(receiver).getDocument(
    "purchase_order",
    approved.id,
  );
  assert.equal(
    detail.lines[0]?.purchaseToBaseFactor,
    5,
    "11: el detalle de recepcion debe exponer el mismo purchaseToBaseFactor de la orden",
  );

  const receipt = await new ReceivingDocumentDetailService(receiver).confirm({
    documentType: "purchase_order",
    documentId: approved.id,
    confirmationId: "confirm-authorized-flow",
    lines: detail.lines.map((line) => ({ ...line, receivedNow: line.orderedQuantity })),
    incidents: [],
  });
  // El flujo recibe TODA la cantidad ordenada (receivedNow = orderedQuantity en cada linea).
  // `MockReceiptRepository.confirmReceiptInventory` calcula `totalOrdered` desde
  // `db.purchaseOrderItems` (corregido en commits anteriores a PR5; antes leia `order.items`, que
  // nunca estaba poblado y dejaba la recepcion siempre en "partial"). Con ese calculo correcto,
  // recibir todo lo ordenado completa la recepcion: `received` es el resultado esperado.
  assert.equal(
    receipt.status,
    ReceiptStatus.received,
    "10: confirmar la cantidad ordenada completa debe dejar la recepcion en received",
  );

  const balances = await receiver.inventory.getBalanceByProduct("prod-hammer", "branch-centro");
  const totalReceived = balances.reduce((sum, balance) => sum + balance.quantity, 0);
  assert.ok(
    totalReceived >= 2,
    "10: confirmar debe reflejarse en el balance de inventario (no solo cambiar el status)",
  );
}

// A. read model Tenant A no contiene Supplier Tenant B (BLOCKER 1)
async function verifySupplierReadModelTenantIsolation() {
  const { createSession } = createHarness();
  const repositoriesA = createSession(TENANT_A, ["purchasing.orders.read"], ["branch-centro"]);
  const result = await new GetPurchaseOrdersReadModelService(repositoriesA).execute();
  assert.ok(
    result.suppliers.some((supplier) => supplier.id === "supplier-hardening-a"),
    "A (fixture): el read model de Tenant A debe incluir su propio proveedor",
  );
  assert.ok(
    !result.suppliers.some((supplier) => supplier.id === "supplier-hardening-b"),
    "A: el read model de Tenant A NO debe incluir el proveedor de Tenant B",
  );
}

// B. PurchaseOrderPdfService de Tenant A no consulta/devuelve receipts Tenant B (BLOCKER 2)
async function verifyPurchaseOrderPdfReceiptsTenantIsolation() {
  const { createSession } = createHarness();
  const purchaserA = createSession(
    TENANT_A,
    ["purchasing.orders.create", "purchasing.orders.approve"],
    ["branch-centro"],
  );
  const orderA = await new PurchaseOrderEditorService(purchaserA).createOrder({
    branchId: "branch-centro",
    supplierId: "supplier-hardening-a",
    expectedDate: "2026-10-01",
    notes: "",
    lines: [buildOrderLine()],
  });
  await new UpdatePurchaseOrderStatusService(purchaserA).execute(
    orderA.id,
    PurchaseOrderStatus.approved,
  );

  const { proxy, calls } = wrapReceiptsWithSpy(purchaserA.receipts);
  const pdfRepositories = { ...purchaserA, receipts: proxy } as RepositoryRegistry;
  // Flujo publico real de descarga (downloadPurchaseOrder). En Node, `doc.save` escribiria el PDF
  // en el cwd; jsPDF define `save` por instancia dentro del constructor (no en el prototype), asi
  // que se sobrescribe con su mecanismo documentado de plugins (`jsPDF.API`), que el constructor
  // aplica sobre cada instancia nueva. No es parte de lo que se prueba: solo evita escribir a disco.
  const { jsPDF } = await import("jspdf");
  const pdfPlugins = jsPDF.API as unknown as Record<string, unknown>;
  const hadSave = Object.prototype.hasOwnProperty.call(pdfPlugins, "save");
  const originalSave = pdfPlugins.save;
  pdfPlugins.save = function save(this: unknown) {
    return this;
  };
  try {
    // Debe completar sin lanzar; que haya pasado por getPdfData lo prueban las aserciones de abajo.
    await new PurchaseOrderPdfService(pdfRepositories).downloadPurchaseOrder(orderA.id);
  } finally {
    if (hadSave) pdfPlugins.save = originalSave;
    else delete pdfPlugins.save;
  }
  assert.equal(
    calls.getAll,
    0,
    "B: PurchaseOrderPdfService NO debe llamar receipts.getAll() (cargaria receipts cross-tenant)",
  );
  assert.deepEqual(
    calls.listByTenant,
    [TENANT_A],
    "B: PurchaseOrderPdfService debe consultar receipts SOLO con listByTenant(TENANT_A)",
  );
}

// C. rol read-only: "Aprobar" debe quedar disabled/ausente
async function verifyReadOnlyApproveActionDisabled() {
  const { createSession } = createHarness();
  const purchaser = createSession(TENANT_A, ["purchasing.orders.create"], ["branch-centro"]);
  const order = await new PurchaseOrderEditorService(purchaser).createOrder({
    branchId: "branch-centro",
    supplierId: "supplier-hardening-a",
    expectedDate: "2026-10-01",
    notes: "",
    lines: [buildOrderLine()],
  });
  assert.equal(
    order.status,
    PurchaseOrderStatus.pending_approval,
    "C (fixture): createOrder debe dejar la orden en pending_approval",
  );

  const readOnly = createSession(TENANT_A, ["purchasing.orders.read"], ["branch-centro"]);
  const result = await new GetPurchaseOrdersReadModelService(readOnly).execute();
  const row = result.orders.find((item) => item.id === order.id);
  assert.ok(row, "C (fixture): read-only debe poder ver la orden en el listado");
  const approveAction = row!.actions.find((action) => action.id === "approve");
  assert.ok(
    !approveAction || approveAction.enabled === false,
    "C: read-only + pending_approval => 'Aprobar' no debe quedar enabled",
  );
}

// D. rol read-only: "Editar"/"Cancelar" deben quedar disabled cuando requieren permiso mutable
async function verifyReadOnlyEditCancelActionsDisabled() {
  const { createSession } = createHarness();
  const purchaser = createSession(TENANT_A, ["purchasing.orders.create"], ["branch-centro"]);
  const draft = await new PurchaseOrderEditorService(purchaser).saveDraft({
    branchId: "branch-centro",
    supplierId: "supplier-hardening-a",
    expectedDate: "2026-10-01",
    notes: "",
    lines: [buildOrderLine()],
  });
  assert.equal(
    draft.status,
    PurchaseOrderStatus.draft,
    "D (fixture): saveDraft debe crear un borrador",
  );

  const readOnly = createSession(TENANT_A, ["purchasing.orders.read"], ["branch-centro"]);
  const result = await new GetPurchaseOrdersReadModelService(readOnly).execute();
  const row = result.orders.find((item) => item.id === draft.id);
  assert.ok(row, "D (fixture): read-only debe poder ver el borrador en el listado");
  const editAction = row!.actions.find((action) => action.id === "edit-draft");
  const cancelAction = row!.actions.find((action) => action.id === "cancel");
  assert.ok(
    !editAction || editAction.enabled === false,
    "D: read-only + draft => 'Editar' no debe quedar enabled",
  );
  assert.ok(
    !cancelAction || cancelAction.enabled === false,
    "D: read-only + draft => 'Cancelar' no debe quedar enabled",
  );
}

// E. rol autorizado: las acciones validas siguen enabled segun el estado
async function verifyAuthorizedRoleActionsRemainEnabled() {
  const { createSession } = createHarness();
  const purchaser = createSession(
    TENANT_A,
    ["purchasing.orders.create", "purchasing.orders.approve"],
    ["branch-centro"],
  );
  const draft = await new PurchaseOrderEditorService(purchaser).saveDraft({
    branchId: "branch-centro",
    supplierId: "supplier-hardening-a",
    expectedDate: "2026-10-01",
    notes: "",
    lines: [buildOrderLine()],
  });

  const draftResult = await new GetPurchaseOrdersReadModelService(purchaser).execute();
  const draftRow = draftResult.orders.find((item) => item.id === draft.id);
  assert.ok(draftRow, "E (fixture): debe ver el borrador en el listado");
  assert.equal(
    draftRow!.actions.find((action) => action.id === "edit-draft")?.enabled,
    true,
    "E: create+approve + draft => 'Editar' debe quedar enabled",
  );
  assert.equal(
    draftRow!.actions.find((action) => action.id === "send-approval")?.enabled,
    true,
    "E: create+approve + draft => 'Crear orden' debe quedar enabled",
  );

  const submitted = await new PurchaseOrderEditorService(purchaser).createOrder({
    orderId: draft.id,
    branchId: "branch-centro",
    supplierId: "supplier-hardening-a",
    expectedDate: "2026-10-01",
    notes: "",
    lines: [buildOrderLine()],
  });
  const pendingResult = await new GetPurchaseOrdersReadModelService(purchaser).execute();
  const pendingRow = pendingResult.orders.find((item) => item.id === submitted.id);
  assert.ok(pendingRow, "E (fixture): debe ver la orden pending_approval en el listado");
  assert.equal(
    pendingRow!.actions.find((action) => action.id === "approve")?.enabled,
    true,
    "E: approve + pending_approval => 'Aprobar' debe quedar enabled",
  );

  await new UpdatePurchaseOrderStatusService(purchaser).execute(
    submitted.id,
    PurchaseOrderStatus.approved,
  );
  const approvedResult = await new GetPurchaseOrdersReadModelService(purchaser).execute();
  const approvedRow = approvedResult.orders.find((item) => item.id === submitted.id);
  assert.ok(approvedRow, "E (fixture): debe ver la orden approved en el listado");
  assert.equal(
    approvedRow!.actions.find((action) => action.id === "continue-receiving")?.enabled,
    true,
    "E: accion de solo lectura ('Iniciar recepcion') debe quedar enabled sin permiso adicional",
  );
  assert.equal(
    approvedRow!.actions.find((action) => action.id === "cancel")?.enabled,
    true,
    "E: approve + approved => 'Cancelar' debe quedar enabled",
  );
}

/**
 * Envuelve un repository en un Proxy que cuenta llamadas (por metodo y en total) y delega sin
 * cambiar comportamiento. Permite probar desde afuera cuantas lecturas hace un service.
 */
function spyOnMethods<T extends object>(target: T, names: string[]) {
  const calls: Record<string, number> & { total: number } = { total: 0 };
  for (const name of names) calls[name] = 0;
  const proxy = new Proxy(target, {
    get(object, prop) {
      const value = Reflect.get(object, prop);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        calls.total += 1;
        if (typeof prop === "string" && prop in calls) calls[prop] += 1;
        return (value as (...a: unknown[]) => unknown).apply(object, args);
      };
    },
  });
  return { proxy, calls };
}

// F. Editar una orden carga los productos disponibles UNA sola vez y conserva sus datos
async function verifyEditLoadsAvailableProductsOnce() {
  const { createSession, store } = createHarness();
  const purchaser = createSession(TENANT_A, ["purchasing.orders.create"], ["branch-centro"]);
  const draft = await new PurchaseOrderEditorService(purchaser).saveDraft({
    branchId: "branch-centro",
    supplierId: "supplier-hardening-a",
    expectedDate: "2026-10-01",
    notes: "",
    lines: [buildOrderLine({ purchaseToBaseFactor: 5 })],
  });

  const supplierProductsSpy = spyOnMethods(purchaser.supplierProducts, ["getBySupplierForTenant"]);
  const unitsSpy = spyOnMethods(purchaser.units, ["getByIdScoped"]);
  const spied = {
    ...purchaser,
    supplierProducts: supplierProductsSpy.proxy,
    units: unitsSpy.proxy,
  } as RepositoryRegistry;

  const loaded = await new PurchaseOrderEditorService(spied).getOrderForEdit(
    draft.id,
    "branch-centro",
  );
  assert.equal(
    supplierProductsSpy.calls.getBySupplierForTenant,
    1,
    "F: la edicion consulta el catalogo del proveedor una sola vez",
  );
  assert.equal(
    unitsSpy.calls.getByIdScoped,
    0,
    "F: la edicion ya no lee las unidades de cada linea",
  );

  const line = loaded.model.lines[0];
  const available = loaded.availableProducts.find((product) => product.productId === line.productId);
  assert.ok(available, "F: la linea corresponde a un producto disponible devuelto junto al modelo");
  assert.equal(line.unitAllowsDecimals, available.unitAllowsDecimals);
  assert.equal(line.purchaseToBaseFactor, 5, "F: el factor de compra se conserva");
  assert.equal(line.minimumOrderQuantity, available.minimumOrderQuantity);
  assert.equal(line.leadTimeDays, available.leadTimeDays);
  assert.deepEqual(line.tiers, available.tiers);

  // La coleccion devuelta es la misma que entrega getAvailableProducts directo.
  const direct = await new PurchaseOrderEditorService(purchaser).getAvailableProducts(
    "supplier-hardening-a",
    "branch-centro",
  );
  assert.deepEqual(
    loaded.availableProducts.map((product) => product.productId),
    direct.map((product) => product.productId),
  );

  // Fail-closed: si la linea ya no tiene producto operacional valido, la edicion sigue fallando.
  store.mutate((db) => {
    const supplierProduct = db.supplierProducts.find(
      (item) => item.id === "supplier-product-hardening-a",
    );
    assert.ok(supplierProduct);
    supplierProduct.active = false;
  });
  await assert.rejects(
    new PurchaseOrderEditorService(purchaser).getOrderForEdit(draft.id, "branch-centro"),
    PurchasingServiceError,
    "F: una linea sin producto operacional valido sigue fallando (fail-closed)",
  );
}

// G. La pagina de ordenes no carga sugerencias; se piden aparte (panel expandido)
async function verifyOrdersPageDoesNotLoadSuggestions() {
  const { createSession } = createHarness();
  const reader = createSession(
    TENANT_A,
    ["purchasing.orders.read", "inventory.stock.read"],
    ["branch-centro"],
  );
  const inventorySpy = spyOnMethods(reader.inventory, []);
  const spied = { ...reader, inventory: inventorySpy.proxy } as RepositoryRegistry;
  const service = new GetPurchaseOrdersReadModelService(spied);

  const page = await service.execute("branch-centro");
  assert.deepEqual(page.suggestions, [], "G: la pagina de ordenes no trae sugerencias");
  assert.equal(
    inventorySpy.calls.total,
    0,
    "G: cargar ordenes no consulta inventario (0 lecturas exclusivas de sugerencias)",
  );

  // Este harness no registra todos los repositories que usa el calculo mock de sugerencias
  // (p. ej. transferencias), asi que solo se verifica que PEDIRLAS si consulta inventario.
  await service.loadReorderSuggestions("branch-centro").catch(() => undefined);
  assert.ok(inventorySpy.calls.total > 0, "G: las sugerencias se calculan al pedirlas");
  assert.deepEqual(await service.loadReorderSuggestions(undefined), { suggestions: [] });
}

async function main() {
  // F/G usan su propio harness y no dependen de ningun caso posterior: corren primero para que
  // su cobertura no quede oculta si un caso previo del script falla.
  await verifyEditLoadsAvailableProductsOnce();
  console.log("F. editar orden: availableProducts una sola vez, datos y fail-closed: PASS");
  await verifyOrdersPageDoesNotLoadSuggestions();
  console.log("G. pagina de ordenes sin sugerencias; se cargan aparte: PASS");
  await verifyPurchaseOrdersListTenantIsolation();
  console.log("1. tenant A no lista ordenes de tenant B: PASS");
  await verifyPurchasingCrossTenantDetailDenied();
  console.log("2. cross-tenant detail (purchasing editor) denied: PASS");
  await verifyReadOnlyListPass();
  console.log("3. read-only list PASS: PASS");
  await verifyReadOnlyCreateDenied();
  console.log("4. read-only -> create/saveDraft denied: PASS");
  await verifyReadOnlyApproveDenied();
  console.log("5. read-only -> approve/cancel denied: PASS");
  await verifyDirectServiceBypassDenied();
  console.log("6. direct service bypass (cross-tenant) denied: PASS");
  await verifyReceivingCrossTenantDenied();
  console.log("7. receiving cross-tenant denied: PASS");
  await verifyReceivingForeignBranchDenied();
  console.log("8. receiving foreign branch denied: PASS");
  await verifyConfirmWithoutPermissionDenied();
  console.log("9. confirm without receiving.receipts.confirm denied: PASS");
  await verifyAuthorizedFlowsPassAndSnapshotPreserved();
  console.log("10-11. authorized flow end-to-end + purchaseToBaseFactor snapshot: PASS");
  await verifySupplierReadModelTenantIsolation();
  console.log("A. read model Tenant A no contiene Supplier Tenant B: PASS");
  await verifyPurchaseOrderPdfReceiptsTenantIsolation();
  console.log("B. PurchaseOrderPdfService Tenant A no consulta/devuelve receipts Tenant B: PASS");
  await verifyReadOnlyApproveActionDisabled();
  console.log("C. read-only + pending_approval: 'Aprobar' disabled/ausente: PASS");
  await verifyReadOnlyEditCancelActionsDisabled();
  console.log("D. read-only + draft: 'Editar'/'Cancelar' disabled: PASS");
  await verifyAuthorizedRoleActionsRemainEnabled();
  console.log("E. rol autorizado: acciones validas siguen enabled segun estado: PASS");
}

void main();
