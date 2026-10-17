import type { Notification, Order, Package, PickingOrder } from "@/core/entities";
import { DeliveryMethod, InventoryTransferStatus, OrderStatus, PackingStatus, PickingStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  ConfirmDispatchApiCommand,
  ConfirmTransferDispatchApiCommand,
} from "@/core/repositories";
import type {
  ApiDispatchResultDto,
  ConfirmDispatchCommand,
  ConfirmDispatchResultDto,
  DispatchAddressDto,
  DispatchDetailDto,
  DispatchNotificationContactDto,
  DispatchNotificationDto,
  MarkDispatchDeliveredCommand,
  MarkDispatchDeliveredResultDto,
  PreparedOrderDetailDto,
  PreparedOrderQueueItemDto,
  DispatchQueueItemDto,
  PreparedDispatchDetailDto,
} from "@/modules/logistics/application/dto/DispatchReadModelDto";
import {
  toDispatchQueueItemDto,
  toApiDispatchResultDto,
  toPreparedDispatchDetailDto,
} from "@/modules/logistics/application/mappers/DispatchApiMapper";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { resolveTrustedDispatchContext } from "@/modules/logistics/application/services/DispatchAuthorizationContext";

const DISPATCH_READ = "logistics.dispatch.read";
const DISPATCH_CONFIRM = "logistics.dispatch.confirm";

type DispatchRepositories = Pick<
  RepositoryRegistry,
  "auth" | "users" | "roles" | "branches" | "orders" | "picking" | "packings" | "dispatches" | "notifications" | "inventoryTransfers" | "dispatchRead" | "dispatchCommands" | "dispatchReadDataSource"
>;

export class DispatchApplicationService {
  constructor(private readonly repositories: DispatchRepositories) {}

  async getApiQueue(selectedBranchId: string): Promise<DispatchQueueItemDto[]> {
    const context = await this.context(selectedBranchId, DISPATCH_READ);
    const repository = this.requireApiReadRepository();
    return (await repository.getQueue(context)).map(toDispatchQueueItemDto);
  }

  async getApiPreparedDetail(
    selectedBranchId: string,
    orderId: string,
  ): Promise<PreparedDispatchDetailDto> {
    const context = await this.context(selectedBranchId, DISPATCH_READ);
    return toPreparedDispatchDetailDto(
      await this.requireApiReadRepository().getPreparedDetail(context, orderId),
    );
  }

  async getApiDispatchDetail(selectedBranchId: string, orderId: string): Promise<ApiDispatchResultDto> {
    const context = await this.context(selectedBranchId, DISPATCH_READ);
    return toApiDispatchResultDto(await this.requireApiReadRepository().getDetail(context, orderId));
  }

  async getApiTransferDetail(selectedBranchId: string, transferId: string): Promise<ApiDispatchResultDto> {
    const context = await this.context(selectedBranchId, DISPATCH_READ);
    return toApiDispatchResultDto(
      await this.requireApiReadRepository().getTransferDetail(context, transferId),
    );
  }

  async confirmApiOrder(
    selectedBranchId: string,
    orderId: string,
    command: ConfirmDispatchApiCommand,
  ): Promise<ApiDispatchResultDto> {
    const context = await this.context(selectedBranchId, DISPATCH_CONFIRM);
    const result = await this.requireApiCommandRepository().confirmOrder(context, orderId, command);
    if (!result.idempotent) return toApiDispatchResultDto(result);
    const authoritative = await this.requireApiReadRepository().getDetail(context, orderId);
    return toApiDispatchResultDto({ ...authoritative, idempotent: true });
  }

  async confirmApiTransfer(
    selectedBranchId: string,
    transferId: string,
    command: ConfirmTransferDispatchApiCommand,
  ): Promise<ApiDispatchResultDto> {
    const context = await this.context(selectedBranchId, DISPATCH_CONFIRM);
    const result = await this.requireApiCommandRepository().confirmTransfer(
      context,
      transferId,
      command,
    );
    if (!result.idempotent) return toApiDispatchResultDto(result);
    const authoritative = await this.requireApiReadRepository().getTransferDetail(context, transferId);
    return toApiDispatchResultDto({ ...authoritative, idempotent: true });
  }

