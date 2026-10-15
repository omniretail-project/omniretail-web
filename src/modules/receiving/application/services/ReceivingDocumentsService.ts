import type {
  IncidentType,
  InventoryTransferItem,
  PurchaseOrder,
  Receipt,
  ReceiptIncident,
  ReceiptLine,
} from "@/core/entities";
import { InventoryTransferStatus, PurchaseOrderStatus, ReceiptStatus } from "@/core/enums";
import type {
  InventoryTransferWithItems,
  ReceiptIncidentRecord,
  ReceiptRecord,
} from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  IncidentTypeReadModel,
  ReceivingPaginationState,
  ReceivingPurchaseOrderStream,
  ReceivingDocumentRow,
  ReceivingReadModel,
  ReceivingStatus,
} from "@/modules/receiving/application/dto/ReceivingDocumentsDto";
import { RECEIPT_INCIDENT_TYPE_LABELS } from "@/modules/receiving/application/dto/ReceivingDocumentDetailDto";
import type { IncidentListItemViewModel } from "@/modules/receiving/application/dto/IncidentListItemViewModel";
import { buildIncidentListItems } from "@/modules/receiving/application/services/buildIncidentListItems";
import {
  ensureCanManageIncidentTypes,
  ensureCanReadReceiving,
  ensureTenantCanUseReceiving,
  ensureUserCanOperateBranch,
  ReceivingServiceError,
  resolveReceivingContext,
} from "@/modules/receiving/application/services/serviceHelpers";
import { TEXT_LIMITS } from "@/shared/utils/inputLimits";

export class ReceivingDocumentsService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(activeBranchId?: string): Promise<ReceivingReadModel> {
    const { tenantId, user, permissions } = await resolveReceivingContext(this.repositories);
    ensureCanReadReceiving(permissions);
    if (!activeBranchId) return { documents: [], incidents: [], incidentTypes: [] };
    // La sucursal activa llega del cliente (selector de header): validada contra
    // User.allowedBranchIds antes de usarse para filtrar cualquier dato, no solo contra el
    // tenant -- permission-hardening.
    await ensureUserCanOperateBranch(this.repositories, user, activeBranchId);

    if (this.repositories.receivingDataSource === "api") {
      return this.getApiDocuments(tenantId, activeBranchId);
    }

    const [purchaseOrders, suppliers, branches, transfers, receipts, incidentTypes, users] =
      await Promise.all([
        this.repositories.purchaseOrders.listByTenant(tenantId),
        this.repositories.suppliers.getAll(),
        this.repositories.branches.getAll(),
        this.repositories.inventoryTransfers.query({
          tenantId,
          destinationBranchId: activeBranchId,
        }),
        this.repositories.receipts.listByTenant(tenantId),
        this.repositories.incidentTypes.getAll(),
        this.repositories.users.getAll(),
      ]);
    const activeReceipts = receipts.filter((receipt) => receipt.branchId === activeBranchId);
    const [products, receiptLines, allReceiptIncidents] = await Promise.all([
      this.repositories.products.getAll(),
      this.getReceiptLines(activeReceipts),
      this.getReceiptIncidents(),
    ]);
    const activeReceiptIds = new Set(activeReceipts.map((receipt) => receipt.id));
    const receiptIncidents = allReceiptIncidents.filter((incident) =>
      activeReceiptIds.has(incident.receiptId),
    );

