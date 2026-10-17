import type {
  Dispatch,
  InventoryTransfer,
  Order,
  Packing,
  PickingOrder,
  StorePickupDelivery,
} from "@/core/entities";
import { DeliveryMethod, InventoryTransferStatus, OrderStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  LogisticsHistoryDetailDto,
  LogisticsHistoryItemDto,
  LogisticsHistoryPageDto,
  LogisticsHistoryQueryDto,
} from "@/modules/logistics/application/dto/LogisticsHistoryDto";
import {
  toLogisticsHistoryDetailDto,
  toLogisticsHistoryItemDto,
  toLogisticsHistoryStatusQuery,
} from "@/modules/logistics/application/mappers/LogisticsHistoryApiMapper";
import { getLogisticsItemTraceForScope } from "@/modules/logistics/application/services/GetLogisticsItemTraceService";
import { resolveTrustedLogisticsHistoryContext } from "@/modules/logistics/application/services/LogisticsHistoryAuthorizationContext";

type HistoryRepositories = Pick<
  RepositoryRegistry,
  | "auth"
  | "users"
  | "roles"
  | "branches"
  | "customers"
  | "orders"
  | "picking"
  | "packings"
  | "dispatches"
  | "storePickupDeliveries"
  | "inventory"
  | "inventoryTransfers"
  | "products"
> &
  Partial<Pick<RepositoryRegistry, "logisticsHistory" | "logisticsHistoryDataSource">>;

const HOME_HISTORY_STATUSES = new Set<OrderStatus>([
  OrderStatus.packing,
  OrderStatus.ready_for_dispatch,
  OrderStatus.dispatched,
  OrderStatus.delivered,
]);
const PICKUP_HISTORY_STATUSES = new Set<OrderStatus>([
  OrderStatus.packing,
  OrderStatus.ready_for_pickup,
  OrderStatus.delivered,
]);

export class GetLogisticsHistoryService {
  constructor(private readonly repositories: HistoryRepositories) {}

  /** En modo API el filtrado y la paginación los resuelve el backend. */
  get usesApi() {
    return this.repositories.logisticsHistoryDataSource === "api";
  }

  async searchApi(
    selectedBranchId: string,
    query: LogisticsHistoryQueryDto & { page: number; pageSize: number },
  ): Promise<LogisticsHistoryPageDto> {
    const context = await resolveTrustedLogisticsHistoryContext(this.repositories, selectedBranchId);
    const result = await this.requireApiRepository().search({
      branchId: context.branchId,
      search: query.search,
      ...toLogisticsHistoryStatusQuery(query.status),
      deliveryMethod: query.deliveryMethod === "all" ? undefined : query.deliveryMethod,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
    });
    return { ...result, items: result.items.map(toLogisticsHistoryItemDto) };
  }

  async getApiDetail(
    selectedBranchId: string,
    item: Pick<LogisticsHistoryItemDto, "sourceType" | "sourceId">,
  ): Promise<LogisticsHistoryDetailDto> {
    const context = await resolveTrustedLogisticsHistoryContext(this.repositories, selectedBranchId);
    return toLogisticsHistoryDetailDto(
      await this.requireApiRepository().getDetail(context.branchId, item.sourceType, item.sourceId),
    );
  }

  private requireApiRepository() {
    if (!this.usesApi || !this.repositories.logisticsHistory) {
      throw new Error("La integración API del historial logístico no está disponible.");
    }
    return this.repositories.logisticsHistory;
  }

  async execute(selectedBranchId: string): Promise<LogisticsHistoryItemDto[]> {
    const context = await resolveTrustedLogisticsHistoryContext(this.repositories, selectedBranchId);
    const [branchOrders, transferResults] = await Promise.all([
      this.repositories.orders.listByBranch(context.tenantId, context.branchId),
      this.repositories.inventoryTransfers.query({
        tenantId: context.tenantId,
        sourceBranchId: context.branchId,
      }),
    ]);
    const orders = branchOrders.filter((order) => isHistoryOrder(order));
    const transfers = transferResults
      .map((item) => item.transfer)
      .filter((transfer) => isHistoryTransfer(transfer));
    const [orderItems, transferItems] = await Promise.all([
      Promise.all(orders.map((order) => this.toHistoryItem(context, order))),
      Promise.all(transfers.map((transfer) => this.toTransferHistoryItem(context, transfer))),
    ]);
    const items = [...orderItems, ...transferItems];
    return items.sort((left, right) => getActivityAt(right).localeCompare(getActivityAt(left)));
  }

