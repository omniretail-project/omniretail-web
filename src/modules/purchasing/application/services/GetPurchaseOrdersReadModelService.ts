import type {
  Product,
  PurchaseOrder,
  PurchaseOrderItem,
  Receipt,
  ReceiptLine,
  Supplier,
  Unit,
} from "@/core/entities";
import { PurchaseOrderStatus, ReceiptStatus } from "@/core/enums";
import type { InventoryAlertListItem, OperationalSupplier } from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { GetInventoryAlertsService } from "@/modules/inventory/application/services/GetInventoryAlertsService";
import { INVENTORY_STOCK_READ_PERMISSION } from "@/modules/inventory/application/services/serviceHelpers";
import type {
  PurchaseOrderLineReadModel,
  PurchaseOrderReceptionReadModel,
  PurchaseOrderRowReadModel,
  PurchaseOrdersReadModel,
  ReorderSuggestionReadModel,
} from "@/modules/purchasing/application/dto/PurchaseOrderReadModel";
import { getPurchaseOrderActions } from "@/modules/purchasing/application/services/purchaseOrderActions";
import {
  ensureCanReadPurchaseOrders,
  resolvePurchasingContext,
} from "@/modules/purchasing/application/services/serviceHelpers";

export interface GetPurchaseOrdersParams {
  branchId?: string;
  branchName?: string;
  supplierId?: string;
  status?: PurchaseOrderStatus;
  search?: string;
  page: number;
  pageSize: number;
}

const PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.draft,
  PurchaseOrderStatus.pending_approval,
  PurchaseOrderStatus.approved,
  PurchaseOrderStatus.sent,
  PurchaseOrderStatus.partially_received,
  PurchaseOrderStatus.received,
  PurchaseOrderStatus.cancelled,
];
const ACTIVE_REPLENISHMENT_STATUSES = new Set<PurchaseOrderStatus>([
  PurchaseOrderStatus.pending_approval,
  PurchaseOrderStatus.approved,
  PurchaseOrderStatus.sent,
  PurchaseOrderStatus.partially_received,
]);

export class GetPurchaseOrdersReadModelService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(input?: string | GetPurchaseOrdersParams): Promise<PurchaseOrdersReadModel> {
    const { tenantId, permissions } = await resolvePurchasingContext(this.repositories);
    ensureCanReadPurchaseOrders(permissions);