    const productById = new Map(products.map((product) => [product.id, product]));
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));
    const receiptsByOrderId = groupReceiptsByOrderId(activeReceipts);
    const receiptLinesByReceiptId = groupReceiptLinesByReceiptId(receiptLines);
    const purchaseOrderRows = purchaseOrders
      .filter((order) => order.branchId === activeBranchId)
      .filter((order) => isPurchaseOrderRelevantForReceiving(order.status))
      .map((order) => {
        const orderReceipts = receiptsByOrderId.get(order.id) ?? [];
        const confirmedReceiptIds = new Set(
          orderReceipts
            .filter(
              (receipt) =>
                receipt.status === ReceiptStatus.partial ||
                receipt.status === ReceiptStatus.received,
            )
            .map((receipt) => receipt.id),
        );
        const orderReceiptLines = orderReceipts
          .flatMap((receipt) => receiptLinesByReceiptId.get(receipt.id) ?? [])
          .filter((line) => confirmedReceiptIds.has(line.receiptId));
        const supplier = supplierById.get(order.supplierId);
        return toPurchaseOrderRow(
          order,
          supplier?.name ?? "Proveedor no disponible",
          orderReceipts,
          orderReceiptLines,
          productById,
        );
      });
    const transferRows = transfers
      .filter((transfer) => transfer.transfer.destinationBranchId === activeBranchId)
      .filter((transfer) => isTransferRelevantForReceiving(transfer.transfer.status))
      .map((transfer) =>
        toTransferRow(
          transfer,
          branchById.get(transfer.transfer.sourceBranchId)?.name ?? "Sucursal origen",
          productById,
        ),
      );

    return {
      documents: [...purchaseOrderRows, ...transferRows].sort(
        (left, right) =>
          new Date(right.lastUpdatedAt).getTime() - new Date(left.lastUpdatedAt).getTime(),
      ),
      incidents: buildIncidentListItems({
        incidents: receiptIncidents,
        receipts: activeReceipts,
        receiptLines,
        incidentTypes,
        products,
        purchaseOrders,
        suppliers,
        branches,
        users,
      }),
      incidentTypes: buildIncidentTypeRows(
        incidentTypes.filter((incidentType) => incidentType.tenantId === tenantId),
        receiptIncidents,
      ),
    };
  }

  async createIncidentType(name: string) {
    const { tenantId, permissions } = await resolveReceivingContext(this.repositories);
    ensureCanManageIncidentTypes(permissions);
    await ensureTenantCanUseReceiving(this.repositories, tenantId);
    this.ensureApiIncidentOperationsAreUnavailable();
    const trimmedName = name.trim();
    if (!trimmedName) throw new ReceivingServiceError("Ingresa el nombre del tipo de incidencia.");
    if (trimmedName.length > TEXT_LIMITS.incidentName) {
      throw new ReceivingServiceError("El nombre admite hasta 80 caracteres.");
    }
    return this.repositories.incidentTypes.create({
      tenantId,
      name: trimmedName,
      code: toCode(trimmedName),
      active: true,
    });
  }

  async archiveIncidentType(id: string) {
    const { tenantId, permissions } = await resolveReceivingContext(this.repositories);
    ensureCanManageIncidentTypes(permissions);
    await ensureTenantCanUseReceiving(this.repositories, tenantId);
    this.ensureApiIncidentOperationsAreUnavailable();
    await this.ensureIncidentTypeBelongsToTenant(tenantId, id);
    return this.repositories.incidentTypes.update(id, { active: false });
  }

  async deleteIncidentType(id: string) {
    const { tenantId, permissions } = await resolveReceivingContext(this.repositories);
    ensureCanManageIncidentTypes(permissions);
    await ensureTenantCanUseReceiving(this.repositories, tenantId);
    this.ensureApiIncidentOperationsAreUnavailable();
    await this.ensureIncidentTypeBelongsToTenant(tenantId, id);
    const incidents = await this.getReceiptIncidents();
    if (incidents.some((incident) => incident.incidentTypeId === id)) {
      throw new ReceivingServiceError("Este tipo tiene historial y debe archivarse.");
    }
    await this.repositories.incidentTypes.delete(id);
  }

  // El id de tipo de incidencia llega del cliente: uno de otro tenant se trata igual que uno
  // inexistente, mismo criterio que ensurePurchaseOrderBelongsToTenant en Purchasing.
  private async ensureIncidentTypeBelongsToTenant(tenantId: string, id: string) {
    const incidentType = await this.repositories.incidentTypes.getById(id);
    if (!incidentType || incidentType.tenantId !== tenantId) {
      throw new ReceivingServiceError("Tipo de incidencia no encontrado.");
    }
  }

  private async getReceiptLines(receipts: Receipt[]) {
    const lines = await Promise.all(
      receipts.map((receipt) => this.repositories.receipts.getLinesByReceipt(receipt.id)),
    );
    return lines.flat();
  }

  private async getReceiptIncidents() {
    return this.repositories.receipts.getIncidents();
  }

  async loadMore(
    activeBranchId: string,
    pagination: ReceivingPaginationState,
  ): Promise<ReceivingReadModel> {
    const { tenantId, user, permissions } = await resolveReceivingContext(this.repositories);
    ensureCanReadReceiving(permissions);
    await ensureUserCanOperateBranch(this.repositories, user, activeBranchId);
    if (this.repositories.receivingDataSource !== "api") {
      throw new ReceivingServiceError("La paginacion incremental solo aplica al modo API.");
    }
    if (pagination.branchId !== activeBranchId) {
      throw new ReceivingServiceError("La sucursal activa cambio; vuelve a cargar recepciones.");
    }
    const stream = nextReceivingStream(pagination);
    if (!stream) return { documents: [], incidents: [], incidentTypes: [], pagination };
    const nextPage = pagination.streams[stream].currentPage + 1;
    const page = await this.repositories.purchaseOrders.getPageScoped(tenantId, {
      branchId: activeBranchId,
      status: PURCHASE_ORDER_STREAMS[stream],
      page: nextPage,
      pageSize: RECEIVING_PAGE_SIZE,
    });
    const batch = await this.toApiPurchaseOrderRows(tenantId, activeBranchId, page.items);
    const streams = {
      ...pagination.streams,
      [stream]: { currentPage: page.page, totalPages: page.totalPages },
    };
    return {
      documents: batch.documents,
      incidents: batch.incidents,
      incidentTypes: [],
      incidentListIncomplete: batch.incidentListIncomplete,
      pagination: {
        branchId: activeBranchId,
        streams,
        hasMore: hasMoreReceivingPages(streams),
        receiptHistoryIncomplete:
          pagination.receiptHistoryIncomplete || batch.receiptHistoryIncomplete,
      },
    };
  }

  private ensureApiIncidentOperationsAreUnavailable() {
    if (this.repositories.receivingDataSource !== "api") return;
    throw new ReceivingServiceError(
      "Los tipos dinámicos de incidencia no están disponibles en modo API.",
    );
  }

  private async getApiDocuments(
    tenantId: string,
    activeBranchId: string,
  ): Promise<ReceivingReadModel> {
    const entries = Object.entries(PURCHASE_ORDER_STREAMS) as Array<
      [ReceivingPurchaseOrderStream, PurchaseOrderStatus]
    >;
    const [pages, transferGroups] = await Promise.all([
      Promise.all(
        entries.map(
          async ([stream, status]) =>
            [
              stream,
              await this.repositories.purchaseOrders.getPageScoped(tenantId, {
                branchId: activeBranchId,
                status,
                page: 1,
                pageSize: RECEIVING_PAGE_SIZE,
              }),
            ] as const,
        ),
      ),
      this.repositories.inventoryTransfersDataSource === "api"
        ? Promise.all(
            [InventoryTransferStatus.inTransit, InventoryTransferStatus.received].map((status) =>
              this.repositories.inventoryTransfers.query({
                tenantId,
                destinationBranchId: activeBranchId,
                status,
              }),
            ),
          )
        : Promise.resolve([]),
    ]);
    const batch = await this.toApiPurchaseOrderRows(
      tenantId,
      activeBranchId,
      pages.flatMap(([, page]) => page.items),
    );
    const streams = Object.fromEntries(
      pages.map(([stream, page]) => [
        stream,
        { currentPage: page.page, totalPages: page.totalPages },
      ]),
    ) as ReceivingPaginationState["streams"];
    const transfersById = new Map(
      transferGroups
        .flatMap((group) => group)
        .map((transfer) => [transfer.transfer.id, transfer] as const),
    );
    const transferRows = await this.toApiTransferRows([...transfersById.values()]);
    return {
      documents: [...batch.documents, ...transferRows].sort(
        (left, right) =>
          new Date(right.lastUpdatedAt).getTime() - new Date(left.lastUpdatedAt).getTime(),
      ),
      incidents: batch.incidents,
      incidentTypes: [],
      incidentListIncomplete: batch.incidentListIncomplete,
      pagination: {
        branchId: activeBranchId,
        streams,
        hasMore: hasMoreReceivingPages(streams),
        receiptHistoryIncomplete: batch.receiptHistoryIncomplete,
      },
    };
  }

  private async toApiTransferRows(transfers: InventoryTransferWithItems[]) {
    if (transfers.length === 0) return [];
    const [branches, products] = await Promise.all([
      this.repositories.branches.getAll(),
      Promise.all(
        [
          ...new Set(transfers.flatMap((transfer) => transfer.items.map((item) => item.productId))),
        ].map((productId) => this.repositories.products.getById(productId)),
      ),
    ]);
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));
    const productById = new Map(
      products
        .filter((product): product is NonNullable<typeof product> => product !== null)
        .map((product) => [product.id, { name: product.name, sku: product.sku }]),
    );
    return transfers.map((transfer) =>
      toTransferRow(
        transfer,
        branchById.get(transfer.transfer.sourceBranchId)?.name ?? "Sucursal origen",
        productById,
      ),
    );
  }

  private async toApiPurchaseOrderRows(
    tenantId: string,
    branchId: string,
    purchaseOrders: PurchaseOrder[],
  ) {
    // Unica fuente operacional sin N+1: el usuario de la sesion; el resto se muestra "No disponible".
    const { user: sessionUser } = await resolveReceivingContext(this.repositories);
    const userNameById = new Map([[sessionUser.id, sessionUser.name]]);
    const uniqueOrders = [...new Map(purchaseOrders.map((order) => [order.id, order])).values()];
    const records = await Promise.all(
      uniqueOrders.map(async (order) => {
        // Una sola lectura por orden (sin `status`): el backend devuelve borradores y confirmadas
        // juntas y se separan en memoria por el estado real de cada recepcion. La pagina es
        // compartida: si `page < totalPages` el historial queda marcado como incompleto (abajo).
        const combined = await this.repositories.receipts.getPageScoped(tenantId, {
          branchId,
          purchaseOrderId: order.id,
          page: 1,
          pageSize: RECEIPT_HISTORY_PAGE_SIZE,
        });
        const drafts = {
          ...combined,
          items: combined.items.filter(
            (record) => record.receipt.status === ReceiptStatus.in_progress,
          ),
        };
        const confirmed = {
          ...combined,
          items: combined.items.filter(
            (record) => record.receipt.status !== ReceiptStatus.in_progress,
          ),
        };
        return { order, drafts, confirmed };
      }),
    );
    const receiptContexts = records.flatMap(({ order, drafts, confirmed }) =>
      [...drafts.items, ...confirmed.items].map((record) => ({ order, record })),
    );
    // incidentCount (agregado del backend) evita pedir las incidencias de un documento que no tiene
    // ninguna; sin el campo (backend antiguo) se consulta como antes.
    const incidentPages = await Promise.all(
      receiptContexts
        .filter(({ record }) => record.receipt.incidentCount !== 0)
        .map(async ({ order, record }) => ({
          order,
          record,
          page: await this.repositories.receipts.listIncidentsScoped(tenantId, record.receipt.id, {
            page: 1,
            pageSize: RECEIPT_HISTORY_PAGE_SIZE,
          }),
        })),
    );
    const productById = new Map<string, { name: string; sku: string }>();
    uniqueOrders.forEach((order) =>
      (order.items ?? []).forEach((item) =>
        productById.set(item.productId, {
          name: item.productNameSnapshot ?? "Producto no disponible",
          sku: item.productSkuSnapshot ?? "-",
        }),
      ),
    );
    return {
      documents: records.map(({ order, drafts, confirmed }) =>
        toPurchaseOrderRow(
          order,
          order.supplierNameSnapshot ?? "Proveedor no disponible",
          drafts.items.map((record) => record.receipt),
          [],
          productById,
          // Historial incompleto: no se afirma ninguna cantidad (igual que antes). Si no, el
          // agregado del backend por documento; sin el, la suma de sus lineas.
          confirmed.page < confirmed.totalPages
            ? 0
            : confirmed.items.reduce(
                (sum, record) =>
                  sum +
                  (record.receipt.totalReceivedQuantity ??
                    record.items.reduce(
                      (lineSum, item) => lineSum + item.line.receivedQuantity,
                      0,
                    )),
                0,
              ),
        ),
      ),
      incidents: incidentPages
        .flatMap(({ order, record, page }) =>
          page.items.map((incident) =>
            toApiIncidentListItem(incident, record, order, userNameById),
          ),
        )
        .sort((left, right) => right.date.localeCompare(left.date)),
      incidentListIncomplete: incidentPages.some(({ page }) => page.page < page.totalPages),
      receiptHistoryIncomplete: records.some(
        ({ drafts, confirmed }) =>
          drafts.page < drafts.totalPages || confirmed.page < confirmed.totalPages,
      ),
    };
  }
}

