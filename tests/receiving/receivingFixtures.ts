import { vi } from "vitest";
import type { PurchaseOrder, Receipt, ReceiptLine, User } from "@/core/entities";
import {
  PlanStatus,
  ReceiptLineStatus,
  ReceiptStatus,
  PurchaseOrderStatus,
  RoleStatus,
  SaasCapabilityKey,
  TenantStatus,
  TenantSubscriptionStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import type {
  ReceiptIncidentRecord,
  ReceiptRecord,
  ReceiptRepository,
} from "@/core/repositories";
import type { PaginatedResult } from "@/core/types/pagination.types";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  ReceivingCapabilityFlags,
  ReceivingDocumentIncident,
  ReceivingDocumentLine,
  ReceivingTrackingDetail,
} from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import { ReceivingDocumentDetailService } from "@/modules/receiving/application/services/ReceivingDocumentDetailService";

export const TENANT_ID = "tenant-1";
export const BRANCH_ID = "branch-1";
export const ORDER_ID = "order-1";
export const RECEIPT_ID = "receipt-1";
export const USER_ID = "user-1";
export const OPERATIONAL_LOCATION_ID = "location-current";
const ISO = "2026-01-01T00:00:00.000Z";

export const ALL_RECEIVING_PERMISSIONS = [
  "receiving.receipts.read",
  "receiving.receipts.create",
  "receiving.receipts.confirm",
  "receiving.incidents.manage",
] as const;

/** Linea de documento con un producto de stock simple, unidad entera y ubicacion operativa. */
export function receivingLine(
  overrides: Partial<ReceivingDocumentLine> = {},
): ReceivingDocumentLine {
  return {
    id: "line-1",
    sourceLineId: "line-1",
    productId: "product-1",
    productName: "Producto 1",
    sku: "SKU-1",
    unitId: "unit-1",
    unitName: "Caja",
    unitAllowsDecimals: false,
    baseUnitId: "unit-1",
    baseUnitName: "Caja",
    baseUnitAllowsDecimals: false,
    orderedQuantity: 10,
    acceptedPreviously: 0,
    receivedNow: 2,
    pendingQuantity: 8,
    locationId: OPERATIONAL_LOCATION_ID,
    tracking: { stock: true, lot: false, expiration: false, serial: false },
    lotNumber: "",
    expirationDate: "",
    serialNumbersText: "",
    trackingDetails: [],
    notes: "",
    purchaseToBaseFactor: 1,
    ...overrides,
  };
}

export function trackingDetail(
  overrides: Partial<ReceivingTrackingDetail> = {},
): ReceivingTrackingDetail {
  return {
    id: "tracking-1",
    baseQuantity: 2,
    lotNumber: "",
    expirationDate: "",
    serialNumbersText: "",
    ...overrides,
  };
}

export function capabilityFlags(
  supportsMultipleLocations = true,
): ReceivingCapabilityFlags {
  return {
    supportsInventory: true,
    supportsLots: true,
    supportsExpiration: true,
    supportsSerials: true,
    supportsMultipleLocations,
    supportsUnitsAndPackaging: true,
  };
}

/** Incidencia editable del documento (borrador de la pantalla). */
export function documentIncident(
  overrides: Partial<ReceivingDocumentIncident> = {},
): ReceivingDocumentIncident {
  return {
    id: "draft-incident-1",
    receiptId: RECEIPT_ID,
    productId: "product-1",
    productName: "Producto 1",
    sku: "SKU-1",
    incidentTypeId: "damaged",
    incidentTypeName: "Dañado",
    quantityAffected: 1,
    description: "Caja golpeada",
    evidence: [],
    createdAt: ISO,
    createdByUserId: USER_ID,
    createdByName: "Ana",
    receiptNumber: "REC-001",
    editable: true,
    ...overrides,
  };
}

export function draftReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: RECEIPT_ID,
    tenantId: TENANT_ID,
    branchId: BRANCH_ID,
    number: "REC-001",
    purchaseOrderId: ORDER_ID,
    status: ReceiptStatus.in_progress,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function receiptLineRecord(overrides: Partial<ReceiptLine> = {}): ReceiptLine {
  return {
    id: "goods-receipt-item-1",
    receiptId: RECEIPT_ID,
    productId: "product-1",
    receivedQuantity: 2,
    status: ReceiptLineStatus.partial,
    ...overrides,
  };
}

export function receiptRecord(
  receipt: Partial<Receipt> = {},
  items: ReceiptRecord["items"] = [],
): ReceiptRecord {
  return { receipt: draftReceipt(receipt), items };
}

