import {
  BusinessPreset,
  CustomerPaymentMethodStatus,
  InventoryAdjustmentType,
  InventoryTransferReason,
  InventoryTransferStatus,
  InventoryTransferRequestStatus,
  PaymentMethod,
  PlanStatus,
  PromotionType,
  RoleStatus,
  SaasCapabilityKey,
  SalesChannel,
  UnitCategory,
  UnitStatus,
  UserType,
} from "@/core/enums";
import { heroBannerDefaultsConfig } from "@/config/hero-banner-defaults";
import { permissionsConfig } from "@/config/permissions";
import type {
  Address,
  CustomerPaymentMethod,
  InventoryAdjustment,
  InventoryTransferRequest,
  InventoryTransfer,
  InventoryTransferItem,
  ProductInventorySettings,
  Unit,
  PurchaseOrderItem,
} from "@/core/entities";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { BASE_MONTHLY_QUETZALES } from "@/core/subscription/catalog";
import { createMockDatabase } from "@/infrastructure/mock/database/createMockDatabase";
import { synchronizeSupplierLeadTimeDays } from "@/infrastructure/mock/database/supplierLeadTime";
import type { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { getMockDatabaseStorageKey } from "@/infrastructure/storage/storageKeys";

type PersistedCustomerPaymentMethod = Partial<CustomerPaymentMethod> & {
  expiryMonth?: number;
  expiryYear?: number;
  holderName?: string;
};

type PersistedAddress = Partial<Address>;

type PersistedProductInventorySettings = Partial<ProductInventorySettings>;
type PersistedInventoryAdjustment = Partial<InventoryAdjustment>;
type PersistedInventoryTransferRequest = Partial<InventoryTransferRequest>;
type PersistedInventoryTransfer = Partial<InventoryTransfer>;
type PersistedInventoryTransferItem = Partial<InventoryTransferItem>;
type PersistedUnit = Partial<Unit>;
type PersistedPurchaseOrderItem = Omit<PurchaseOrderItem, "purchaseToBaseFactor"> & {
  purchaseToBaseFactor?: number;
};

const CANONICAL_INCIDENT_TYPES = [
  { code: "DAMAGED", name: "Producto dañado" },
  { code: "MISSING", name: "Producto faltante" },
  { code: "UNSOLICITED", name: "Producto no solicitado" },
  { code: "OTHER", name: "Otros" },
] as const;
const SYSTEM_ADMIN_ROLE_NAME = "Administrador";

type PersistedMockDatabase = Partial<
  Omit<
    MockDatabase,
    | "addresses"
    | "customerPaymentMethods"
    | "inventoryAdjustments"
    | "inventoryTransferItems"
    | "inventoryTransferRequests"
    | "inventoryTransfers"
    | "productInventorySettings"
    | "purchaseOrderItems"
    | "units"
  >
> & {
  addresses?: PersistedAddress[];
  customerPaymentMethods?: PersistedCustomerPaymentMethod[];
  inventoryAdjustments?: PersistedInventoryAdjustment[];
  inventoryTransferItems?: PersistedInventoryTransferItem[];
  inventoryTransferRequests?: PersistedInventoryTransferRequest[];
  inventoryTransfers?: PersistedInventoryTransfer[];
  productInventorySettings?: PersistedProductInventorySettings[];
  purchaseOrderItems?: PersistedPurchaseOrderItem[];
  savedPaymentMethods?: PersistedCustomerPaymentMethod[];
  units?: PersistedUnit[];
};

function normalizeMockDatabase(database: PersistedMockDatabase): MockDatabase {
  const base = createMockDatabase();
  const normalized = { ...base, ...database } as MockDatabase;

  normalized.units = (database.units ?? base.units).map(normalizePersistedUnit);
  normalized.ecommerceConfigs = (database.ecommerceConfigs ?? base.ecommerceConfigs).map(
    (config) => ({
      ...config,
      contactPhone: config.contactPhone?.trim() || undefined,
      contactEmail: config.contactEmail?.trim().toLowerCase() || undefined,
    }),
  );
  normalized.businessCapabilities = (
    database.businessCapabilities ?? base.businessCapabilities
  ).map((config) => ({
    ...config,
    // Contrato: ubicaciones operativas derivan del control de inventario (true/true o false/false).
    supportsMultipleLocations: config.supportsInventory,
    allowedPosPaymentMethods: config.allowedPosPaymentMethods ??
      normalized.ecommerceConfigs
        .find((item) => item.tenantId === config.tenantId)
        ?.allowedPaymentMethods.filter((method) => method !== "mixed") ?? [
        PaymentMethod.cash,
        PaymentMethod.card,
        PaymentMethod.transfer,
      ],
  }));
  // Backfill per-tenant: el onboarding actual siempre crea el HeroBannerConfig del tenant, pero
  // uno persistido antes de esta feature (o con la key ausente/incompleta en localStorage) no lo
  // tiene. Sin este fallback, Diseño E-commerce queda en un error fatal sin salida ("No hay un
  // carrusel configurado" -> Reintentar -> mismo error), igual que fail-closed en ecommerceConfigs.
  // Reusa heroBannerDefaultsConfig (misma fuente que "Usar frases sugeridas" en el admin) como
  // punto de partida acorde al rubro del negocio -- nunca una copia propia hardcodeada acá.
  normalized.heroBanners = [...(database.heroBanners ?? base.heroBanners)];
  normalized.tenants.forEach((tenant) => {
    const hasHeroBanner = normalized.heroBanners.some((heroBanner) => heroBanner.tenantId === tenant.id);
    if (!hasHeroBanner) {
      const preset = normalized.businessCapabilities.find(
        (capabilities) => capabilities.tenantId === tenant.id,
      )?.preset;
      const canonicalSlides =
        preset && preset !== BusinessPreset.custom ? heroBannerDefaultsConfig[preset] : [];
      normalized.heroBanners.push({
        tenantId: tenant.id,
        slides:
          canonicalSlides.length > 0
            ? canonicalSlides.map((slide) => ({ ...slide }))
            : [
                { title: "", description: "" },
                { title: "", description: "" },
                { title: "", description: "" },
              ],
        updatedAt: new Date().toISOString(),
      });
    }
  });
  // Mismo criterio que businessCapabilities/ecommerceConfigs: fallback al seed, NO a []. Un
  // storage persistido antes de esta feature no tiene la key -- sin este fallback, tenant-demo
  // quedaría sin PlanDefinition/TenantSubscription y el resolver fallaría fail-closed para una
  // cuenta que sí las tiene disponibles en el seed. Nunca se borra storage para lograr esto.
  normalized.planDefinitions = database.planDefinitions ?? base.planDefinitions;
  normalized.planDefinitions = normalized.planDefinitions.map((plan) =>
    plan.id === "plan-basic"
      ? {
          ...plan,
          monthlyQuetzales: BASE_MONTHLY_QUETZALES,
          capabilities: [...new Set([
            ...plan.capabilities,
            SaasCapabilityKey.traceabilityLots,
            SaasCapabilityKey.traceabilityExpiration,
            SaasCapabilityKey.traceabilitySerials,
          ])],
          limits: {},
        }
      : plan.id === "plan-enterprise"
        ? { ...plan, status: PlanStatus.archived }
        : plan,
  );
  normalized.tenantSubscriptions = (database.tenantSubscriptions ?? base.tenantSubscriptions).map(
    (subscription) => subscription.planId === "plan-enterprise"
      ? { ...subscription, planId: "plan-basic", addonCodes: ["ecommerce_delivery", "advanced_reports"] }
      : { ...subscription, addonCodes: subscription.addonCodes ?? [] },
  );
  normalized.subscriptionInvoices = database.subscriptionInvoices ?? [];
  normalized.productPriceHistory = database.productPriceHistory ?? [];
  normalized.inventoryReservations = database.inventoryReservations ?? [];
  normalized.inventoryReservationConsumeOperations =
    database.inventoryReservationConsumeOperations ?? [];
  normalized.inventoryLocationRegularizations = database.inventoryLocationRegularizations ?? [];
  normalized.pickingAssignmentReleases = database.pickingAssignmentReleases ?? [];
  normalized.pickingIncidents = database.pickingIncidents ?? [];
  normalized.packings = database.packings ?? [];
  normalized.packingOperations = database.packingOperations ?? [];
  normalized.storePickupDeliveries = database.storePickupDeliveries ?? [];
  normalized.products = (database.products ?? base.products).map((product) => ({
    ...product,
    // Safe legacy backfill only: no stock quantity is reinterpreted or rescaled.
    inventoryUnitId: product.inventoryUnitId ?? product.baseUnitId,
    saleUnitId: product.saleUnitId ?? product.baseUnitId,
    channels: {
      ecommerce: product.channels.ecommerce,
      pos: product.channels.pos,
      mobileApp: product.channels.mobileApp ?? false,
    },
  }));
  normalized.productKitComponents = database.productKitComponents ?? base.productKitComponents;
  normalized.suppliers = (database.suppliers ?? base.suppliers).map((supplier) => ({
    ...supplier,
  }));
  // Backfill para datos persistidos antes de que Role.status existiera -- sin esto, un rol
  // guardado en localStorage antes de este contrato quedaria con status undefined.
  normalized.roles = (database.roles ?? base.roles).map((role) => {
    const isCanonicalSystemAdmin =
      role.isSystem && role.name === SYSTEM_ADMIN_ROLE_NAME && role.branchScope === "all";
    const isDemoBootstrapAdmin = role.id === "role-admin" && role.tenantId === "tenant-demo";
    const canonicalAdminPermissions = permissionsConfig
      .filter(
        (permission) =>
          isDemoBootstrapAdmin ||
          (permission.module !== "customer" && permission.module !== "storefront"),
      )
      .map((permission) => permission.key);
    const packingPermissions =
      role.id === "role-warehouse"
        ? ["logistics.packing.read", "logistics.packing.prepare", "logistics.packing.finalize"]
        : [];
    return {
      ...role,
      permissions: isCanonicalSystemAdmin
        ? canonicalAdminPermissions
        : [...new Set([...role.permissions, ...packingPermissions])],
      status: role.status ?? RoleStatus.active,
    };
  });
  normalized.incidentTypes = [...(database.incidentTypes ?? base.incidentTypes)];
  normalized.tenants.forEach((tenant) => {
    CANONICAL_INCIDENT_TYPES.forEach(({ code, name }) => {
      const exists = normalized.incidentTypes.some(
        (incidentType) => incidentType.tenantId === tenant.id && incidentType.code === code,
      );
      if (!exists) {
        normalized.incidentTypes.push({
          id: `incident-type-${tenant.id}-${code.toLowerCase()}`,
          tenantId: tenant.id,
          code,
          name,
          active: true,
        });
      }
    });
  });
  normalized.productSalesPriceTiers = (
    Object.hasOwn(database, "productSalesPriceTiers")
      ? database.productSalesPriceTiers ?? []
      : base.productSalesPriceTiers
  ).map((tier) => ({ ...tier }));
  normalized.productInventorySettings = normalizeProductInventorySettings(database, normalized);
  normalized.inventoryAdjustments = normalizeInventoryAdjustments(database, normalized);
  normalized.inventoryTransferRequests = normalizeInventoryTransferRequests(database, normalized);
  normalized.inventoryTransfers = normalizeInventoryTransfers(database, normalized);
  normalized.inventoryTransferItems = normalizeInventoryTransferItems(database, normalized);
  normalized.unitConversions = database.unitConversions ?? [];
  normalized.attributeDefinitions = database.attributeDefinitions ?? [];
  normalized.productAttributeValues = database.productAttributeValues ?? [];
  normalized.supplierCostTiers = database.supplierCostTiers ?? [];
  normalized.supplierProducts = (database.supplierProducts ?? base.supplierProducts).map(
    (supplierProduct) => {
      const product = normalized.products.find((item) => item.id === supplierProduct.productId);
      return {
        ...supplierProduct,
        purchaseUnitId: supplierProduct.purchaseUnitId ?? product?.baseUnitId ?? "unit-unit",
        purchaseToBaseFactor: supplierProduct.purchaseToBaseFactor ?? 1,
        lastCost: supplierProduct.lastCost ?? 0,
        leadTimeDays: supplierProduct.leadTimeDays ?? 0,
        minimumOrderQuantity: supplierProduct.minimumOrderQuantity ?? 1,
        preferred: supplierProduct.preferred ?? false,
      };
    },
  );
  normalized.purchaseOrderItems = (database.purchaseOrderItems ?? base.purchaseOrderItems).map(
    (item) => ({
      ...item,
      purchaseToBaseFactor: resolveLegacyPurchaseFactor(item, normalized),
    }),
  );
  synchronizeSupplierLeadTimeDays(
    normalized,
    normalized.suppliers.map((supplier) => supplier.id),
  );
  normalized.customerPaymentMethods = (
    database.customerPaymentMethods ??
    database.savedPaymentMethods ??
    []
  ).map((method) => {
    const customer = normalized.customers.find((item) => item.id === method.customerId);
    const createdAt = method.createdAt ?? new Date().toISOString();
    return {
      id: method.id ?? `customer-payment-method-${crypto.randomUUID()}`,
      tenantId: method.tenantId ?? customer?.tenantId ?? "tenant-demo",
      customerId: method.customerId ?? "",
      type: method.type ?? PaymentMethod.card,
      providerPaymentMethodId:
        method.providerPaymentMethodId ?? `pm_demo_${method.id ?? crypto.randomUUID()}`,
      brand: method.brand ?? "unknown",
      // Backfill para datos persistidos antes de que issuingBank existiera
      // -- nunca debe faltar en un CustomerPaymentMethod ya construido.
      issuingBank: method.issuingBank ?? "Banco Industrial",
      last4: method.last4 ?? "0000",
      expirationMonth: method.expirationMonth ?? method.expiryMonth ?? 1,
      expirationYear: method.expirationYear ?? method.expiryYear ?? 2099,
      cardholderName: method.cardholderName ?? method.holderName,
      isDefault: method.isDefault ?? false,
      status: method.status ?? CustomerPaymentMethodStatus.active,
      createdAt,
      updatedAt: method.updatedAt ?? createdAt,
    };
  });
  normalized.addresses = (database.addresses ?? base.addresses).map((address) => {
    const customer = normalized.customers.find((item) => item.id === address.customerId);
    return {
      id: address.id ?? `address-${crypto.randomUUID()}`,
      tenantId: address.tenantId ?? customer?.tenantId ?? "tenant-demo",
      customerId: address.customerId ?? "",
      label: address.label ?? "",
      recipientName: address.recipientName ?? "",
      line1: address.line1 ?? "",
      line2: address.line2,
      city: address.city ?? "",
      stateOrDepartment: address.stateOrDepartment,
      postalCode: address.postalCode,
      country: address.country ?? "",
      references: address.references,
      isDefault: address.isDefault ?? false,
      createdAt: address.createdAt ?? new Date().toISOString(),
      updatedAt: address.updatedAt ?? address.createdAt ?? new Date().toISOString(),
    };
  });
  normalized.promotions = (database.promotions ?? base.promotions).map((promotion) => ({
    ...promotion,
    type: String(promotion.type) === "fixed_amount" ? PromotionType.fixedDiscount : promotion.type,
    channels: promotion.channels ?? [SalesChannel.pos, SalesChannel.ecommerce],
  }));

  const CUSTOMER_ROLE_NAME = "Cliente";
  const CUSTOMER_ROLE_PERMISSIONS = [
    "customer.account.read",
    "customer.account.update",
    "customer.address.manage",
    "customer.payment_method.manage",
    "storefront.orders.read",
  ];

  normalized.tenants.forEach((tenant) => {
    const hasCustomerRole = normalized.roles.some(
      (role) =>
        role.tenantId === tenant.id &&
        role.isSystem &&
        role.permissions.includes("customer.account.read") &&
        !role.permissions.some(
          (p) => p.startsWith("admin.") || p.startsWith("pos.") || p.startsWith("inventory."),
        ),
    );
    if (!hasCustomerRole) {
      normalized.roles.push({
        id: `role-customer-${tenant.id}`,
        tenantId: tenant.id,
        name: CUSTOMER_ROLE_NAME,
        isSystem: true,
        permissions: [...CUSTOMER_ROLE_PERMISSIONS],
        branchScope: "assigned",
        status: RoleStatus.active,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  });

  normalized.users = (database.users ?? base.users).map((user) => {
    if (user.type === UserType.customer && !user.roleId) {
      const customerRole = normalized.roles.find(
        (role) =>
          role.tenantId === user.tenantId &&
          role.isSystem &&
          role.permissions.includes("customer.account.read") &&
          !role.permissions.some(
            (p) => p.startsWith("admin.") || p.startsWith("pos.") || p.startsWith("inventory."),
          ),
      );
      return {
        ...user,
        roleId: customerRole?.id,
      };
    }
    return user;
  });

  return normalized;
}

function resolveLegacyPurchaseFactor(
  item: PersistedPurchaseOrderItem,
  database: MockDatabase,
): number {
  if (typeof item.purchaseToBaseFactor === "number" && item.purchaseToBaseFactor > 0) {
    return item.purchaseToBaseFactor;
  }
  const order = database.purchaseOrders.find((entry) => entry.id === item.purchaseOrderId);
  const product = database.products.find((entry) => entry.id === item.productId);
  if (!product || product.baseUnitId === item.unitId) return 1;
  const supplierProduct = database.supplierProducts.find(
    (entry) =>
      entry.supplierId === order?.supplierId &&
      entry.productId === item.productId &&
      entry.purchaseUnitId === item.unitId,
  );
  const conversion = database.unitConversions.find(
    (entry) =>
      entry.productId === item.productId &&
      entry.fromUnitId === item.unitId &&
      entry.toUnitId === product.baseUnitId,
  );
  const factor = supplierProduct?.purchaseToBaseFactor ?? conversion?.factor;
  if (!Number.isFinite(factor) || (factor ?? 0) <= 0) {
    throw new Error(
      `Legacy purchase item ${item.id} has no unambiguous conversion to canonical base unit`,
    );
  }
  return factor!;
}

function normalizeInventoryAdjustments(
  database: PersistedMockDatabase,
  normalized: MockDatabase,
): InventoryAdjustment[] {
  const adjustments: InventoryAdjustment[] = [];
  (database.inventoryAdjustments ?? []).forEach((adjustment) => {
    adjustments.push(
      normalizePersistedInventoryAdjustment(adjustment, {
        ...normalized,
        inventoryAdjustments: adjustments,
      }),
    );
  });
  return adjustments;
}

function normalizePersistedInventoryAdjustment(
  adjustment: PersistedInventoryAdjustment,
  normalized: MockDatabase,
): InventoryAdjustment {
  const branch = normalized.branches.find((item) => item.id === adjustment.branchId);
  const product = normalized.products.find((item) => item.id === adjustment.productId);
  const location = adjustment.locationId
    ? normalized.storageLocations.find((item) => item.id === adjustment.locationId)
    : null;
  const createdAt = adjustment.createdAt ?? new Date().toISOString();
  const tenantId =
    adjustment.tenantId ??
    product?.tenantId ??
    branch?.tenantId ??
    location?.tenantId ??
    "tenant-demo";
  const quantityBefore = Math.max(0, adjustment.quantityBefore ?? 0);
  const quantityAfter = Math.max(0, adjustment.quantityAfter ?? quantityBefore);
  const delta = adjustment.delta ?? quantityAfter - quantityBefore;

  return {
    id: adjustment.id ?? `inventory-adjustment-${crypto.randomUUID()}`,
    tenantId,
    number: adjustment.number ?? getInventoryAdjustmentNumber(tenantId, createdAt, normalized),
    branchId: adjustment.branchId ?? "",
    productId: adjustment.productId ?? "",
    locationId: adjustment.locationId,
    type: isInventoryAdjustmentType(adjustment.type)
      ? adjustment.type
      : getInventoryAdjustmentTypeFromDelta(delta),
    reason: adjustment.reason ?? "",
    notes: adjustment.notes,
    quantityBefore,
    quantityAfter,
    delta,
    performedByUserId: adjustment.performedByUserId,
    createdAt,
  };
}

function normalizeInventoryTransfers(
  database: PersistedMockDatabase,
  normalized: MockDatabase,
): InventoryTransfer[] {
  return (database.inventoryTransfers ?? []).map((transfer) =>
    normalizePersistedInventoryTransfer(transfer, normalized),
  );
}

function normalizeInventoryTransferItems(
  database: PersistedMockDatabase,
  normalized: MockDatabase,
): InventoryTransferItem[] {
  return (database.inventoryTransferItems ?? []).flatMap((item) => {
    if (!item.transferId) return [];
    const transfer = normalized.inventoryTransfers.find((entry) => entry.id === item.transferId);
    if (!transfer) return [];
    const product = normalized.products.find((entry) => entry.id === item.productId);
    if (!product || product.tenantId !== transfer.tenantId) return [];
    return [
      {
        id: item.id ?? `inventory-transfer-item-${crypto.randomUUID()}`,
        transferId: item.transferId,
        productId: item.productId ?? "",
        sourceRequestId: item.sourceRequestId,
        requestedQuantity: Math.max(0, item.requestedQuantity ?? 0),
        dispatchedQuantity: Math.max(0, item.dispatchedQuantity ?? 0),
        receivedQuantity: Math.max(0, item.receivedQuantity ?? 0),
      },
    ];
  });
}

function normalizePersistedInventoryTransfer(
  transfer: PersistedInventoryTransfer,
  normalized: MockDatabase,
): InventoryTransfer {
  const sourceBranch = normalized.branches.find((item) => item.id === transfer.sourceBranchId);
  const destinationBranch = normalized.branches.find(
    (item) => item.id === transfer.destinationBranchId,
  );
  const createdAt = transfer.createdAt ?? new Date().toISOString();
  const tenantId =
    transfer.tenantId ?? sourceBranch?.tenantId ?? destinationBranch?.tenantId ?? "tenant-demo";

  return {
    id: transfer.id ?? `inventory-transfer-${crypto.randomUUID()}`,
    tenantId,
    number: transfer.number ?? getInventoryTransferNumber(tenantId, createdAt, normalized),
    sourceBranchId: transfer.sourceBranchId ?? "",
    destinationBranchId: transfer.destinationBranchId ?? "",
    status: isInventoryTransferStatus(transfer.status)
      ? transfer.status
      : InventoryTransferStatus.preparing,
    operationId: transfer.operationId,
    operationFingerprint: transfer.operationFingerprint,
    sourceRequestIds: transfer.sourceRequestIds,
    reason: transfer.reason,
    notes: transfer.notes,
    preparedByUserId: transfer.preparedByUserId,
    dispatchedByUserId: transfer.dispatchedByUserId,
    receivedByUserId: transfer.receivedByUserId,
    createdAt,
    updatedAt: transfer.updatedAt ?? createdAt,
    dispatchedAt: transfer.dispatchedAt,
    receivedAt: transfer.receivedAt,
    cancelledAt: transfer.cancelledAt,
    cancelledByUserId: transfer.cancelledByUserId,
    cancelOperationId: transfer.cancelOperationId,
    cancelFingerprint: transfer.cancelFingerprint,
  };
}

function normalizeProductInventorySettings(
  database: PersistedMockDatabase,
  normalized: MockDatabase,
): ProductInventorySettings[] {
  if (database.productInventorySettings) {
    return database.productInventorySettings.map((settings) =>
      normalizePersistedProductInventorySettings(settings, normalized),
    );
  }

  return deriveProductInventorySettingsFromLegacyBalances(normalized);
}

function normalizeInventoryTransferRequests(
  database: PersistedMockDatabase,
  normalized: MockDatabase,
): InventoryTransferRequest[] {
  return (database.inventoryTransferRequests ?? []).map((request) =>
    normalizePersistedInventoryTransferRequest(request, normalized),
  );
}

function normalizePersistedInventoryTransferRequest(
  request: PersistedInventoryTransferRequest,
  normalized: MockDatabase,
): InventoryTransferRequest {
  const product = normalized.products.find((item) => item.id === request.productId);
  const requestingBranch = normalized.branches.find(
    (item) => item.id === request.requestingBranchId,
  );
  const sourceBranch = normalized.branches.find((item) => item.id === request.sourceBranchId);
  const createdAt = request.createdAt ?? request.requestedAt ?? new Date().toISOString();
  const status = isInventoryTransferRequestStatus(request.status)
    ? request.status
    : InventoryTransferRequestStatus.requested;

  return {
    id: request.id ?? `inventory-transfer-request-${crypto.randomUUID()}`,
    tenantId:
      request.tenantId ??
      product?.tenantId ??
      requestingBranch?.tenantId ??
      sourceBranch?.tenantId ??
      "tenant-demo",
    requestingBranchId: request.requestingBranchId ?? "",
    sourceBranchId: request.sourceBranchId ?? "",
    productId: request.productId ?? "",
    requestedQuantity: Math.max(0, request.requestedQuantity ?? 0),
    receivedQuantity:
      typeof request.receivedQuantity === "number"
        ? Math.max(0, request.receivedQuantity)
        : undefined,
    reason: isInventoryTransferReason(request.reason)
      ? request.reason
      : InventoryTransferReason.other,
    notes: request.notes,
    status,
    rejectionReason: request.rejectionReason,
    cancellationReason: request.cancellationReason,
    requestedAt: request.requestedAt ?? createdAt,
    reviewedAt: request.reviewedAt,
    approvedAt: request.approvedAt,
    rejectedAt: request.rejectedAt,
    dispatchedAt: request.dispatchedAt,
    receivedAt: request.receivedAt,
    cancelledAt: request.cancelledAt,
    requestedByUserId: request.requestedByUserId,
    reviewedByUserId: request.reviewedByUserId,
    createdAt,
    updatedAt: request.updatedAt ?? createdAt,
  };
}

function normalizePersistedProductInventorySettings(
  settings: PersistedProductInventorySettings,
  normalized: MockDatabase,
): ProductInventorySettings {
  const product = normalized.products.find((item) => item.id === settings.productId);
  const branch = normalized.branches.find((item) => item.id === settings.branchId);
  const createdAt = settings.createdAt ?? new Date().toISOString();

  return {
    id:
      settings.id ??
      getProductInventorySettingsId(
        settings.tenantId ?? product?.tenantId ?? branch?.tenantId ?? "tenant-demo",
        settings.productId ?? "",
        settings.branchId ?? "",
      ),
    tenantId: settings.tenantId ?? product?.tenantId ?? branch?.tenantId ?? "tenant-demo",
    productId: settings.productId ?? "",
    branchId: settings.branchId ?? "",
    minStock: Math.max(0, settings.minStock ?? 0),
    reorderPoint:
      typeof settings.reorderPoint === "number" ? Math.max(0, settings.reorderPoint) : undefined,
    // La asignacion persistida se conserva aunque hoy sea invalida (ubicacion inactiva, archivada
    // o de otra sucursal): es evidencia que se debe corregir explicitamente, nunca se borra aqui.
    // Las operaciones de stock la rechazan mediante la politica de ubicacion operativa.
    defaultLocationId: settings.defaultLocationId ?? undefined,
    createdAt,
    updatedAt: settings.updatedAt ?? createdAt,
  };
}

function deriveProductInventorySettingsFromLegacyBalances(
  normalized: MockDatabase,
): ProductInventorySettings[] {
  const balancesByKey = new Map<string, typeof normalized.inventoryBalances>();

  normalized.inventoryBalances.forEach((balance) => {
    const key = getProductInventorySettingsId(
      balance.tenantId,
      balance.productId,
      balance.branchId,
    );
    const group = balancesByKey.get(key) ?? [];
    group.push(balance);
    balancesByKey.set(key, group);
  });

  return [...balancesByKey.entries()].flatMap<ProductInventorySettings>(([id, balances]) => {
    const minStockValues = uniqueDefinedNumbers(balances.map((balance) => balance.minStock));
    const reorderPointValues = uniqueDefinedNumbers(
      balances.map((balance) => balance.reorderPoint),
    );

    if (minStockValues.length > 1 || reorderPointValues.length > 1) {
      return [];
    }

    const [firstBalance] = balances;
    if (!firstBalance || (minStockValues.length === 0 && reorderPointValues.length === 0)) {
      return [];
    }

    return [
      {
        id,
        tenantId: firstBalance.tenantId,
        productId: firstBalance.productId,
        branchId: firstBalance.branchId,
        minStock: minStockValues[0] ?? 0,
        reorderPoint: reorderPointValues[0],
        createdAt: firstBalance.updatedAt,
        updatedAt: firstBalance.updatedAt,
      },
    ];
  });
}

function uniqueDefinedNumbers(values: Array<number | undefined>): number[] {
  return [...new Set(values.filter((value): value is number => typeof value === "number"))];
}

function getProductInventorySettingsId(
  tenantId: string,
  productId: string,
  branchId: string,
): string {
  return `product-inventory-settings-${tenantId}-${productId}-${branchId}`;
}

export class MockDatabaseStore {
  private database: MockDatabase;

  constructor(private readonly storage: LocalStorageAdapter) {
    const persisted = this.storage.get<PersistedMockDatabase>(getMockDatabaseStorageKey());
    this.database = normalizeMockDatabase(persisted ?? createMockDatabase());
    this.persist();
  }

  getSnapshot(): MockDatabase {
    return structuredClone(this.database);
  }

  read<T>(selector: (database: MockDatabase) => T): T {
    return structuredClone(selector(this.database));
  }

  mutate<T>(mutation: (database: MockDatabase) => T): T {
    const result = mutation(this.database);
    this.persist();
    return structuredClone(result);
  }

  transact<T>(mutation: (database: MockDatabase) => T): T {
    const draft = structuredClone(this.database);
    const result = mutation(draft);
    this.database = draft;
    this.persist();
    return structuredClone(result);
  }

  resetToSeeds(): MockDatabase {
    this.database = normalizeMockDatabase(createMockDatabase());
    this.persist();
    return this.getSnapshot();
  }

  private persist(): void {
    this.storage.set(getMockDatabaseStorageKey(), this.database);
  }
}

function normalizePersistedUnit(unit: PersistedUnit): Unit {
  const now = new Date().toISOString();

  return {
    id: unit.id ?? `unit-${crypto.randomUUID()}`,
    tenantId: unit.tenantId ?? "tenant-demo",
    code: unit.code ?? "",
    name: unit.name ?? "Unidad",
    symbol: unit.symbol ?? "",
    category: normalizeUnitCategory(unit),
    allowsDecimals: unit.allowsDecimals ?? false,
    status: unit.status ?? UnitStatus.active,
    createdAt: unit.createdAt ?? now,
    updatedAt: unit.updatedAt ?? unit.createdAt ?? now,
  };
}

function normalizeUnitCategory(unit: PersistedUnit): UnitCategory {
  if (isUnitCategory(unit.category)) return unit.category;

  const code = unit.code?.trim().toUpperCase();
  const symbol = unit.symbol?.trim().toUpperCase();
  const name = stripAccents(unit.name ?? "")
    .trim()
    .toUpperCase();

  if (code === "UND" || code === "CAJA" || code === "PAQ") return UnitCategory.unit;
  if (code === "PAR" || code === "DOC" || code === "DOCENA" || code === "DZ") {
    return UnitCategory.unit;
  }
  if (symbol === "U" || symbol === "CJ" || symbol === "PAQ") return UnitCategory.unit;
  if (symbol === "PAR" || symbol === "DOC" || symbol === "DZ") return UnitCategory.unit;
  if (
    name === "UNIDAD" ||
    name === "CAJA" ||
    name === "PAQUETE" ||
    name === "PAR" ||
    name === "DOCENA"
  ) {
    return UnitCategory.unit;
  }

  if (code === "KG" || symbol === "KG" || name === "KILOGRAMO") return UnitCategory.weight;
  if (code === "G" || symbol === "G" || name === "GRAMO") return UnitCategory.weight;
  if (code === "LB" || symbol === "LB" || name === "LIBRA") return UnitCategory.weight;
  if (code === "OZ" || symbol === "OZ" || name === "ONZA") return UnitCategory.weight;

  if (code === "M" || symbol === "M" || name === "METRO") return UnitCategory.length;

  return UnitCategory.other;
}

function isUnitCategory(value: unknown): value is UnitCategory {
  return (
    value === UnitCategory.unit ||
    value === UnitCategory.weight ||
    value === UnitCategory.length ||
    value === UnitCategory.volume ||
    value === UnitCategory.other
  );
}

function isInventoryAdjustmentType(value: unknown): value is InventoryAdjustmentType {
  return (
    value === InventoryAdjustmentType.manualIncrease ||
    value === InventoryAdjustmentType.manualDecrease ||
    value === InventoryAdjustmentType.waste ||
    value === InventoryAdjustmentType.countCorrection
  );
}

function getInventoryAdjustmentTypeFromDelta(delta: number): InventoryAdjustmentType {
  if (delta > 0) return InventoryAdjustmentType.manualIncrease;
  if (delta < 0) return InventoryAdjustmentType.manualDecrease;
  return InventoryAdjustmentType.countCorrection;
}

function isInventoryTransferRequestStatus(value: unknown): value is InventoryTransferRequestStatus {
  return (
    value === InventoryTransferRequestStatus.requested ||
    value === InventoryTransferRequestStatus.approved ||
    value === InventoryTransferRequestStatus.rejected ||
    value === InventoryTransferRequestStatus.inTransit ||
    value === InventoryTransferRequestStatus.received ||
    value === InventoryTransferRequestStatus.cancelled
  );
}

function isInventoryTransferStatus(value: unknown): value is InventoryTransferStatus {
  return (
    value === InventoryTransferStatus.preparing ||
    value === InventoryTransferStatus.inTransit ||
    value === InventoryTransferStatus.received ||
    value === InventoryTransferStatus.cancelled
  );
}

function isInventoryTransferReason(value: unknown): value is InventoryTransferReason {
  return (
    value === InventoryTransferReason.replenishment ||
    value === InventoryTransferReason.demandCoverage ||
    value === InventoryTransferReason.urgentRequest ||
    value === InventoryTransferReason.inventoryBalancing ||
    value === InventoryTransferReason.other
  );
}

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function getInventoryTransferNumber(
  tenantId: string,
  createdAt: string,
  normalized: MockDatabase,
): string {
  const year = new Date(createdAt).getFullYear();
  const prefix = `TR-${year}-`;
  const next =
    normalized.inventoryTransfers
      .filter((transfer) => transfer.tenantId === tenantId && transfer.number.startsWith(prefix))
      .map((transfer) => Number(transfer.number.slice(prefix.length)))
      .filter((value) => Number.isInteger(value))
      .reduce((max, value) => Math.max(max, value), 0) + 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
}

function getInventoryAdjustmentNumber(
  tenantId: string,
  createdAt: string,
  normalized: MockDatabase,
): string {
  const year = new Date(createdAt).getFullYear();
  const prefix = `AJ-${year}-`;
  const next =
    normalized.inventoryAdjustments
      .filter(
        (adjustment) => adjustment.tenantId === tenantId && adjustment.number.startsWith(prefix),
      )
      .map((adjustment) => Number(adjustment.number.slice(prefix.length)))
      .filter((value) => Number.isInteger(value))
      .reduce((max, value) => Math.max(max, value), 0) + 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
}