function toApiIncidentListItem(
  incident: ReceiptIncidentRecord,
  receipt: ReceiptRecord,
  order: PurchaseOrder,
  userNameById: Map<string, string>,
): IncidentListItemViewModel {
  const item = incident.goodsReceiptItemId
    ? receipt.items.find((candidate) => candidate.line.id === incident.goodsReceiptItemId)
    : undefined;
  return {
    id: incident.id,
    receiptId: receipt.receipt.id,
    receiptNumber: receipt.receipt.number,
    purchaseOrderId: order.id,
    purchaseOrderNumber: order.number,
    productName: item?.productNameSnapshot ?? "Incidencia general",
    sku: item?.productSkuSnapshot ?? "-",
    supplierId: order.supplierId,
    ...(order.supplierNameSnapshot ? { supplierName: order.supplierNameSnapshot } : {}),
    typeName: RECEIPT_INCIDENT_TYPE_LABELS[incident.incidentType],
    ...(incident.quantityAffected !== undefined
      ? { quantityAffected: incident.quantityAffected }
      : {}),
    observation: incident.notes,
    date: incident.createdAt,
    ...(userNameById.get(incident.createdByUserId)
      ? { responsibleName: userNameById.get(incident.createdByUserId) }
      : {}),
    evidence: [],
    status: incident.status,
    confirmed: receipt.receipt.status === ReceiptStatus.received,
  };
}

