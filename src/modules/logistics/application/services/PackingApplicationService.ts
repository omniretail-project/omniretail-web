import type { InventoryTransfer, Order, Packing } from "@/core/entities";
import { DeliveryMethod, OrderStatus, PackingStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type {
  ConfirmStorePickupDeliveryCommand,
  ConfirmStorePickupDeliveryResultDto,
  FinalizePackingCommand,
  FinalizePackingResultDto,
  GeneratePackingLabelCommand,
  PackingActionResultDto,
  PackingDetailDto,
  PackingQueueItemDto,
  RegisterPackingLabelPrintCommand,
  SavePackingPreparationCommand,
} from "@/modules/logistics/application/dto/PackingReadModelDto";
import {
  toPackingDetailDto,
  toPackingQueueItemDto,
} from "@/modules/logistics/application/mappers/PackingApiMapper";
import { resolveTrustedPackingContext } from "@/modules/logistics/application/services/PackingAuthorizationContext";

const PACKING_READ = "logistics.packing.read";
const PACKING_PREPARE = "logistics.packing.prepare";
const PACKING_FINALIZE = "logistics.packing.finalize";

type PackingRepositories = Pick<
  RepositoryRegistry,
  | "auth"
  | "users"
  | "roles"
  | "branches"
  | "customers"
  | "orders"
  | "packings"
  | "packingRead"
  | "packingCommands"
  | "packingDataSource"
  | "picking"
  | "products"
  | "storePickupDeliveries"
  | "inventoryTransfers"
>;

export class PackingApplicationService {
  constructor(private readonly repositories: PackingRepositories) {}

  async getQueue(selectedBranchId: string): Promise<PackingQueueItemDto[]> {
    const context = await this.context(selectedBranchId, PACKING_READ);
    this.ensureApiRepository(this.repositories.packingRead, "lectura");
    if (this.repositories.packingRead) {
      const queue = await this.repositories.packingRead.getQueue(context);
      return queue.map(toPackingQueueItemDto);
    }
    const [activePackings, branchOrders] = await Promise.all([
      this.repositories.packings.getQueue(context),
      this.repositories.orders.listByBranch(context.tenantId, context.branchId),
    ]);
    const readyPickupPackings = await Promise.all(
      branchOrders
        .filter((order) =>
          order.deliveryMethod === DeliveryMethod.store_pickup &&
          order.status === OrderStatus.ready_for_pickup,
        )
        .map((order) => this.repositories.packings.getByOrder(context, order.id)),
    );
    const packings = [...new Map(
      [...activePackings, ...readyPickupPackings.filter((item): item is Packing => item !== null)]
        .map((packing) => [packing.id, packing]),
    ).values()];
    const orders = await this.repositories.orders.getByIdsScoped(
      context.tenantId,
      context.branchId,
      packings.filter((item) => item.sourceType !== "transfer")
        .map((item) => item.orderId).filter((id): id is string => Boolean(id)),
    );
    const ordersById = new Map(orders.map((order) => [order.id, order]));
    return Promise.all(
      packings.map(async (packing) => {
        if (packing.sourceType === "transfer") {
          const transfer = await this.requireTransfer(context, packing);
          if (transfer.transfer.status === "cancelled") return null;
          return this.toTransferQueueItem(packing, transfer.transfer);
        }
        const order = packing.orderId ? ordersById.get(packing.orderId) : undefined;
        if (!order) throw new Error(`Order not found for authorized Packing: ${packing.id}`);
        return this.toQueueItem(packing, order);
      }),
    ).then((items) => items.filter((item): item is PackingQueueItemDto => item !== null));
  }

  async getDetail(selectedBranchId: string, packingId: string): Promise<PackingDetailDto> {
    const context = await this.context(selectedBranchId, PACKING_READ);
    this.ensureApiRepository(this.repositories.packingRead, "lectura");
    if (this.repositories.packingRead) {
      return toPackingDetailDto(
        await this.repositories.packingRead.getDetail(context, packingId),
      );
    }
    const candidate = await this.repositories.packings.getById(context, packingId);
    if (candidate?.sourceType === "transfer") {
      const transfer = await this.requireTransfer(context, candidate);
      if (transfer.transfer.status === "cancelled") {
        throw new Error(`Transfer Packing was cancelled: ${candidate.id}`);
      }
      return this.toTransferDetail(context, candidate, transfer.transfer);
    }
    const { packing, order } = await this.requireDetail(context, packingId);
    return this.toDetail(context, packing, order);
  }

  async savePreparation(
    selectedBranchId: string,
    command: SavePackingPreparationCommand,
  ): Promise<PackingActionResultDto> {
    const context = await this.context(selectedBranchId, PACKING_PREPARE);
    this.ensureApiRepository(this.repositories.packingCommands, "comandos");
    if (this.repositories.packingCommands) {
      const result = await this.repositories.packingCommands.savePreparation(
        context,
        command.packingId,
        command,
      );
      return { packing: toPackingDetailDto(result.packing), idempotent: result.idempotent };
    }
    const result = await this.repositories.packings.savePreparation({ ...command, ...context });
    return this.toActionResult(context, result.packing, result.idempotent);
  }

  async generateLabel(
    selectedBranchId: string,
    command: GeneratePackingLabelCommand,
  ): Promise<PackingActionResultDto> {
    const context = await this.context(selectedBranchId, PACKING_PREPARE);
    this.ensureApiRepository(this.repositories.packingCommands, "comandos");
    if (this.repositories.packingCommands) {
      const result = await this.repositories.packingCommands.generateLabel(
        context,
        command.packingId,
        command,
      );
      return { packing: toPackingDetailDto(result.packing), idempotent: result.idempotent };
    }
    const result = await this.repositories.packings.generateLabel({ ...command, ...context });
    return this.toActionResult(context, result.packing, result.idempotent);
  }

  async registerLabelPrint(
    selectedBranchId: string,
    command: RegisterPackingLabelPrintCommand,
  ): Promise<PackingActionResultDto> {
    const context = await this.context(selectedBranchId, PACKING_PREPARE);
    this.ensureApiRepository(this.repositories.packingCommands, "comandos");
    if (this.repositories.packingCommands) {
      const result = await this.repositories.packingCommands.registerLabelPrint(
        context,
        command.packingId,
        command,
      );
      return { packing: toPackingDetailDto(result.packing), idempotent: result.idempotent };
    }
    const result = await this.repositories.packings.registerLabelPrint({ ...command, ...context });
    return this.toActionResult(context, result.packing, result.idempotent);
  }

  async finalize(
    selectedBranchId: string,
    command: FinalizePackingCommand,
  ): Promise<FinalizePackingResultDto> {
    const context = await this.context(selectedBranchId, PACKING_FINALIZE);
    this.ensureApiRepository(this.repositories.packingCommands, "comandos");
    if (this.repositories.packingCommands) {
      const result = await this.repositories.packingCommands.finalize(
        context,
        command.packingId,
        command,
      );
      return {
        packing: toPackingDetailDto(result.packing),
        idempotent: result.idempotent,
        orderStatus: result.orderStatus,
        ...(result.transferStatus ? { transferStatus: result.transferStatus } : {}),
      };
    }
    const packing = await this.repositories.packings.getById(context, command.packingId);
    if (packing?.sourceType === "transfer") {
      const result = await this.repositories.packings.finalize({
        ...command, ...context, sourceType: "transfer",
      });
      return { ...(await this.toActionResult(context, result.packing, result.idempotent)),
        orderStatus: null, transferStatus: result.transfer.status };
    }
    const result = await this.repositories.packings.finalize({ ...command, ...context });
    return {
      ...(await this.toActionResult(context, result.packing, result.idempotent)),
      orderStatus: result.order.status,
    };
  }

  async confirmStorePickupDelivery(
    selectedBranchId: string,
    command: ConfirmStorePickupDeliveryCommand,
  ): Promise<ConfirmStorePickupDeliveryResultDto> {
    if (this.repositories.packingDataSource === "api") {
      throw new BackendRequestError(
        "La entrega al cliente se integrara en el incremento de Despachos.",
        409,
        "STORE_PICKUP_HANDOVER_NOT_AVAILABLE",
      );
    }
    const context = await this.context(selectedBranchId, PACKING_FINALIZE);
    const { packing, order } = await this.requireDetail(context, command.packingId);
    if (
      packing.status !== PackingStatus.finalized ||
      order.deliveryMethod !== DeliveryMethod.store_pickup ||
      (order.status !== OrderStatus.ready_for_pickup && order.status !== OrderStatus.delivered)
    ) {
      throw new Error(`Store pickup Order is not ready for delivery: ${order.id}`);
    }
    const result = await this.repositories.storePickupDeliveries.confirm({
      ...context,
      orderId: order.id,
      operationId: command.operationId,
    });
    return {
      packingId: packing.id,
      orderId: result.order.id,
      orderStatus: result.order.status,
      deliveredAt: result.delivery.deliveredAt,
      idempotent: result.idempotent,
    };
  }

  private context(selectedBranchId: string, permission: string) {
    return resolveTrustedPackingContext(this.repositories, selectedBranchId, permission);
  }

  private ensureApiRepository(repository: unknown, capability: string): void {
    if (this.repositories.packingDataSource !== "api" || repository) return;
    throw new BackendRequestError(
      `El repositorio API de ${capability} de Packing no esta configurado.`,
      500,
      "PACKING_API_NOT_CONFIGURED",
    );
  }

  private async requireDetail(
    context: { tenantId: string; branchId: string },
    packingId: string,
  ): Promise<{ packing: Packing; order: Order }> {
    const packing = await this.repositories.packings.getById(context, packingId);
    if (!packing) throw new Error(`Packing not found in authorized scope: ${packingId}`);
    const [order] = await this.repositories.orders.getByIdsScoped(
      context.tenantId,
      context.branchId,
      packing.orderId ? [packing.orderId] : [],
    );
    if (!order) throw new Error(`Order not found for authorized Packing: ${packing.id}`);
    return { packing, order };
  }

  private async toActionResult(
    context: { tenantId: string; branchId: string },
    packing: Packing,
    idempotent: boolean,
  ): Promise<PackingActionResultDto> {
    if (packing.sourceType === "transfer") {
      const transfer = await this.requireTransfer(context, packing);
      return {
        packing: await this.toTransferDetail(context, packing, transfer.transfer),
        idempotent,
      };
    }
    const { order } = await this.requireDetail(context, packing.id);
    return { packing: await this.toDetail(context, packing, order), idempotent };
  }

  private async requireTransfer(
    context: { tenantId: string; branchId: string }, packing: Packing,
  ) {
    const transfer = await this.repositories.inventoryTransfers.getById(packing.sourceId!);
    if (!transfer || transfer.transfer.tenantId !== context.tenantId ||
      transfer.transfer.sourceBranchId !== context.branchId ||
      packing.orderId !== undefined) {
      throw new Error(`Transfer not found for authorized Packing: ${packing.id}`);
    }
    return transfer;
  }

  private async toTransferQueueItem(packing: Packing, transfer: InventoryTransfer): Promise<PackingQueueItemDto> {
    const destination = await this.repositories.branches.getById(transfer.destinationBranchId);
    return {
      packingId: packing.id, orderReference: transfer.number,
      customerName: destination?.tenantId === transfer.tenantId
        ? destination.name : "Sucursal destino", storePickupContact: null,
      deliveryMethod: "transfer", sourceType: "transfer", sourceId: transfer.id,
      status: packing.status, version: packing.version,
      startedAt: packing.startedAt, updatedAt: packing.updatedAt,
    };
  }

  private async toTransferDetail(
    context: { tenantId: string; branchId: string },
    packing: Packing,
    transfer: InventoryTransfer,
  ): Promise<PackingDetailDto> {
    return {
      ...(await this.toTransferQueueItem(packing, transfer)), pickingOrderId: packing.pickingOrderId,
      orderStatus: null, deliveryAddress: null, checklist: { ...packing.checklist },
      totalWeight: packing.totalWeight ?? null, packageCount: packing.packageCount ?? null,
      labelGenerationId: packing.labelGenerationId ?? null,
      labelCode: packing.labelCode ?? null, labelGeneratedAt: packing.labelGeneratedAt ?? null,
      labelPrintedAt: packing.labelPrintedAt ?? null, finalizedAt: packing.finalizedAt ?? null,
      preparedContents: await this.resolvePreparedContents(context, packing.pickingOrderId),
    };
  }

  private async toQueueItem(packing: Packing, order: Order): Promise<PackingQueueItemDto> {
    if (
      order.deliveryMethod !== DeliveryMethod.home_delivery &&
      order.deliveryMethod !== DeliveryMethod.store_pickup
    ) {
      throw new Error(`Order delivery method cannot enter Packing: ${order.deliveryMethod}`);
    }
    if (
      (packing.status === PackingStatus.in_progress && order.status !== OrderStatus.packing) ||
      (packing.status === PackingStatus.finalized &&
        order.status !== OrderStatus.ready_for_dispatch &&
        order.status !== OrderStatus.ready_for_pickup &&
        order.status !== OrderStatus.dispatched &&
        order.status !== OrderStatus.delivered)
    ) {
      throw new Error(`Packing and Order state conflict: ${packing.id}`);
    }
    return {
      packingId: packing.id,
      orderId: order.id,
      orderReference: order.orderNumber,
      customerName: await this.resolveCustomerName(order),
      storePickupContact:
        order.deliveryMethod === DeliveryMethod.store_pickup && order.storePickupContact
          ? { ...order.storePickupContact }
          : null,
      deliveryMethod: order.deliveryMethod,
      status: packing.status,
      version: packing.version,
      startedAt: packing.startedAt,
      updatedAt: packing.updatedAt,
    };
  }

  private async toDetail(
    context: { tenantId: string; branchId: string },
    packing: Packing,
    order: Order,
  ): Promise<PackingDetailDto> {
    return {
      ...(await this.toQueueItem(packing, order)),
      pickingOrderId: packing.pickingOrderId,
      orderStatus: order.status,
      deliveryAddress: order.deliveryAddress ? { ...order.deliveryAddress } : null,
      checklist: { ...packing.checklist },
      totalWeight: packing.totalWeight ?? null,
      packageCount: packing.packageCount ?? null,
      labelGenerationId: packing.labelGenerationId ?? null,
      labelCode: packing.labelCode ?? null,
      labelGeneratedAt: packing.labelGeneratedAt ?? null,
      labelPrintedAt: packing.labelPrintedAt ?? null,
      finalizedAt: packing.finalizedAt ?? null,
      preparedContents: await this.resolvePreparedContents(context, packing.pickingOrderId),
    };
  }

  private async resolvePreparedContents(
    context: { tenantId: string; branchId: string },
    pickingOrderId: string,
  ) {
    const [items, products] = await Promise.all([
      this.repositories.picking.getItems(context, pickingOrderId),
      this.repositories.products.getByTenant(context.tenantId),
    ]);
    const productById = new Map(products.map((product) => [product.id, product]));
    return items
      .filter((item) => item.pickedQuantity > 0)
      .map((item) => {
        const product = productById.get(item.productId);
        return {
          productId: item.productId,
          sku: product?.sku ?? item.productId,
          name: product?.name ?? "Producto no disponible",
          quantity: item.pickedQuantity,
          serialNumbers: [...(item.serialNumbers ?? [])],
          trackingSelections: [],
        };
      });
  }

  private async resolveCustomerName(order: Order): Promise<string> {
    if (order.deliveryMethod === DeliveryMethod.store_pickup && order.storePickupContact) {
      return order.storePickupContact.recipientName.trim();
    }
    if (order.guestCustomer?.name.trim()) return order.guestCustomer.name.trim();
    if (!order.customerId)
      return order.deliveryAddress?.recipientName.trim() || "Cliente no identificado";
    const customer = await this.repositories.customers.getById(order.customerId);
    return customer && customer.tenantId === order.tenantId
      ? customer.name
      : order.deliveryAddress?.recipientName.trim() || "Cliente no identificado";
  }
}