  async getDetail(
    selectedBranchId: string,
    historyId: string,
  ): Promise<LogisticsHistoryDetailDto> {
    const context = await resolveTrustedLogisticsHistoryContext(this.repositories, selectedBranchId);
    if (isTransferHistoryId(historyId)) {
      const transferId = historyId.slice(TRANSFER_HISTORY_PREFIX.length);
      const result = await this.repositories.inventoryTransfers.getById(transferId);
      const transfer = result?.transfer;
      if (
        !transfer ||
        transfer.tenantId !== context.tenantId ||
        transfer.sourceBranchId !== context.branchId ||
        !isHistoryTransfer(transfer)
      ) {
        throw new Error("Logistics history transfer not found.");
      }
      return {
        summary: await this.toTransferHistoryItem(context, transfer),
        items: [],
      };
    }
    const order = (await this.repositories.orders.listByBranch(context.tenantId, context.branchId))
      .find((candidate) => candidate.id === historyId && isHistoryOrder(candidate));
    if (!order) throw new Error("Logistics history order not found.");
    const summary = await this.toHistoryItem(context, order);
    const items = summary.pickingOrderId
      ? await getLogisticsItemTraceForScope(this.repositories, context, {
          orderId: summary.orderId,
          pickingOrderId: summary.pickingOrderId,
        })
      : [];
    return { summary, items };
  }

  private async toHistoryItem(
    context: { tenantId: string; branchId: string },
    order: Order,
  ): Promise<LogisticsHistoryItemDto> {
    const scope = { tenantId: context.tenantId, branchId: context.branchId };
    const [picking, packing, dispatch, pickupDelivery] = await Promise.all([
      this.repositories.picking.getByOrder(scope, order.id),
      this.repositories.packings.getByOrder(scope, order.id),
      order.deliveryMethod === DeliveryMethod.home_delivery
        ? this.repositories.dispatches.getByOrder(scope, order.id)
        : Promise.resolve(null),
      order.deliveryMethod === DeliveryMethod.store_pickup
        ? this.repositories.storePickupDeliveries.getByOrder(scope, order.id)
        : Promise.resolve(null),
    ]);
    const candidateResponsibleUserId = getResponsibleUserId(
      picking,
      packing,
      dispatch,
      pickupDelivery,
    );
    const responsibleUser = candidateResponsibleUserId
      ? await this.repositories.users.getById(candidateResponsibleUserId)
      : null;
    const scopedResponsibleUser =
      responsibleUser?.tenantId === context.tenantId ? responsibleUser : null;
    const contact = await this.resolveContact(order, context.tenantId);
    const homeDelivery = order.deliveryMethod === DeliveryMethod.home_delivery;

    return {
      sourceType: "order",
      sourceId: order.id,
      orderId: order.id,
      orderReference: order.orderNumber,
      deliveryMethod: order.deliveryMethod,
      operationalStatus: order.status,
      contactName: contact.name,
      contactPhone: contact.phone,
      pickingOrderId: picking?.id ?? null,
      packingId: packing?.id ?? null,
      dispatchId: dispatch?.id ?? null,
      storePickupDeliveryId: pickupDelivery?.id ?? null,
      pickingCompletedAt: picking?.completedAt ?? null,
      packingFinalizedAt: packing?.finalizedAt ?? null,
      dispatchedAt: dispatch?.dispatchedAt ?? null,
      deliveredAt: homeDelivery
        ? dispatch?.deliveredAt ?? null
        : pickupDelivery?.deliveredAt ?? null,
      responsibleUserId: scopedResponsibleUser?.id ?? null,
      responsibleUserName: scopedResponsibleUser?.name ?? null,
      totalWeight: homeDelivery ? packing?.totalWeight ?? null : null,
      packageCount: homeDelivery ? packing?.packageCount ?? null : null,
      dispatchStatus: dispatch?.status ?? null,
      carrierName: dispatch?.carrierName ?? null,
      trackingNumber: dispatch?.trackingNumber ?? null,
    };
  }