const RECEIVING_PAGE_SIZE = 25;
const RECEIPT_HISTORY_PAGE_SIZE = 100;
const PURCHASE_ORDER_STREAMS: Record<ReceivingPurchaseOrderStream, PurchaseOrderStatus> = {
  approved: PurchaseOrderStatus.approved,
  sent: PurchaseOrderStatus.sent,
  partially_received: PurchaseOrderStatus.partially_received,
  // Las ordenes completadas siguen siendo consultables: la vista "Recibidas" las necesita.
  received: PurchaseOrderStatus.received,
};

export function nextReceivingStream(
  pagination: ReceivingPaginationState,
): ReceivingPurchaseOrderStream | null {
  return (
    (Object.keys(PURCHASE_ORDER_STREAMS) as ReceivingPurchaseOrderStream[]).find(
      (stream) => pagination.streams[stream].currentPage < pagination.streams[stream].totalPages,
    ) ?? null
  );
}

function hasMoreReceivingPages(streams: ReceivingPaginationState["streams"]) {
  return Object.values(streams).some((stream) => stream.currentPage < stream.totalPages);
}

export function canDeleteIncidentType(usageCount: number) {
  return usageCount === 0;
}

export function canArchiveIncidentType(active: boolean, usageCount: number) {
  return active && usageCount > 0;
}