  async getTransferQueue(selectedBranchId: string) {
    const context = await this.context(selectedBranchId, DISPATCH_READ);
    const transfers = await this.repositories.inventoryTransfers.query({
      tenantId: context.tenantId, sourceBranchId: context.branchId,
      status: InventoryTransferStatus.preparing,
    });
    const prepared = await Promise.all(transfers.map(async ({ transfer, items }) => {
      const packing = await this.repositories.packings.getBySource(context, "transfer", transfer.id);
      if (!packing || packing.sourceType !== "transfer" ||
        packing.status !== PackingStatus.finalized) return null;
      const destination = await this.repositories.branches.getById(transfer.destinationBranchId);
      if (!destination || destination.tenantId !== context.tenantId) return null;
      return { transferId: transfer.id, reference: transfer.number,
        destinationName: destination.name, sourceBranchId: transfer.sourceBranchId,
        destinationBranchId: transfer.destinationBranchId,
        itemCount: items.length, packageCount: packing.packageCount ?? 0 };
    }));
    return prepared.filter((item): item is NonNullable<typeof item> => item !== null);
  }

  async confirmTransfer(selectedBranchId: string, transferId: string, operationId: string) {
    const context = await this.context(selectedBranchId, DISPATCH_CONFIRM);
    const found = await this.repositories.inventoryTransfers.getById(transferId);
    if (!found || found.transfer.tenantId !== context.tenantId ||
      found.transfer.sourceBranchId !== context.branchId) {
      throw new Error("Traslado no encontrado en la sucursal autorizada.");
    }
    return this.repositories.inventoryTransfers.markInTransit(found.transfer.id, {
      dispatchedByUserId: context.actorUserId, operationId,
      items: found.items.map((item) => ({ itemId: item.id,
        dispatchedQuantity: item.requestedQuantity })),
    });
  }

  async getPreparedQueue(selectedBranchId: string): Promise<PreparedOrderQueueItemDto[]> {
    const context = await this.context(selectedBranchId, DISPATCH_READ);
    const orders = (
      await this.repositories.orders.listByBranch(context.tenantId, context.branchId)
    ).filter(
      (order) =>
        order.tenantId === context.tenantId &&
        order.branchId === context.branchId &&
        order.status === OrderStatus.ready_for_dispatch &&
        order.deliveryMethod === DeliveryMethod.home_delivery,
    );
    return Promise.all(orders.map((order) => this.toPreparedItem(context, order)));
  }

  async getPreparedDetail(
    selectedBranchId: string,
    orderId: string,
  ): Promise<PreparedOrderDetailDto> {
    const context = await this.context(selectedBranchId, DISPATCH_READ);
    const order = await this.requirePreparedOrder(context, orderId);
    return {
      ...(await this.toPreparedItem(context, order)),
      orderStatus: order.status,
      pickingStatus: "completed",
    };
  }

  async getDispatchDetail(selectedBranchId: string, orderId: string): Promise<DispatchDetailDto> {
    const context = await this.context(selectedBranchId, DISPATCH_READ);
    const order = await this.requireScopedOrder(context, orderId);
    if (
      ![OrderStatus.ready_for_dispatch, OrderStatus.dispatched, OrderStatus.delivered].includes(
        order.status,
      )
    ) {
      throw new Error(`Order is not available in dispatch detail: ${order.id}`);
    }
    const picking = await this.requireCompletedPicking(context, order.id);
    await this.requireFinalizedPacking(context, order.id);
    const dispatch = await this.repositories.dispatches.getByOrder(context, order.id);
    const packages = dispatch
      ? await this.repositories.dispatches.getPackagesByDispatch(context, dispatch.id)
      : [];
    const notification = dispatch
      ? await this.repositories.notifications.getByDispatch(context.tenantId, dispatch.id)
      : null;
    return {
      ...toPreparedItem(order, picking),
      orderStatus: order.status,
      pickingStatus: "completed",
      dispatch: dispatch
        ? {
            id: dispatch.id,
            status: dispatch.status,
            carrierName: dispatch.carrierName ?? null,
            trackingNumber: dispatch.trackingNumber ?? null,
            dispatchedAt: dispatch.dispatchedAt ?? null,
            deliveredAt: dispatch.deliveredAt ?? null,
            dispatchedByUserId: dispatch.dispatchedByUserId ?? null,
          }
        : null,
      notification: toNotificationDto(notification),
      packages: packages.map(toPackageDto),
    };
  }