    if (this.repositories.purchaseOrdersDataSource === "api") {
      const params = typeof input === "object" ? input : defaultApiParams(input);
      return this.getApiPage(tenantId, permissions, params);
    }
    return this.getMockData(tenantId, permissions);
  }

  /**
   * Sugerencias de reposicion, separadas de la pagina de ordenes: solo se piden cuando el panel se
   * expande (ver usePurchaseOrders). El resultado depende de tenant + sucursal, no de la pagina ni
   * de los filtros de ordenes.
   */
  async loadReorderSuggestions(
    branchId: string | undefined,
  ): Promise<{ suggestions: ReorderSuggestionReadModel[]; notice?: string }> {
    const { tenantId, permissions } = await resolvePurchasingContext(this.repositories);
    ensureCanReadPurchaseOrders(permissions);
    if (!branchId) return { suggestions: [] };

    if (this.repositories.purchaseOrdersDataSource === "api") {
      if (!permissions.includes(INVENTORY_STOCK_READ_PERMISSION)) {
        return {
          suggestions: [],
          notice: "No dispone de permisos para consultar sugerencias de inventario.",
        };
      }
      return this.getApiReorderSuggestions(
        tenantId,
        branchId,
        this.repositories.suppliers.getActiveByTenant(tenantId),
      );
    }
    const [suppliers, orders] = await Promise.all([
      this.repositories.suppliers.listByTenant(tenantId),
      this.repositories.purchaseOrders.listByTenant(tenantId),
    ]);
    return { suggestions: await this.getReorderSuggestions(branchId, suppliers, orders) };
  }

  async getById(
    id: string,
    branch?: { id?: string; name?: string },
  ): Promise<PurchaseOrderRowReadModel | null> {
    const { tenantId, permissions } = await resolvePurchasingContext(this.repositories);
    ensureCanReadPurchaseOrders(permissions);
    if (this.repositories.purchaseOrdersDataSource !== "api") return null;
    const order = await this.repositories.purchaseOrders.getByIdScoped(tenantId, id);
    return order
      ? toApiOrderReadModel(
          order,
          tenantId,
          order.branchId === branch?.id ? branch.name : undefined,
          permissions,
        )
      : null;
  }

  private async getApiPage(
    tenantId: string,
    permissions: readonly string[],
    params: GetPurchaseOrdersParams,
  ): Promise<PurchaseOrdersReadModel> {
    const [page, suppliers] = await Promise.all([
      this.repositories.purchaseOrders.getPageScoped(tenantId, {
        branchId: params.branchId,
        supplierId: params.supplierId,
        status: params.status,
        search: params.search,
        page: params.page,
        pageSize: params.pageSize,
      }),
      this.repositories.suppliers.getActiveByTenant(tenantId),
    ]);
    return {
      orders: page.items.map((order) =>
        toApiOrderReadModel(
          order,
          tenantId,
          order.branchId === params.branchId ? params.branchName : undefined,
          permissions,
        ),
      ),
      suppliers: suppliers
        .map((supplier) => ({ id: supplier.id, name: supplier.name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      statuses: PURCHASE_ORDER_STATUSES,
      // Las sugerencias ya no viajan con la pagina: ver loadReorderSuggestions.
      suggestions: [],
      page: page.page,
      pageSize: page.pageSize,
      totalItems: page.totalItems,
      totalPages: page.totalPages,
    };
  }

  private async getApiReorderSuggestions(
    tenantId: string,
    branchId: string,
    suppliersPromise: Promise<OperationalSupplier[]>,
  ): Promise<{ suggestions: ReorderSuggestionReadModel[]; notice?: string }> {
    const activeStatuses = [...ACTIVE_REPLENISHMENT_STATUSES];
    const orderPagesPromise = Promise.all(
      activeStatuses.map((status) =>
        this.repositories.purchaseOrders.getPageScoped(tenantId, {
          branchId,
          status,
          page: 1,
          pageSize: API_SUGGESTION_PAGE_SIZE,
        }),
      ),
    );
    const [alertsPage, suppliers, orderPages] = await Promise.all([
      this.repositories.inventory.getInventoryAlertPage({
        branchId,
        page: 1,
        pageSize: API_SUGGESTION_PAGE_SIZE,
      }),
      suppliersPromise,
      orderPagesPromise,
    ]);

    if (orderPages.some((page) => page.totalPages > 1)) {
      return {
        suggestions: [],
        notice:
          "No se muestran cantidades de reposicion porque existen mas ordenes activas de las que pueden verificarse en una sola pagina.",
      };
    }

    const orders = orderPages.flatMap((page) => page.items);
    const candidates = alertsPage.items
      .map((alert) => ({
        alert,
        remainingQuantity: Math.max(
          0,
          alert.suggestedReorder - getOpenPurchaseQuantity(orders, branchId, alert.productId),
        ),
      }))
      .filter((candidate) => candidate.remainingQuantity > 0)
      .slice(0, 5);
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const supplierProductsByCandidate = await Promise.all(
      candidates.map((candidate) =>
        this.repositories.supplierProducts.getByProductForTenant(
          tenantId,
          candidate.alert.productId,
        ),
      ),
    );
    const suggestions = candidates.map(({ alert, remainingQuantity }, index) => {
      const associatedSupplierProducts = supplierProductsByCandidate[index].filter(
        (item) =>
          item.active && item.productId === alert.productId && supplierById.has(item.supplierId),
      );
      const preferredSupplierIds = [
        ...new Set(
          associatedSupplierProducts
            .filter((item) => item.preferred)
            .map((item) => item.supplierId),
        ),
      ];
      const preferredSupplier =
        preferredSupplierIds.length === 1 ? supplierById.get(preferredSupplierIds[0]) : undefined;
      return toApiReorderSuggestion(
        alert,
        remainingQuantity,
        new Set(associatedSupplierProducts.map((item) => item.supplierId)).size,
        preferredSupplier,
      );
    });

    return {
      suggestions,
      ...(alertsPage.totalPages > 1
        ? {
            notice:
              "Las sugerencias visibles corresponden a la primera pagina de alertas de inventario.",
          }
        : {}),
    };
  }

  private async getMockData(
    tenantId: string,
    permissions: readonly string[],
  ): Promise<PurchaseOrdersReadModel> {
    const [orders, suppliers, products, units, branches, receipts] = await Promise.all([
      this.repositories.purchaseOrders.listByTenant(tenantId),
      this.repositories.suppliers.listByTenant(tenantId),
      this.repositories.products.getAll(),
      this.repositories.units.getAll(),
      this.repositories.branches.getAll(),
      this.repositories.receipts.listByTenant(tenantId),
    ]);
    const productById = new Map(products.map((product) => [product.id, product]));
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));
    const receiptsByOrderId = groupReceiptsByOrderId(receipts);

    const receiptLinesByOrderId = await this.getReceiptLinesByOrderId(receipts);

    const mappedOrders = orders
      .map((order) =>
        this.toOrderReadModel({
          order,
          supplier: supplierById.get(order.supplierId),
          branchName: branchById.get(order.branchId)?.name ?? "Sucursal no disponible",
          productById,
          unitById,
          receipts: receiptsByOrderId.get(order.id) ?? [],
          receiptLines: receiptLinesByOrderId.get(order.id) ?? [],
          permissions,
        }),
      )
      .sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      );

    return {
      orders: mappedOrders,
      suppliers: suppliers
        .map((supplier) => ({ id: supplier.id, name: supplier.name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      statuses: PURCHASE_ORDER_STATUSES,
      suggestions: [],
      page: 1,
      pageSize: Math.max(1, mappedOrders.length),
      totalItems: mappedOrders.length,
      totalPages: 1,
    };
  }

  private toOrderReadModel({
    order,
    supplier,
    branchName,
    productById,
    unitById,
    receipts,
    receiptLines,
    permissions,
  }: {
    order: PurchaseOrder;
    supplier?: Supplier;
    branchName: string;
    productById: Map<string, Product>;
    unitById: Map<string, Unit>;
    receipts: Receipt[];
    receiptLines: ReceiptLine[];
    permissions: readonly string[];
  }): PurchaseOrderRowReadModel {
    const receivedByProductId = groupReceivedQuantityByProductId(receiptLines);
    const lines = (order.items ?? []).map((item) =>
      toLineReadModel(item, productById, unitById, receivedByProductId.get(item.productId) ?? 0),
    );
    const reception = getReception(order, receipts);
    const supplierContactLabel = [supplier?.phone, supplier?.email].filter(Boolean).join(" | ");

    return {
      id: order.id,
      tenantId: order.tenantId,
      branchId: order.branchId,
      branchName,
      number: order.number,
      supplierId: order.supplierId,
      supplierName: supplier?.name ?? "Proveedor no disponible",
      supplierContactLabel: supplierContactLabel || "Sin contacto",
      status: order.status,
      expectedDate: order.expectedDate,
      createdAt: order.createdAt,
      total: order.total,
      productCount: lines.length,
      lines,
      reception,
      actions: getPurchaseOrderActions(order.status, permissions),
      searchText: [
        order.number,
        supplier?.name,
        supplier?.legalName,
        ...lines.flatMap((line) => [line.productName, line.sku]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    };
  }

  private async getReorderSuggestions(
    activeBranchId: string,
    suppliers: Supplier[],
    orders: PurchaseOrder[],
  ): Promise<ReorderSuggestionReadModel[]> {
    const inventoryAlerts = await new GetInventoryAlertsService(this.repositories).execute(
      activeBranchId,
    );
    const rowByProductId = new Map(inventoryAlerts.rows.map((row) => [row.productId, row]));
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));

    const suggestions = await Promise.all(
      inventoryAlerts.alerts
        .filter((alert) => alert.type === "low_stock" && alert.suggestedReorder)
        .map(async (alert) => {
          const row = rowByProductId.get(alert.productId);
          const supplierProducts = await this.repositories.supplierProducts.getByProduct(
            alert.productId,
          );
          const associatedSupplierProducts = supplierProducts.filter(
            (item) => item.active && (!row || item.tenantId === row.tenantId),
          );
          const preferredSupplierProduct = associatedSupplierProducts.find(
            (item) => item.preferred,
          );
          const preferredSupplier = preferredSupplierProduct
            ? supplierById.get(preferredSupplierProduct.supplierId)
            : undefined;
          const openQuantity = getOpenPurchaseQuantity(orders, activeBranchId, alert.productId);
          const remainingQuantity = Math.max(0, (alert.suggestedReorder ?? 0) - openQuantity);

          return {
            id: `reorder-${row?.branchId ?? activeBranchId}-${alert.productId}`,
            productId: alert.productId,
            branchId: row?.branchId ?? activeBranchId,
            productName: row?.productName ?? alert.title,
            sku: row?.sku ?? alert.productId,
            currentStock: row?.quantity ?? 0,
            reservedStock: row?.reservedQuantity ?? 0,
            availableStock: row?.availableQuantity ?? 0,
            minStock: row?.minStock ?? 0,
            suggestedQuantity: remainingQuantity,
            shortage: Math.max(0, (row?.minStock ?? 0) - (row?.availableQuantity ?? 0)),
            preferredSupplierId: preferredSupplier?.id,
            preferredSupplierName: preferredSupplier?.name ?? "Sin proveedor preferido",
            associatedSupplierCount: associatedSupplierProducts.length,
          };
        }),
    );
    return suggestions.filter((suggestion) => suggestion.suggestedQuantity > 0).slice(0, 5);
  }

  private async getReceiptLinesByOrderId(receipts: Receipt[]) {
    const entries = await Promise.all(
      receipts
        .filter((receipt) => receipt.purchaseOrderId)
        .map(
          async (receipt) =>
            [
              receipt.purchaseOrderId as string,
              await this.repositories.receipts.getLinesByReceipt(receipt.id),
            ] as const,
        ),
    );

    return entries.reduce((map, [purchaseOrderId, lines]) => {
      map.set(purchaseOrderId, [...(map.get(purchaseOrderId) ?? []), ...lines]);
      return map;
    }, new Map<string, ReceiptLine[]>());
  }
}

function getOpenPurchaseQuantity(orders: PurchaseOrder[], branchId: string, productId: string) {
  return orders
    .filter((order) => order.branchId === branchId && isActiveReplenishmentOrder(order.status))
    .flatMap((order) => order.items ?? [])
    .filter((item) => item.productId === productId)
    .reduce((total, item) => total + item.quantity, 0);
}

const API_SUGGESTION_PAGE_SIZE = 100;

function toApiReorderSuggestion(
  alert: InventoryAlertListItem,
  remainingQuantity: number,
  associatedSupplierCount: number,
  preferredSupplier?: OperationalSupplier,
): ReorderSuggestionReadModel {
  return {
    id: `reorder-${alert.branchId}-${alert.productId}`,
    productId: alert.productId,
    branchId: alert.branchId,
    productName: alert.productName,
    sku: alert.sku,
    currentStock: alert.quantity,
    reservedStock: alert.reservedQuantity,
    availableStock: alert.availableQuantity,
    minStock: alert.minStock,
    suggestedQuantity: remainingQuantity,
    shortage: Math.max(0, alert.minStock - alert.availableQuantity),
    preferredSupplierId: preferredSupplier?.id,
    preferredSupplierName: preferredSupplier?.name ?? "Sin proveedor preferido",
    associatedSupplierCount,
  };
}

function defaultApiParams(branchId?: string): GetPurchaseOrdersParams {
  return {
    branchId,
    page: 1,
    pageSize: 10,
  };
}

function toApiOrderReadModel(
  order: PurchaseOrder,
  tenantId: string,
  branchName: string | undefined,
  permissions: readonly string[],
): PurchaseOrderRowReadModel {
  const lines = (order.items ?? []).map((item) => ({
    id: item.id,
    productName: item.productNameSnapshot ?? "Producto no disponible",
    sku: item.productSkuSnapshot ?? item.productId,
    supplierSku: item.supplierSkuSnapshot,
    quantity: item.quantity,
    unitLabel: item.unitSymbolSnapshot ?? item.unitId,
    purchaseToBaseFactor: item.purchaseToBaseFactor,
    unitCost: item.unitCost,
    suggestedUnitCost: item.suggestedUnitCost,
    subtotal: item.subtotal,
  }));
  const supplierName = order.supplierNameSnapshot ?? "Proveedor no disponible";

  return {
    id: order.id,
    tenantId,
    branchId: order.branchId,
    branchName: branchName ?? "Sucursal no disponible",
    number: order.number,
    supplierId: order.supplierId,
    supplierName,
    supplierContactLabel: "Contacto no incluido en la orden",
    status: order.status,
    expectedDate: order.expectedDate,
    createdAt: order.createdAt,
    total: order.total,
    productCount: lines.length,
    lines,
    reception: getApiReception(order),
    actions: getPurchaseOrderActions(order.status, permissions),
    searchText: [
      order.number,
      supplierName,
      ...lines.flatMap((line) => [line.productName, line.sku, line.supplierSku]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
  };
}

function getApiReception(order: PurchaseOrder): PurchaseOrderReceptionReadModel {
  const ordered = order.items?.reduce((total, item) => total + item.quantity, 0);
  if (order.status === PurchaseOrderStatus.received) {
    return {
      received: ordered,
      ordered,
      percentage: 100,
      label: "Recibida",
      tone: "success",
    };
  }
  if (order.status === PurchaseOrderStatus.partially_received) {
    return {
      ordered,
      percentage: 0,
      label: "Recepcion parcial",
      tone: "warning",
    };
  }
  if (order.status === PurchaseOrderStatus.approved || order.status === PurchaseOrderStatus.sent) {
    return {
      ordered,
      percentage: 0,
      label: "Pendiente de recepcion",
      tone: "info",
    };
  }
  if (
    order.status === PurchaseOrderStatus.draft ||
    order.status === PurchaseOrderStatus.pending_approval
  ) {
    return {
      ordered,
      percentage: 0,
      label: "Aun no recibible",
      tone: "neutral",
    };
  }
  return {
    ordered,
    percentage: 0,
    label: "Cancelada",
    tone: "neutral",
  };
}

function isActiveReplenishmentOrder(status: PurchaseOrderStatus) {
  return ACTIVE_REPLENISHMENT_STATUSES.has(status);
}

function toLineReadModel(
  item: PurchaseOrderItem,
  productById: Map<string, Product>,
  unitById: Map<string, Unit>,
  receivedQuantity: number,
): PurchaseOrderLineReadModel {
  const product = productById.get(item.productId);
  const unit = unitById.get(item.unitId);
  return {
    id: item.id,
    productName: product?.name ?? "Producto no disponible",
    sku: product?.sku ?? item.productId,
    quantity: item.quantity,
    unitLabel: unit?.symbol ?? unit?.name ?? item.unitId,
    unitCost: item.unitCost,
    subtotal: item.subtotal,
    receivedQuantity,
    registeredCost: undefined,
  };
}

function groupReceivedQuantityByProductId(lines: ReceiptLine[]) {
  return lines.reduce((map, line) => {
    map.set(line.productId, (map.get(line.productId) ?? 0) + line.receivedQuantity);
    return map;
  }, new Map<string, number>());
}

function getReception(order: PurchaseOrder, receipts: Receipt[]): PurchaseOrderReceptionReadModel {
  const ordered = order.items?.reduce((total, item) => total + item.quantity, 0);
  if (typeof ordered === "number" && ordered > 0) {
    if (order.status === PurchaseOrderStatus.received) {
      return {
        received: ordered,
        ordered,
        percentage: 100,
        label: `${formatQuantity(ordered)} de ${formatQuantity(ordered)} recibidas`,
        tone: "success",
      };
    }
    if (order.status === PurchaseOrderStatus.partially_received) {
      return {
        ordered,
        percentage: 50,
        label: `Recepcion parcial de ${formatQuantity(ordered)} solicitadas`,
        tone: "warning",
      };
    }
  }

  if (receipts.some((receipt) => receipt.status === ReceiptStatus.received)) {
    return {
      percentage: 100,
      label: "Recepcion registrada",
      tone: "success",
    };
  }
  if (receipts.some((receipt) => receipt.status === ReceiptStatus.partial)) {
    return {
      percentage: 50,
      label: "Recepcion parcial",
      tone: "warning",
    };
  }
  if (receipts.some((receipt) => receipt.status === ReceiptStatus.in_progress)) {
    return {
      percentage: 25,
      label: "Recepcion en curso",
      tone: "info",
    };
  }

  return {
    percentage: 0,
    label: "No iniciada",
    tone: "neutral",
  };
}

function groupReceiptsByOrderId(receipts: Receipt[]) {
  return receipts.reduce((map, receipt) => {
    if (!receipt.purchaseOrderId) return map;
    const group = map.get(receipt.purchaseOrderId) ?? [];
    group.push(receipt);
    map.set(receipt.purchaseOrderId, group);
    return map;
  }, new Map<string, Receipt[]>());
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("es-GT").format(value);
}