  private async toTransferHistoryItem(
    context: { tenantId: string; branchId: string },
    transfer: InventoryTransfer,
  ): Promise<LogisticsHistoryItemDto> {
    const scope = { tenantId: context.tenantId, branchId: context.branchId };
    const [picking, packing, destination, responsibleUser] = await Promise.all([
      this.repositories.picking.getBySource(scope, "transfer", transfer.id),
      this.repositories.packings.getBySource(scope, "transfer", transfer.id),
      this.repositories.branches.getById(transfer.destinationBranchId),
      transfer.receivedByUserId || transfer.dispatchedByUserId || transfer.preparedByUserId
        ? this.repositories.users.getById(
            transfer.receivedByUserId ??
              transfer.dispatchedByUserId ??
              transfer.preparedByUserId!,
          )
        : Promise.resolve(null),
    ]);
    const destinationName =
      destination?.tenantId === context.tenantId ? destination.name : "Sucursal destino";
    const scopedResponsibleUser =
      responsibleUser?.tenantId === context.tenantId ? responsibleUser : null;

    return {
      sourceType: "transfer",
      sourceId: transfer.id,
      orderId: toTransferHistoryId(transfer.id),
      orderReference: `Traslado ${transfer.number}`,
      deliveryMethod: "transfer",
      operationalStatus:
        transfer.status === InventoryTransferStatus.received
          ? OrderStatus.delivered
          : OrderStatus.dispatched,
      contactName: `Destino: ${destinationName}`,
      contactPhone: null,
      pickingOrderId: picking?.id ?? null,
      packingId: packing?.id ?? null,
      dispatchId: null,
      storePickupDeliveryId: null,
      pickingCompletedAt: picking?.completedAt ?? null,
      packingFinalizedAt: packing?.finalizedAt ?? null,
      dispatchedAt: transfer.dispatchedAt ?? null,
      deliveredAt: transfer.receivedAt ?? null,
      responsibleUserId: scopedResponsibleUser?.id ?? null,
      responsibleUserName: scopedResponsibleUser?.name ?? null,
      totalWeight: packing?.totalWeight ?? null,
      packageCount: packing?.packageCount ?? null,
      dispatchStatus: null,
      carrierName: null,
      trackingNumber: null,
    };
  }

  private async resolveContact(order: Order, tenantId: string) {
    if (order.deliveryMethod === DeliveryMethod.store_pickup && order.storePickupContact) {
      return {
        name: order.storePickupContact.recipientName,
        phone: order.storePickupContact.recipientPhone,
      };
    }
    if (order.deliveryMethod === DeliveryMethod.home_delivery && order.deliveryAddress) {
      return {
        name: order.deliveryAddress.recipientName,
        phone: order.deliveryAddress.recipientPhone ?? null,
      };
    }
    if (order.guestCustomer?.name.trim()) {
      return { name: order.guestCustomer.name.trim(), phone: null };
    }
    if (order.customerId) {
      const customer = await this.repositories.customers.getById(order.customerId);
      if (customer?.tenantId === tenantId) {
        return { name: customer.name.trim() || "Cliente no identificado", phone: customer.phone ?? null };
      }
    }
    return { name: "Cliente no identificado", phone: null };
  }
}

function isHistoryOrder(order: Order): order is Order & {
  deliveryMethod: DeliveryMethod.home_delivery | DeliveryMethod.store_pickup;
} {
  if (order.deliveryMethod === DeliveryMethod.home_delivery) {
    return HOME_HISTORY_STATUSES.has(order.status);
  }
  if (order.deliveryMethod === DeliveryMethod.store_pickup) {
    return PICKUP_HISTORY_STATUSES.has(order.status);
  }
  return false;
}

const TRANSFER_HISTORY_PREFIX = "transfer:";

function isHistoryTransfer(transfer: InventoryTransfer) {
  return (
    transfer.status === InventoryTransferStatus.inTransit ||
    transfer.status === InventoryTransferStatus.received
  );
}

function toTransferHistoryId(transferId: string) {
  return `${TRANSFER_HISTORY_PREFIX}${transferId}`;
}

function isTransferHistoryId(historyId: string) {
  return historyId.startsWith(TRANSFER_HISTORY_PREFIX);
}

function getResponsibleUserId(
  picking: PickingOrder | null,
  packing: Packing | null,
  dispatch: Dispatch | null,
  pickupDelivery: StorePickupDelivery | null,
) {
  return (
    pickupDelivery?.confirmedByUserId ??
    dispatch?.dispatchedByUserId ??
    packing?.finalizedByUserId ??
    packing?.startedByUserId ??
    picking?.assignedUserId ??
    null
  );
}

function getActivityAt(item: LogisticsHistoryItemDto) {
  return (
    item.deliveredAt ??
    item.dispatchedAt ??
    item.packingFinalizedAt ??
    item.pickingCompletedAt ??
    ""
  );
}