  async confirm(
    selectedBranchId: string,
    command: ConfirmDispatchCommand,
  ): Promise<ConfirmDispatchResultDto> {
    const context = await this.context(selectedBranchId, DISPATCH_CONFIRM);
    const result = await this.repositories.dispatches.confirm({
      tenantId: context.tenantId,
      branchId: context.branchId,
      actorUserId: context.actorUserId,
      orderId: command.orderId,
      operationId: command.operationId,
      carrierName: command.carrierName,
      trackingNumber: command.trackingNumber,
    });
    if (!result.dispatch.dispatchedAt) throw new Error("Confirmed Dispatch has no dispatchedAt");
    return {
      orderId: result.order.id,
      orderStatus: result.order.status,
      dispatchId: result.dispatch.id,
      dispatchStatus: result.dispatch.status,
      transportMode: result.dispatch.transportMode,
      carrierName: result.dispatch.carrierName ?? null,
      trackingNumber: result.dispatch.trackingNumber ?? null,
      dispatchedAt: result.dispatch.dispatchedAt,
      notificationStatus: result.notificationStatus,
      notification: toNotificationDto(result.notification ?? null),
      packages: result.packages.map(toPackageDto),
      idempotent: result.idempotent,
    };
  }

  async markDelivered(
    selectedBranchId: string,
    command: MarkDispatchDeliveredCommand,
  ): Promise<MarkDispatchDeliveredResultDto> {
    const runtimeCommand = command as MarkDispatchDeliveredCommand & Record<string, unknown>;
    if (
      Object.prototype.hasOwnProperty.call(runtimeCommand, "carrierName") ||
      Object.prototype.hasOwnProperty.call(runtimeCommand, "trackingNumber") ||
      Object.prototype.hasOwnProperty.call(runtimeCommand, "transportMode")
    ) {
      throw new Error("Delivery confirmation cannot modify dispatch shipment data");
    }
    const context = await this.context(selectedBranchId, DISPATCH_CONFIRM);
    const result = await this.repositories.dispatches.markDelivered({
      tenantId: context.tenantId,
      branchId: context.branchId,
      actorUserId: context.actorUserId,
      orderId: command.orderId,
    });
    if (!result.dispatch.deliveredAt) {
      throw new Error("Delivered Dispatch has no deliveredAt");
    }
    return {
      orderId: result.order.id,
      orderStatus: result.order.status,
      dispatchId: result.dispatch.id,
      dispatchStatus: result.dispatch.status,
      deliveredAt: result.dispatch.deliveredAt,
      idempotent: result.idempotent,
    };
  }

  private async context(selectedBranchId: string, permission: string) {
    // Dispatch only completes an existing, scoped Order. A cancelled add-on must not strand
    // an already committed delivery; session, role, branch, resource and state still apply.
    return resolveTrustedDispatchContext(this.repositories, selectedBranchId, permission);
  }

  private requireApiReadRepository() {
    if (this.repositories.dispatchReadDataSource === "api" && this.repositories.dispatchRead) {
      return this.repositories.dispatchRead;
    }
    throw new BackendRequestError(
      "El repositorio API de lectura de Dispatch no esta configurado.",
      500,
      "DISPATCH_API_NOT_CONFIGURED",
    );
  }

  private requireApiCommandRepository() {
    if (this.repositories.dispatchReadDataSource === "api" && this.repositories.dispatchCommands) {
      return this.repositories.dispatchCommands;
    }
    throw new BackendRequestError(
      "El repositorio API de comandos de Dispatch no esta configurado.",
      500,
      "DISPATCH_API_NOT_CONFIGURED",
    );
  }