export function apiIncident(
  overrides: Partial<ReceiptIncidentRecord> = {},
): ReceiptIncidentRecord {
  return {
    id: "incident-1",
    branchId: BRANCH_ID,
    goodsReceiptId: RECEIPT_ID,
    incidentType: "damaged",
    status: "open",
    notes: "Caja golpeada",
    createdByUserId: USER_ID,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function paginated<T>(
  items: T[],
  overrides: Partial<PaginatedResult<T>> = {},
): PaginatedResult<T> {
  return {
    items,
    page: 1,
    pageSize: 100,
    totalItems: items.length,
    totalPages: 1,
    ...overrides,
  };
}

export function purchaseOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: ORDER_ID,
    tenantId: TENANT_ID,
    branchId: BRANCH_ID,
    number: "OC-001",
    supplierId: "supplier-1",
    status: PurchaseOrderStatus.approved,
    subtotal: 0,
    total: 0,
    createdByUserId: USER_ID,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

/** Subconjunto privado del servicio que las pruebas sustituyen para aislar lecturas pesadas. */
export interface ReceivingServiceInternals {
  getPurchaseOrderDocument: (
    tenantId: string,
    user: User,
    documentId: string,
    activeBranchId?: string,
  ) => Promise<unknown>;
  getApiPurchaseOrderDocument: (order: PurchaseOrder) => Promise<unknown>;
}

export interface ReceivingHarnessOptions {
  dataSource?: "api" | "mock";
  permissions?: readonly string[];
  order?: Partial<PurchaseOrder>;
  allowedBranchIds?: string[];
  units?: Array<{ id: string; allowsDecimals: boolean }>;
}

/**
 * Registro en memoria con la sesion, el rol, el plan y la orden reales del flujo; los repositorios
 * de recibos son `vi.fn` tipados contra `ReceiptRepository` para que cada prueba programe solo lo
 * que necesita. El unico cast del registro vive aqui.
 */
export function createReceivingHarness(options: ReceivingHarnessOptions = {}) {
  const user: User = {
    id: USER_ID,
    tenantId: TENANT_ID,
    name: "Ana",
    email: "ana@example.test",
    type: UserType.employee,
    status: UserStatus.active,
    roleId: "role-1",
    allowedBranchIds: options.allowedBranchIds ?? [BRANCH_ID],
    createdAt: ISO,
    updatedAt: ISO,
  };
  const role = {
    id: "role-1",
    tenantId: TENANT_ID,
    status: RoleStatus.active,
    permissions: [...(options.permissions ?? ALL_RECEIVING_PERMISSIONS)],
    branchScope: "selected",
  };
  const order = purchaseOrder(options.order);

  const receipts = {
    listByTenant: vi.fn<ReceiptRepository["listByTenant"]>(async () => []),
    create: vi.fn<ReceiptRepository["create"]>(async (input) => ({
      ...input,
      id: "receipt-created",
      createdAt: ISO,
      updatedAt: ISO,
    })),
    update: vi.fn<ReceiptRepository["update"]>(async (id, input) => ({
      ...draftReceipt({ id }),
      ...input,
    })),
    replaceLines: vi.fn<ReceiptRepository["replaceLines"]>(async () => []),
    replaceIncidents: vi.fn<ReceiptRepository["replaceIncidents"]>(async () => []),
    getByConfirmationId: vi.fn<ReceiptRepository["getByConfirmationId"]>(async () => null),
    confirmReceiptInventory: vi.fn<ReceiptRepository["confirmReceiptInventory"]>(async () =>
      draftReceipt({ status: ReceiptStatus.received }),
    ),
    getPageScoped: vi.fn<ReceiptRepository["getPageScoped"]>(async () => paginated([])),
    getRecordByIdScoped: vi.fn<ReceiptRepository["getRecordByIdScoped"]>(async () => null),
    createDraftScoped: vi.fn<ReceiptRepository["createDraftScoped"]>(async () => receiptRecord()),
    updateDraftScoped: vi.fn<ReceiptRepository["updateDraftScoped"]>(async () => receiptRecord()),
    deleteDraftScoped: vi.fn<ReceiptRepository["deleteDraftScoped"]>(async () => undefined),
    confirmDraftScoped: vi.fn<ReceiptRepository["confirmDraftScoped"]>(async () =>
      receiptRecord({ status: ReceiptStatus.received }),
    ),
    listIncidentsScoped: vi.fn<ReceiptRepository["listIncidentsScoped"]>(async () =>
      paginated<ReceiptIncidentRecord>([]),
    ),
    createIncidentScoped: vi.fn<ReceiptRepository["createIncidentScoped"]>(async () =>
      apiIncident(),
    ),
    resolveIncidentScoped: vi.fn<ReceiptRepository["resolveIncidentScoped"]>(async () =>
      apiIncident({ status: "resolved" }),
    ),
    resolveIncidentWithReplacementScoped: vi.fn<
      ReceiptRepository["resolveIncidentWithReplacementScoped"]
    >(async () => undefined),
  };

  const repositories = {
    receivingDataSource: options.dataSource ?? "api",
    auth: {
      getCurrentSessionId: vi.fn(async () => "session-1"),
      getSession: vi.fn(async () => ({ id: "session-1", userId: USER_ID })),
    },
    users: { getById: vi.fn(async () => user) },
    roles: { getByIdScoped: vi.fn(async () => role) },
    tenants: { getById: vi.fn(async () => ({ id: TENANT_ID, status: TenantStatus.active })) },
    tenantSubscriptions: {
      getByTenantId: vi.fn(async () => ({
        tenantId: TENANT_ID,
        planId: "plan-1",
        status: TenantSubscriptionStatus.active,
      })),
    },
    plans: {
      getById: vi.fn(async () => ({
        id: "plan-1",
        code: "plan-test",
        status: PlanStatus.active,
        capabilities: [SaasCapabilityKey.receiving],
        limits: {},
      })),
    },
    branches: {
      getById: vi.fn(async () => ({ id: BRANCH_ID, tenantId: TENANT_ID })),
    },
    purchaseOrders: { getByIdScoped: vi.fn(async () => order) },
    units: {
      getAll: vi.fn(async () =>
        (options.units ?? [{ id: "unit-1", allowsDecimals: false }]).map((unit) => ({
          ...unit,
          tenantId: TENANT_ID,
        })),
      ),
    },
    receipts,
  };

  const service = new ReceivingDocumentDetailService(
    repositories as unknown as RepositoryRegistry,
  );
  return {
    service,
    internals: service as unknown as ReceivingServiceInternals,
    receipts,
    repositories,
    order,
    user,
  };
}