function toPurchaseOrderRow(
  order: PurchaseOrder,
  supplierName: string,
  receipts: Receipt[],
  receiptLines: ReceiptLine[],
  productById: Map<string, { name: string; sku: string }>,
  /** Agregado autoritativo del backend (modo API); sin el se suman las lineas recibidas. */
  receivedQuantityOverride?: number,
): ReceivingDocumentRow {
  const items = order.items ?? [];
  const requestedQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const receivedQuantity =
    receivedQuantityOverride ?? receiptLines.reduce((sum, line) => sum + line.receivedQuantity, 0);
  const status = getPurchaseOrderReceivingStatus(
    order,
    receipts,
    receivedQuantity,
    requestedQuantity,
  );
  const productNames = items.flatMap((item) => {
    const product = productById.get(item.productId);
    return [product?.name, product?.sku];
  });

  return {
    id: `purchase-order-${order.id}`,
    documentId: order.id,
    documentNumber: order.number,
    documentType: "purchase_order",
    documentTypeLabel: "Orden",
    supplierOrSource: supplierName,
    ...(order.expectedDate ? { expectedDate: order.expectedDate } : {}),
    productCount: items.length,
    requestedQuantity,
    receivedQuantity,
    status,
    statusLabel: getReceivingStatusLabel(status),
    lastUpdatedAt: order.updatedAt,
    searchText: normalize([order.number, supplierName, ...productNames].filter(Boolean).join(" ")),
  };
}