  private async requireScopedOrder(
    context: { tenantId: string; branchId: string },
    orderId: string,
  ): Promise<Order> {
    const order = await this.repositories.orders.getById(orderId);
    if (!order || order.tenantId !== context.tenantId || order.branchId !== context.branchId) {
      throw new Error(`Order not found in authorized dispatch scope: ${orderId}`);
    }
    return order;
  }

  private async requirePreparedOrder(
    context: { tenantId: string; branchId: string },
    orderId: string,
  ): Promise<Order> {
    const order = await this.requireScopedOrder(context, orderId);
    if (
      order.status !== OrderStatus.ready_for_dispatch ||
      order.deliveryMethod !== DeliveryMethod.home_delivery
    ) {
      throw new Error(`Order is not prepared for dispatch: ${order.id}`);
    }
    return order;
  }

  private async requireCompletedPicking(
    context: { tenantId: string; branchId: string },
    orderId: string,
  ): Promise<PickingOrder> {
    const picking = await this.repositories.picking.getByOrder(context, orderId);
    if (!picking || picking.status !== PickingStatus.completed || !picking.completedAt) {
      throw new Error(`Picking is not completed for Order: ${orderId}`);
    }
    return picking;
  }

  private async toPreparedItem(
    context: { tenantId: string; branchId: string },
    order: Order,
  ): Promise<PreparedOrderQueueItemDto> {
    await this.requireFinalizedPacking(context, order.id);
    const picking = await this.requireCompletedPicking(context, order.id);
    return toPreparedItem(order, picking);
  }

  private async requireFinalizedPacking(
    context: { tenantId: string; branchId: string },
    orderId: string,
  ) {
    const packing = await this.repositories.packings.getByOrder(context, orderId);
    if (!packing || packing.status !== PackingStatus.finalized || !packing.finalizedAt) {
      throw new Error(`Packing is not finalized for Order: ${orderId}`);
    }
    return packing;
  }
}

function toPreparedItem(order: Order, picking: PickingOrder): PreparedOrderQueueItemDto {
  if (!picking.completedAt)
    throw new Error(`Picking completion timestamp is missing: ${picking.id}`);
  return {
    orderId: order.id,
    orderReference: order.orderNumber,
    createdAt: order.createdAt,
    recipientName: order.deliveryAddress?.recipientName ?? order.guestCustomer?.name ?? "",
    recipientPhone: order.deliveryAddress?.recipientPhone ?? null,
    address: toAddressDto(order),
    transportMode: order.transportMode,
    notificationContact: toNotificationContactDto(order),
    pickingOrderId: picking.id,
    pickingCompletedAt: picking.completedAt,
  };
}

function toAddressDto(order: Order): DispatchAddressDto | null {
  const address = order.deliveryAddress;
  if (!address) return null;
  return {
    recipientName: address.recipientName,
    recipientPhone: address.recipientPhone ?? null,
    line1: address.line1,
    line2: address.line2 ?? null,
    city: address.city,
    stateOrDepartment: address.stateOrDepartment ?? null,
    postalCode: address.postalCode ?? null,
    country: address.country,
    references: address.references ?? null,
  };
}

function toNotificationContactDto(order: Order): DispatchNotificationContactDto {
  return order.notificationContact ?? { emailMode: "legacy_unknown" };
}

function toNotificationDto(notification: Notification | null): DispatchNotificationDto | null {
  if (
    !notification ||
    notification.deliveryStatus !== "simulated_sent" ||
    !notification.recipientEmail ||
    !notification.sentAt
  ) {
    return null;
  }
  return {
    id: notification.id,
    recipientEmail: notification.recipientEmail,
    deliveryStatus: notification.deliveryStatus,
    sentAt: notification.sentAt,
  };
}

function toPackageDto(item: Package) {
  return {
    id: item.id,
    number: item.number,
    weight: item.weight ?? null,
    description: item.description ?? null,
  };
}
