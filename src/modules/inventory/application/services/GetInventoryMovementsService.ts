import { formatInventoryReference } from "@/modules/inventory/application/services/formatInventoryReference";
import type { InventoryAdjustment, InventoryMovement } from "@/core/entities";
import { InventoryAdjustmentType, InventoryMovementType } from "@/core/enums";
import type {
  InventoryMovementListItem,
  InventoryMovementPageParams,
  InventoryTransferWithItems,
} from "@/core/repositories";
import { canUserOperateBranch } from "@/core/scopes/userBranchAccess";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  InventoryMovementKpis,
  InventoryMovementRow,
  InventoryMovementsData,
} from "@/modules/inventory/application/dto/InventoryMovementsDto";
import {
  ensureCanReadMovements,
  ensureUserCanOperateInventoryBranch,
  resolveInventoryContext,
} from "@/modules/inventory/application/services/serviceHelpers";

export class GetInventoryMovementsService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(params: GetInventoryMovementsParams): Promise<InventoryMovementsData> {
    if (this.repositories.inventoryMovementsDataSource === "api") {
      return this.getApiPage(params);
    }
    return this.getMockMovements(params.activeBranchId);
  }

  async exportAll(params: GetInventoryMovementsParams): Promise<InventoryMovementsData> {
    if (this.repositories.inventoryMovementsDataSource !== "api") {
      return this.getMockMovements(params.activeBranchId);
    }

    const { permissions } = await resolveInventoryContext(this.repositories);
    ensureCanReadMovements(permissions);

    const firstPage = await this.repositories.inventory.getMovementPage({
      ...toApiPageParams(params),
      page: 1,
      pageSize: EXPORT_PAGE_SIZE,
    });
    const rows = firstPage.items.map(mapApiMovement);
    const expectedPages = Math.max(
      firstPage.totalPages,
      Math.ceil(firstPage.totalItems / EXPORT_PAGE_SIZE),
    );
    if (!Number.isSafeInteger(expectedPages) || expectedPages > MAX_EXPORT_PAGES) {
      throw new Error("La exportacion supera el limite seguro de paginas.");
    }

    for (let page = 2; page <= expectedPages && rows.length < firstPage.totalItems; page += 1) {
      const nextPage = await this.repositories.inventory.getMovementPage({
        ...toApiPageParams(params),
        page,
        pageSize: EXPORT_PAGE_SIZE,
      });
      if (nextPage.page !== page) {
        throw new Error("El backend devolvio una pagina de movimientos inesperada.");
      }
      if (nextPage.items.length === 0) break;
      rows.push(...nextPage.items.map(mapApiMovement));
    }

    return {
      rows,
      branches: [],
      page: 1,
      pageSize: EXPORT_PAGE_SIZE,
      totalItems: firstPage.totalItems,
      totalPages: firstPage.totalPages,
      summary: firstPage.summary,
    };
  }

  private async getApiPage(params: GetInventoryMovementsParams): Promise<InventoryMovementsData> {
    const { permissions } = await resolveInventoryContext(this.repositories);
    ensureCanReadMovements(permissions);
    const result = await this.repositories.inventory.getMovementPage(toApiPageParams(params));
    return {
      rows: result.items.map(mapApiMovement),
      branches: [],
      page: result.page,
      pageSize: result.pageSize,
      totalItems: result.totalItems,
      totalPages: result.totalPages,
      summary: result.summary,
    };
  }

  private async getMockMovements(activeBranchId?: string): Promise<InventoryMovementsData> {
    const { tenantId, user, permissions } = await resolveInventoryContext(this.repositories);
    ensureCanReadMovements(permissions);
    const branches = await this.repositories.branches.getAll();
    const tenantBranches = branches.filter((branch) => branch.tenantId === tenantId);
    const visibleBranches = tenantBranches.filter((branch) => canUserOperateBranch(user, branch));
    const visibleBranchIds = new Set(visibleBranches.map((branch) => branch.id));
    if (activeBranchId && activeBranchId !== "all") {
      await ensureUserCanOperateInventoryBranch(this.repositories, user, activeBranchId);
    }
    const [
      movements,
      products,
      units,
      locations,
      users,
      purchaseOrders,
      receipts,
      dispatches,
      orders,
      sales,
      inventoryAdjustments,
      inventoryTransfers,
    ] = await Promise.all([
      this.repositories.inventory.getMovements(),
      this.repositories.products.getAll(),
      this.repositories.units.getAll(),
      this.repositories.inventory.getLocations(),
      this.repositories.users.getAll(),
      this.repositories.purchaseOrders.getAll(),
      this.repositories.receipts.getAll(),
      this.repositories.dispatches.getAll({ tenantId }),
      this.repositories.orders.getAll(),
      this.repositories.sales.getAll(),
      this.repositories.inventoryAdjustments.query(),
      this.repositories.inventoryTransfers.query(),
    ]);

    const productById = new Map(products.map((product) => [product.id, product]));
    const branchById = new Map(branches.map((branch) => [branch.id, branch]));
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const locationById = new Map(locations.map((location) => [location.id, location]));
    const userById = new Map(users.map((user) => [user.id, user]));
    const referenceResolver = buildReferenceResolver({
      purchaseOrders,
      receipts,
      dispatches,
      orders: orders.filter((order) => order.tenantId === tenantId),
      sales,
      inventoryAdjustments,
      inventoryTransfers,
    });
    const adjustmentById = new Map(
      inventoryAdjustments.map((adjustment) => [adjustment.id, adjustment]),
    );
    const transferById = new Map(inventoryTransfers.map((entry) => [entry.transfer.id, entry]));

    const rows = movements
      .filter((movement) => movement.tenantId === tenantId)
      .filter((movement) =>
        activeBranchId && activeBranchId !== "all"
          ? movement.branchId === activeBranchId
          : visibleBranchIds.has(movement.branchId),
      )
      .map<InventoryMovementRow>((movement) => {
        const product = productById.get(movement.productId);
        const branch = branchById.get(movement.branchId);
        const fromLocation = movement.fromLocationId
          ? locationById.get(movement.fromLocationId)
          : undefined;
        const toLocation = movement.toLocationId
          ? locationById.get(movement.toLocationId)
          : undefined;
        const unit = product ? unitById.get(product.baseUnitId) : undefined;
        const referenceLabel = getReferenceLabel(movement, referenceResolver);
        const adjustment =
          movement.referenceType === "inventoryAdjustment" && movement.referenceId
            ? adjustmentById.get(movement.referenceId)
            : undefined;
        const transfer = movement.referenceId ? transferById.get(movement.referenceId) : undefined;
        const displayType = getMovementDisplayType(movement, transfer, adjustment);

        return {
          id: movement.id,
          tenantId: movement.tenantId,
          branchId: movement.branchId,
          branchName: branch?.name ?? "Sucursal no disponible",
          productId: movement.productId,
          productName: product?.name ?? "Producto no disponible",
          sku: product?.sku ?? movement.productId,
          type: movement.type,
          displayType,
          typeLabel: getMovementTypeLabel(displayType),
          typeTone: getMovementTypeTone(displayType),
          quantity: movement.quantity,
          signedQuantity: getSignedQuantity(movement),
          quantityBefore: movement.quantityBefore,
          quantityAfter: movement.quantityAfter,
          unitLabel: unit?.symbol ?? unit?.name ?? "unid.",
          fromLocationName: fromLocation?.name,
          toLocationName: toLocation?.name,
          locationLabel: getLocationLabel(movement, fromLocation?.name, toLocation?.name),
          referenceType: movement.referenceType,
          referenceId: movement.referenceId,
          referenceLabel,
          performedByUserId: movement.performedByUserId,
          userLabel: movement.performedByUserId
            ? (userById.get(movement.performedByUserId)?.name ?? movement.performedByUserId)
            : "-",
          reason: movement.reason,
          createdAt: movement.createdAt,
          transferDetail: transfer
            ? getTransferDetail(movement, transfer, branchById, productById)
            : undefined,
          adjustmentDetail: adjustment ? getAdjustmentDetail(adjustment) : undefined,
        };
      })
      .sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      );

    const summary = getMovementKpis(rows);
    return {
      rows,
      branches: visibleBranches
        .map((branch) => ({ id: branch.id, name: branch.name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      page: 1,
      pageSize: Math.max(1, rows.length),
      totalItems: rows.length,
      totalPages: 1,
      summary,
    };
  }
}

export interface GetInventoryMovementsParams extends InventoryMovementPageParams {
  activeBranchId?: string;
}

const EXPORT_PAGE_SIZE = 100;
const MAX_EXPORT_PAGES = 10_000;

function toApiPageParams(params: GetInventoryMovementsParams): InventoryMovementPageParams {
  return {
    branchId: params.branchId,
    productId: params.productId,
    type: params.type,
    from: params.from,
    to: params.to,
    search: params.search,
    displayType: params.displayType,
    page: params.page,
    pageSize: params.pageSize,
    sort: params.sort,
  };
}

/**
 * Ajustes manuales: el backend solo distingue in/out, pero persiste referenceType estructurado.
 * Movimientos antiguos (referenceType null/otro) conservan Entrada/Salida.
 */
function resolveApiAdjustmentDisplay(movement: InventoryMovementListItem) {
  if (movement.displayType !== "in" && movement.displayType !== "out") return null;
  if (movement.referenceType === "manual_in") {
    return { displayType: "manual_in" as const, label: "Entrada manual" };
  }
  if (movement.referenceType === "manual_out") {
    return { displayType: "manual_out" as const, label: "Salida manual" };
  }
  if (movement.referenceType === "waste") {
    return { displayType: "shrinkage" as const, label: "Merma" };
  }
  if (movement.referenceType === "count_correction") {
    return { displayType: "inventory_adjustment" as const, label: "Conteo físico" };
  }
  return null;
}

function mapApiMovement(movement: InventoryMovementListItem): InventoryMovementRow {
  const adjustmentDisplay = resolveApiAdjustmentDisplay(movement);
  return {
    id: movement.id,
    tenantId: movement.tenantId,
    branchId: movement.branchId,
    branchName: movement.branchName ?? "Sucursal no disponible",
    productId: movement.productId,
    productName: movement.productName ?? "Producto no disponible",
    sku: movement.sku ?? movement.productId,
    type: movement.type,
    displayType: adjustmentDisplay?.displayType ?? movement.displayType,
    typeLabel: adjustmentDisplay?.label ?? getMovementTypeLabel(movement.displayType),
    typeTone: getMovementTypeTone(adjustmentDisplay?.displayType ?? movement.displayType),
    quantity: movement.quantity,
    signedQuantity: getApiSignedQuantity(movement),
    quantityBefore: movement.quantityBefore ?? undefined,
    quantityAfter: movement.quantityAfter ?? undefined,
    unitLabel: "",
    fromLocationName: movement.fromLocationName ?? undefined,
    toLocationName: movement.toLocationName ?? undefined,
    locationLabel: getApiLocationLabel(movement),
    referenceType: movement.referenceType ?? undefined,
    referenceId: movement.referenceId ?? undefined,
    referenceLabel:
      movement.referenceType === "count_correction"
        ? formatInventoryReference(movement.referenceType, movement.referenceId, movement.referenceLabel)
        : (movement.referenceLabel ?? "-"),
    performedByUserId: movement.performedByUserId ?? undefined,
    userLabel: movement.userLabel ?? "-",
    reason: movement.reason,
    createdAt: movement.createdAt,
  };
}

function getApiSignedQuantity(movement: InventoryMovementListItem) {
  if (movement.type === InventoryMovementType.out) return -movement.quantity;
  if (movement.type === InventoryMovementType.transfer) return 0;
  return movement.quantity;
}

function getApiLocationLabel(movement: InventoryMovementListItem) {
  if (movement.type === InventoryMovementType.transfer) {
    return `${movement.fromLocationName ?? "Origen no disponible"} -> ${
      movement.toLocationName ?? "Destino no disponible"
    }`;
  }
  return movement.toLocationName ?? movement.fromLocationName ?? "-";
}

function getMovementKpis(rows: InventoryMovementRow[]): InventoryMovementKpis {
  const incoming = rows
    .filter((row) => row.signedQuantity > 0)
    .reduce((total, row) => total + row.signedQuantity, 0);
  const outgoing = rows
    .filter((row) => row.signedQuantity < 0)
    .reduce((total, row) => total + Math.abs(row.signedQuantity), 0);
  return { incoming, outgoing, net: incoming - outgoing };
}

function getSignedQuantity(movement: InventoryMovement) {
  if (movement.type === InventoryMovementType.out) return -movement.quantity;
  if (movement.type === InventoryMovementType.transfer) return 0;
  return movement.quantity;
}

function getMovementDisplayType(
  movement: InventoryMovement,
  transfer?: InventoryTransferWithItems,
  adjustment?: InventoryAdjustment,
): InventoryMovementRow["displayType"] {
  if (movement.referenceType === "inventoryAdjustment" && adjustment) {
    if (adjustment.type === InventoryAdjustmentType.manualIncrease) return "manual_in";
    if (adjustment.type === InventoryAdjustmentType.manualDecrease) return "manual_out";
    if (adjustment.type === InventoryAdjustmentType.waste) return "shrinkage";
    return "inventory_adjustment";
  }
  if (movement.referenceType === "transfer" && transfer) {
    if (movement.branchId === transfer.transfer.sourceBranchId) return "transfer_out";
    if (movement.branchId === transfer.transfer.destinationBranchId) return "transfer_in";
    return "transfer";
  }
  if (movement.referenceType === "return") return "return";
  if (movement.referenceType === "void") return "void";
  if (movement.referenceType === "order") return "store_pickup";
  if (movement.type === InventoryMovementType.in) {
    if (movement.referenceType === "receipt" || movement.referenceType === "purchase_order") {
      return "purchase_in";
    }
    if (movement.referenceType === "transfer") return "transfer_in";
    if (movement.referenceType === "stock_count") return "inventory_adjustment";
    return "manual_in";
  }
  if (movement.type === InventoryMovementType.out) {
    if (movement.referenceType === "dispatch") return "dispatch";
    if (movement.referenceType === "sale") return "sale";
    if (movement.referenceType === "transfer") return "transfer_out";
    if (movement.referenceType === "stock_count") return "inventory_adjustment";
    if (isShrinkageReason(movement.reason)) return "shrinkage";
    return "manual_out";
  }
  if (movement.type === InventoryMovementType.adjustment) return "inventory_adjustment";
  if (movement.type === InventoryMovementType.transfer) return "transfer";
  return "adjustment";
}

function getMovementTypeLabel(type: InventoryMovementRow["displayType"]) {
  const labels: Record<InventoryMovementRow["displayType"], string> = {
    purchase_in: "Entrada por compra",
    transfer_out: "Salida por traslado",
    transfer_in: "Entrada por traslado",
    inventory_adjustment: "Ajuste de inventario",
    shrinkage: "Merma",
    manual_in: "Entrada manual",
    manual_out: "Salida manual",
    sale: "Venta",
    dispatch: "Despacho",
    return: "Devolución",
    void: "Anulación",
    store_pickup: "Retiro en tienda",
    in: "Entrada",
    out: "Salida",
    adjustment: "Ajuste",
    transfer: "Traslado",
  };
  return labels[type];
}

function getMovementTypeTone(
  type: InventoryMovementRow["displayType"],
): InventoryMovementRow["typeTone"] {
  if (
    type === "purchase_in" ||
    type === "transfer_in" ||
    type === "manual_in" ||
    type === "return" ||
    type === "void" ||
    type === "in"
  ) {
    return "success";
  }
  if (
    type === "sale" ||
    type === "dispatch" ||
    type === "store_pickup" ||
    type === "transfer_out" ||
    type === "manual_out" ||
    type === "out"
  ) {
    return "danger";
  }
  if (type === "inventory_adjustment" || type === "shrinkage" || type === "adjustment") {
    return "warning";
  }
  return "info";
}

function getLocationLabel(
  movement: InventoryMovement,
  fromLocationName?: string,
  toLocationName?: string,
) {
  if (movement.type === InventoryMovementType.transfer) {
    return `${fromLocationName ?? "Origen no disponible"} -> ${
      toLocationName ?? "Destino no disponible"
    }`;
  }
  return toLocationName ?? fromLocationName ?? "-";
}

function getReferenceLabel(
  movement: InventoryMovement,
  resolver: ReturnType<typeof buildReferenceResolver>,
) {
  if (!movement.referenceId) {
    return "-";
  }
  return resolver(movement.referenceType, movement.referenceId);
}

function buildReferenceResolver({
  purchaseOrders,
  receipts,
  dispatches,
  orders,
  sales,
  inventoryAdjustments,
  inventoryTransfers,
}: {
  purchaseOrders: Array<{ id: string; number: string }>;
  receipts: Array<{ id: string; number: string }>;
  dispatches: Array<{ id: string; orderId?: string; trackingNumber?: string }>;
  orders: Array<{ id: string; orderNumber: string }>;
  sales: Array<{ id: string; number: string }>;
  inventoryAdjustments: InventoryAdjustment[];
  inventoryTransfers: InventoryTransferWithItems[];
}) {
  const purchaseOrderById = new Map(purchaseOrders.map((item) => [item.id, item.number]));
  const receiptById = new Map(receipts.map((item) => [item.id, item.number]));
  const orderById = new Map(orders.map((item) => [item.id, item.orderNumber]));
  const dispatchById = new Map(dispatches.map((item) =>
    [item.id, item.orderId ? orderById.get(item.orderId) : undefined]));
  const saleById = new Map(sales.map((item) => [item.id, item.number]));
  const adjustmentById = new Map(inventoryAdjustments.map((item) => [item.id, item.number]));
  const transferById = new Map(
    inventoryTransfers.map((item) => [item.transfer.id, item.transfer.number]),
  );

  return (referenceType: string | undefined, referenceId: string) => {
    if (referenceType === "purchase_order") {
      const number = purchaseOrderById.get(referenceId);
      return number ? `Orden ${number}` : "-";
    }
    if (referenceType === "receipt") {
      const number = receiptById.get(referenceId);
      return number ? `Recepcion ${number}` : "-";
    }
    if (referenceType === "dispatch") {
      const number = dispatchById.get(referenceId);
      return number ?? "-";
    }
    if (referenceType === "order") {
      const number = orderById.get(referenceId);
      return number ? `Orden ${number}` : "-";
    }
    if (referenceType === "sale") {
      const number = saleById.get(referenceId);
      return number ? `Venta ${number}` : "-";
    }
    if (referenceType === "inventoryAdjustment") {
      return adjustmentById.get(referenceId) ?? "-";
    }
    if (referenceType === "transfer") {
      return transferById.get(referenceId) ?? "-";
    }
    if (referenceType === "stock_count") {
      return `Conteo ${referenceId}`;
    }
    return "-";
  };
}

function getAdjustmentDetail(
  adjustment: InventoryAdjustment,
): InventoryMovementRow["adjustmentDetail"] {
  return {
    number: adjustment.number,
    operationLabel: getInventoryAdjustmentTypeLabel(adjustment.type),
    notes: adjustment.notes,
    quantityBefore: adjustment.quantityBefore,
    delta: adjustment.delta,
    quantityAfter: adjustment.quantityAfter,
  };
}

function getInventoryAdjustmentTypeLabel(type: InventoryAdjustmentType) {
  const labels: Record<InventoryAdjustmentType, string> = {
    [InventoryAdjustmentType.manualIncrease]: "Entrada manual",
    [InventoryAdjustmentType.manualDecrease]: "Salida manual",
    [InventoryAdjustmentType.waste]: "Merma",
    [InventoryAdjustmentType.countCorrection]: "Ajuste de inventario",
  };
  return labels[type];
}

function getTransferDetail(
  movement: InventoryMovement,
  transfer: InventoryTransferWithItems,
  branchById: Map<string, { name: string }>,
  productById: Map<string, { id: string; name: string }>,
): InventoryMovementRow["transferDetail"] {
  const item =
    transfer.items.find((entry) => entry.productId === movement.productId) ?? transfer.items[0];
  const product = item ? productById.get(item.productId) : undefined;
  return {
    number: transfer.transfer.number,
    sourceBranchName: branchById.get(transfer.transfer.sourceBranchId)?.name ?? "-",
    destinationBranchName: branchById.get(transfer.transfer.destinationBranchId)?.name ?? "-",
    productName: product?.name ?? "-",
    requestedQuantity: item?.requestedQuantity ?? 0,
    dispatchedQuantity: item?.dispatchedQuantity ?? 0,
    receivedQuantity: item?.receivedQuantity ?? 0,
    directionLabel:
      movement.branchId === transfer.transfer.sourceBranchId
        ? "Despacho desde origen"
        : "Recepcion en destino",
  };
}

function isShrinkageReason(reason: string) {
  const normalized = reason
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return ["merma", "vencimiento", "dano", "rotura", "perdida"].some((term) =>
    normalized.includes(term.normalize("NFD").replace(/[\u0300-\u036f]/g, "")),
  );
}