function toTransferRow(
  transfer: InventoryTransferWithItems,
  sourceBranchName: string,
  productById: Map<string, { name: string; sku: string }>,
): ReceivingDocumentRow {
  const requestedQuantity = transfer.items.reduce(
    (sum, item) => sum + getTransferRequestedQuantity(item),
    0,
  );
  const receivedQuantity = transfer.items.reduce((sum, item) => sum + item.receivedQuantity, 0);
  const status = getTransferReceivingStatus(transfer.transfer.status, receivedQuantity);
  const productNames = transfer.items.flatMap((item) => {
    const product = productById.get(item.productId);
    return [product?.name, product?.sku];
  });

  return {
    id: `transfer-${transfer.transfer.id}`,
    documentId: transfer.transfer.id,
    documentNumber: transfer.transfer.number,
    documentType: "transfer",
    documentTypeLabel: "Traslado",
    supplierOrSource: sourceBranchName,
    productCount: transfer.items.length,
    requestedQuantity,
    receivedQuantity,
    status,
    statusLabel: getReceivingStatusLabel(status),
    lastUpdatedAt: transfer.transfer.updatedAt,
    searchText: normalize(
      [transfer.transfer.number, sourceBranchName, ...productNames].filter(Boolean).join(" "),
    ),
  };
}

function getPurchaseOrderReceivingStatus(
  order: PurchaseOrder,
  receipts: Receipt[],
  receivedQuantity: number,
  requestedQuantity: number,
): ReceivingStatus {
  if (
    order.status === PurchaseOrderStatus.received ||
    receipts.some((receipt) => receipt.status === ReceiptStatus.received) ||
    (requestedQuantity > 0 && receivedQuantity >= requestedQuantity)
  ) {
    return "received";
  }
  if (
    order.status === PurchaseOrderStatus.partially_received ||
    receipts.some((receipt) => receipt.status === ReceiptStatus.partial) ||
    receivedQuantity > 0
  ) {
    return "partial";
  }
  if (
    order.status === PurchaseOrderStatus.sent ||
    receipts.some((receipt) => receipt.status === ReceiptStatus.in_progress)
  ) {
    return "in_process";
  }
  return "pending";
}

function getTransferReceivingStatus(
  status: InventoryTransferStatus,
  receivedQuantity: number,
): ReceivingStatus {
  if (status === InventoryTransferStatus.received) return "received";
  if (receivedQuantity > 0) return "partial";
  if (status === InventoryTransferStatus.inTransit) return "in_process";
  return "pending";
}

function getReceivingStatusLabel(status: ReceivingStatus) {
  const labels: Record<ReceivingStatus, string> = {
    pending: "Pendiente",
    in_process: "En proceso",
    partial: "Parcial",
    received: "Recibida",
  };
  return labels[status];
}

function isPurchaseOrderRelevantForReceiving(status: PurchaseOrderStatus) {
  return (
    status === PurchaseOrderStatus.approved ||
    status === PurchaseOrderStatus.sent ||
    status === PurchaseOrderStatus.partially_received ||
    status === PurchaseOrderStatus.received
  );
}

function isTransferRelevantForReceiving(status: InventoryTransferStatus) {
  return (
    status === InventoryTransferStatus.inTransit || status === InventoryTransferStatus.received
  );
}

function getTransferRequestedQuantity(item: InventoryTransferItem) {
  return item.dispatchedQuantity > 0 ? item.dispatchedQuantity : item.requestedQuantity;
}

function groupReceiptsByOrderId(receipts: Receipt[]) {
  return receipts.reduce((map, receipt) => {
    if (!receipt.purchaseOrderId || receipt.status === ReceiptStatus.cancelled) return map;
    map.set(receipt.purchaseOrderId, [...(map.get(receipt.purchaseOrderId) ?? []), receipt]);
    return map;
  }, new Map<string, Receipt[]>());
}

function groupReceiptLinesByReceiptId(receiptLines: ReceiptLine[]) {
  return receiptLines.reduce((map, line) => {
    map.set(line.receiptId, [...(map.get(line.receiptId) ?? []), line]);
    return map;
  }, new Map<string, ReceiptLine[]>());
}

function buildIncidentTypeRows(
  incidentTypes: IncidentType[],
  incidents: ReceiptIncident[],
): IncidentTypeReadModel[] {
  const usageByTypeId = incidents.reduce((map, incident) => {
    map.set(incident.incidentTypeId, (map.get(incident.incidentTypeId) ?? 0) + 1);
    return map;
  }, new Map<string, number>());
  return incidentTypes
    .map((incidentType) => {
      const usageCount = usageByTypeId.get(incidentType.id) ?? 0;
      return {
        id: incidentType.id,
        name: incidentType.name,
        code: incidentType.code,
        active: incidentType.active,
        usageCount,
        canDelete: canDeleteIncidentType(usageCount),
        canArchive: canArchiveIncidentType(incidentType.active, usageCount),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function toCode(value: string) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
