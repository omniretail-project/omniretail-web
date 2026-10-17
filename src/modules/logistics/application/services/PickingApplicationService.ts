import { DeliveryMethod, type PickingIncidentType, type PickingItemStatus } from "@/core/enums";
import type { Order } from "@/core/entities";
import type {
  PickingCommandActionResult,
  PickingTrackingSelectionCommand,
  UpdatePickingItemInput,
} from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type {
  PickingActionResultDto,
  PickingDetailDto,
  PickingDetailLineDto,
  PickingIncidentDto,
  PickingProgressDto,
  PickingQueueItemDto,
  PickingReleaseDto,
} from "@/modules/logistics/application/dto/PickingReadModelDto";
import {
  toPickingDetailDto,
  toPickingQueueItemDto,
} from "@/modules/logistics/application/mappers/PickingApiMapper";
import { resolveTrustedPickingContext } from "@/modules/logistics/application/services/PickingAuthorizationContext";

const PICKING_READ = "logistics.picking.read";
const PICKING_START = "logistics.picking.start";
const PICKING_COMPLETE = "logistics.picking.complete";

type PickingRepositories = Pick<
  RepositoryRegistry,
  | "auth"
  | "users"
  | "roles"
  | "branches"
  | "customers"
  | "picking"
  | "pickingRead"
  | "pickingCommands"
  | "pickingCommandsEnabled"
  | "orders"
  | "products"
  | "inventory"
  | "inventoryTransfers"
>;

export type PickingLineUpdateCommand = {
  pickingOrderId: string;
  pickingLineId: string;
  locationId?: string;
  lotId?: string;
  serialNumbers?: string[];
  status?: PickingItemStatus;
  trackingSelections?: PickingTrackingSelectionCommand[];
} & (
  | { pickedQuantity: number; operationId: string }
  | { pickedQuantity?: undefined; operationId?: never }
);

export interface RegisterPickingIncidentCommand {
  pickingOrderId: string;
  pickingLineId?: string;
  type: PickingIncidentType;
  quantityAffected?: number;
  comment: string;
}

export class PickingApplicationService {
  constructor(private readonly repositories: PickingRepositories) {}

  async getQueue(selectedBranchId: string): Promise<PickingQueueItemDto[]> {
    const context = await this.context(selectedBranchId, PICKING_READ);
    const scope = { tenantId: context.tenantId, branchId: context.branchId };
    if (this.repositories.pickingRead) {
      const queue = await this.repositories.pickingRead.getQueue(scope);
      return queue.map(toPickingQueueItemDto);
    }
    const pickingOrders = await this.repositories.picking.getQueue(scope);
    return Promise.all(
      pickingOrders.map(async (pickingOrder) => {
        if (pickingOrder.sourceType === "transfer") {
          const transfer = await this.repositories.inventoryTransfers.getById(
            pickingOrder.sourceId!,
          );
          if (
            !transfer ||
            transfer.transfer.tenantId !== context.tenantId ||
            transfer.transfer.sourceBranchId !== context.branchId
          ) {
            throw new Error(`Transfer context conflict for PickingOrder: ${pickingOrder.id}`);
          }
          const [lines, destination] = await Promise.all([
            this.repositories.picking.getItems(scope, pickingOrder.id),
            this.repositories.branches.getById(transfer.transfer.destinationBranchId),
          ]);
          return {
            pickingOrderId: pickingOrder.id,
            orderReference: transfer.transfer.number,
            customerName:
              destination?.tenantId === context.tenantId ? destination.name : "Sucursal destino",
            storePickupContact: null,
            deliveryMethod: "transfer" as const,
            sourceType: "transfer" as const,
            sourceId: transfer.transfer.id,
            branchId: pickingOrder.branchId,
            status: pickingOrder.status,
            priority: pickingOrder.priority,
            assignedUserId: pickingOrder.assignedUserId ?? null,
            progress: getProgress(lines),
            startedAt: pickingOrder.startedAt ?? null,
            createdAt: pickingOrder.createdAt,
            updatedAt: pickingOrder.updatedAt,
          };
        }
        const [order, lines] = await Promise.all([
          pickingOrder.orderId
            ? this.repositories.orders.getById(pickingOrder.orderId)
            : Promise.resolve(null),
          this.repositories.picking.getItems(scope, pickingOrder.id),
        ]);
        if (!order || order.tenantId !== context.tenantId || order.branchId !== context.branchId) {
          throw new Error(`Order context conflict for PickingOrder: ${pickingOrder.id}`);
        }
        const customerName = await this.resolveCustomerName(order, context.tenantId);
        return {
          pickingOrderId: pickingOrder.id,
          orderId: order.id,
          orderReference: order.orderNumber,
          customerName,
          storePickupContact: getStorePickupContact(order),
          deliveryMethod: order.deliveryMethod,
          branchId: pickingOrder.branchId,
          status: pickingOrder.status,
          priority: pickingOrder.priority,
          assignedUserId: pickingOrder.assignedUserId ?? null,
          progress: getProgress(lines),
          startedAt: pickingOrder.startedAt ?? null,
          createdAt: pickingOrder.createdAt,
          updatedAt: pickingOrder.updatedAt,
        };
      }),
    );
  }

  async getDetail(selectedBranchId: string, pickingOrderId: string): Promise<PickingDetailDto> {
    const context = await this.context(selectedBranchId, PICKING_READ);
    if (this.repositories.pickingRead) {
      return toPickingDetailDto(
        await this.repositories.pickingRead.getDetail(context, pickingOrderId),
      );
    }
    return this.buildDetail(context, pickingOrderId);
  }

  async assign(selectedBranchId: string, pickingOrderId: string): Promise<PickingActionResultDto> {
    this.ensureCommandsAvailable();
    const context = await this.context(selectedBranchId, PICKING_START);
    if (this.repositories.pickingCommands) {
      return toApiActionResult(
        await this.repositories.pickingCommands.assign(context, pickingOrderId),
      );
    }
    const result = await this.repositories.picking.assign({
      ...context,
      pickingOrderId,
      actorUserId: context.actorUserId,
    });
    return toActionResult(result.pickingOrder, result.idempotent);
  }

  async release(
    selectedBranchId: string,
    pickingOrderId: string,
    reason: string,
  ): Promise<PickingReleaseDto> {
    this.ensureCommandsAvailable();
    const context = await this.context(selectedBranchId, PICKING_START);
    if (this.repositories.pickingCommands) {
      return toReleaseDto(
        await this.repositories.pickingCommands.release(context, pickingOrderId, reason),
      );
    }
    const result = await this.repositories.picking.release({
      ...context,
      pickingOrderId,
      actorUserId: context.actorUserId,
      reason,
    });
    return toReleaseDto(result.release);
  }

  async getReleaseHistory(
    selectedBranchId: string,
    pickingOrderId: string,
  ): Promise<PickingReleaseDto[]> {
    const context = await this.context(selectedBranchId, PICKING_READ);
    if (this.repositories.pickingRead) {
      return toPickingDetailDto(
        await this.repositories.pickingRead.getDetail(context, pickingOrderId),
      ).releases;
    }
    const releases = await this.repositories.picking.getReleaseHistory(context, pickingOrderId);
    return releases.map(toReleaseDto);
  }

  async registerIncident(
    selectedBranchId: string,
    command: RegisterPickingIncidentCommand,
  ): Promise<PickingIncidentDto> {
    this.ensureCommandsAvailable();
    const context = await this.context(selectedBranchId, PICKING_START);
    if (this.repositories.pickingCommands) {
      return toIncidentDto(
        await this.repositories.pickingCommands.createIncident(context, command.pickingOrderId, {
          ...(command.pickingLineId ? { pickingLineId: command.pickingLineId } : {}),
          type: command.type,
          ...(command.quantityAffected !== undefined
            ? { quantityAffected: command.quantityAffected }
            : {}),
          comment: command.comment,
        }),
      );
    }
    const incident = await this.repositories.picking.registerIncident({
      ...command,
      tenantId: context.tenantId,
      branchId: context.branchId,
      createdBy: context.actorUserId,
    });
    return toIncidentDto(incident);
  }

  async getIncidents(
    selectedBranchId: string,
    pickingOrderId: string,
  ): Promise<PickingIncidentDto[]> {
    const context = await this.context(selectedBranchId, PICKING_READ);
    if (this.repositories.pickingRead) {
      return toPickingDetailDto(
        await this.repositories.pickingRead.getDetail(context, pickingOrderId),
      ).incidents;
    }
    const incidents = await this.repositories.picking.getIncidents(context, pickingOrderId);
    return incidents.map(toIncidentDto);
  }

  async resolveIncident(
    selectedBranchId: string,
    pickingOrderId: string,
    incidentId: string,
  ): Promise<PickingIncidentDto> {
    this.ensureCommandsAvailable();
    const context = await this.context(selectedBranchId, PICKING_START);
    if (this.repositories.pickingCommands) {
      return toIncidentDto(
        await this.repositories.pickingCommands.resolveIncident(
          context,
          pickingOrderId,
          incidentId,
        ),
      );
    }
    const incident = await this.repositories.picking.resolveIncident({
      ...context,
      pickingOrderId,
      incidentId,
      resolvedBy: context.actorUserId,
    });
    return toIncidentDto(incident);
  }

  async getInventoryAvailability(
    selectedBranchId: string,
    pickingOrderId: string,
    productId: string,
  ) {
    const context = await this.context(selectedBranchId, PICKING_READ);
    if (this.repositories.pickingRead) {
      const detail = toPickingDetailDto(
        await this.repositories.pickingRead.getDetail(context, pickingOrderId),
      );
      const line = detail.lines.find((item) => item.productId === productId);
      if (!line) {
        throw new BackendRequestError(
          "El producto no pertenece al Picking solicitado.",
          404,
          "PICKING_LINE_NOT_FOUND",
        );
      }
      return line.inventory;
    }
    const pickingOrder = await this.requirePickingOrder(context, pickingOrderId);
    return this.repositories.inventory.getPickingAvailability({
      ...context,
      pickingOrderId,
      orderId: pickingOrder.orderId,
      sourceType: pickingOrder.sourceType,
      sourceId: pickingOrder.sourceId,
      productId,
    });
  }

  async updateLine(selectedBranchId: string, command: PickingLineUpdateCommand) {
    this.ensureCommandsAvailable();
    const context = await this.context(selectedBranchId, PICKING_START);
    if (this.repositories.pickingCommands) {
      if (command.pickedQuantity === undefined || !command.operationId) {
        throw new BackendRequestError(
          "El backend requiere cantidad y operationId para actualizar la línea.",
          400,
          "INVALID_PICKING_UPDATE",
        );
      }
      await this.repositories.pickingCommands.updateItem(
        context,
        command.pickingOrderId,
        command.pickingLineId,
        {
          pickedQuantity: command.pickedQuantity,
          locationId: command.locationId ?? null,
          operationId: command.operationId,
          trackingSelections: command.trackingSelections ?? [],
        },
      );
      return this.getDetail(selectedBranchId, command.pickingOrderId);
    }
    await this.requirePickingOrder(context, command.pickingOrderId);
    const input: UpdatePickingItemInput = {
      ...command,
      tenantId: context.tenantId,
      branchId: context.branchId,
      pickingItemId: command.pickingLineId,
      performedByUserId: context.actorUserId,
    };
    await this.repositories.picking.updateItem(input);
    return this.buildDetail(context, command.pickingOrderId);
  }

  async complete(selectedBranchId: string, pickingOrderId: string) {
    this.ensureCommandsAvailable();
    const context = await this.context(selectedBranchId, PICKING_COMPLETE);
    if (this.repositories.pickingCommands) {
      const result = await this.repositories.pickingCommands.complete(context, pickingOrderId);
      return {
        ...toApiActionResult(result),
        orderStatus: result.orderStatus,
      };
    }
    const pickingOrder = await this.requirePickingOrder(context, pickingOrderId);
    if (pickingOrder.sourceType === "transfer") {
      const result = await this.repositories.picking.complete({
        ...context,
        pickingOrderId,
        actorUserId: context.actorUserId,
        sourceType: "transfer",
      });
      return {
        ...toActionResult(result.pickingOrder, result.idempotent),
        orderStatus: null,
        transferStatus: result.transfer.status,
      };
    }
    const result = await this.repositories.picking.complete({
      ...context,
      pickingOrderId,
      actorUserId: context.actorUserId,
    });
    return {
      ...toActionResult(result.pickingOrder, result.idempotent),
      orderStatus: result.order.status,
    };
  }

  private context(selectedBranchId: string, permission: string) {
    return resolveTrustedPickingContext(this.repositories, selectedBranchId, permission);
  }

  private ensureCommandsAvailable() {
    if (this.repositories.pickingCommandsEnabled !== false) return;
    throw new BackendRequestError(
      "Picking se encuentra en modo de solo lectura mientras sus comandos se integran con el backend.",
      409,
      "PICKING_COMMANDS_NOT_AVAILABLE",
    );
  }

  private async requirePickingOrder(
    context: { tenantId: string; branchId: string },
    pickingOrderId: string,
  ) {
    const pickingOrder = await this.repositories.picking.getById(context, pickingOrderId);
    if (!pickingOrder)
      throw new Error(`PickingOrder not found in authorized scope: ${pickingOrderId}`);
    return pickingOrder;
  }

  private async buildDetail(
    context: { tenantId: string; branchId: string },
    pickingOrderId: string,
  ): Promise<PickingDetailDto> {
    const scope = { tenantId: context.tenantId, branchId: context.branchId };
    const pickingOrder = await this.requirePickingOrder(scope, pickingOrderId);
    const [order, lines, locations, incidents, releases] = await Promise.all([
      pickingOrder.sourceType === "transfer" || !pickingOrder.orderId
        ? Promise.resolve(null)
        : this.repositories.orders.getById(pickingOrder.orderId),
      this.repositories.picking.getItems(scope, pickingOrderId),
      this.repositories.inventory.getLocations(scope.branchId),
      this.repositories.picking.getIncidents(scope, pickingOrderId),
      this.repositories.picking.getReleaseHistory(scope, pickingOrderId),
    ]);
    const transfer =
      pickingOrder.sourceType === "transfer"
        ? await this.repositories.inventoryTransfers.getById(pickingOrder.sourceId!)
        : null;
    if (transfer) {
      if (
        transfer.transfer.tenantId !== scope.tenantId ||
        transfer.transfer.sourceBranchId !== scope.branchId
      ) {
        throw new Error(`Transfer context conflict for PickingOrder: ${pickingOrderId}`);
      }
    } else if (!order || order.tenantId !== scope.tenantId || order.branchId !== scope.branchId) {
      throw new Error(`Fulfillment source conflict for PickingOrder: ${pickingOrderId}`);
    }
    const destination = transfer
      ? await this.repositories.branches.getById(transfer.transfer.destinationBranchId)
      : null;
    const customerName = transfer
      ? destination?.tenantId === scope.tenantId
        ? destination.name
        : "Sucursal destino"
      : await this.resolveCustomerName(order!, scope.tenantId);
    const detailLines = await Promise.all(
      lines.map(async (line): Promise<PickingDetailLineDto> => {
        const product = await this.repositories.products.getById(line.productId);
        if (!product || product.tenantId !== scope.tenantId) {
          throw new Error(`Product context conflict for PickingLine: ${line.id}`);
        }
        const inventory = await this.repositories.inventory.getPickingAvailability({
          ...scope,
          pickingOrderId,
          pickingItemId: line.id,
          orderId: pickingOrder.orderId,
          sourceType: pickingOrder.sourceType,
          sourceId: pickingOrder.sourceId,
          productId: line.productId,
        });
        const location = locations.find(
          (item) => item.id === line.locationId && item.tenantId === scope.tenantId,
        );
        const lot = inventory.locations
          .flatMap((item) => item.lots)
          .find((item) => item.lotId === line.lotId);
        return {
          pickingLineId: line.id,
          orderItemId: line.orderItemId,
          productId: product.id,
          sku: product.sku,
          name: product.name,
          requiredQuantity: line.requestedQuantity,
          pickedQuantity: line.pickedQuantity,
          remainingQuantity: line.requestedQuantity - line.pickedQuantity,
          status: line.status,
          location: location ? { id: location.id, code: location.code, name: location.name } : null,
          lot: lot ? { id: lot.lotId, number: lot.lotNumber } : null,
          serialNumbers: [...(line.serialNumbers ?? [])],
          availableLocations: inventory.locations.map((item) => ({
            id: item.locationId ?? null,
            code: item.locationCode ?? null,
            name: item.locationName ?? null,
            ownReservedQuantity: item.ownReservedQuantity,
            usableQuantity: item.usableQuantity,
          })),
          availableLots: inventory.locations.flatMap((item) =>
            item.lots.map((candidate) => ({
              id: candidate.lotId,
              number: candidate.lotNumber,
              expirationDate: candidate.expirationDate ?? null,
              physicalQuantity: candidate.physicalQuantity,
            })),
          ),
          availableSerialNumbers: inventory.locations.flatMap((item) =>
            item.serialNumbers.map((serial) => serial.serialNumber),
          ),
          tracking: { ...product.tracking },
          inventory,
          sourceLineId: line.orderItemId,
          trackingSelections: [],
        };
      }),
    );
    return {
      pickingOrderId: pickingOrder.id,
      orderId: pickingOrder.orderId,
      orderReference: transfer?.transfer.number ?? order!.orderNumber,
      customerName,
      storePickupContact: transfer ? null : getStorePickupContact(order!),
      deliveryMethod: transfer ? "transfer" : order!.deliveryMethod,
      sourceType: transfer ? "transfer" : "order",
      sourceId: transfer?.transfer.id ?? order!.id,
      branchId: pickingOrder.branchId,
      status: pickingOrder.status,
      priority: pickingOrder.priority,
      assignedUserId: pickingOrder.assignedUserId ?? null,
      progress: getProgress(lines),
      startedAt: pickingOrder.startedAt ?? null,
      completedAt: pickingOrder.completedAt ?? null,
      createdAt: pickingOrder.createdAt,
      updatedAt: pickingOrder.updatedAt,
      lines: detailLines,
      incidents: incidents.map(toIncidentDto),
      releases: releases.map(toReleaseDto),
    };
  }

  private async resolveCustomerName(order: Order, tenantId: string): Promise<string> {
    if (order.deliveryMethod === DeliveryMethod.store_pickup && order.storePickupContact) {
      return order.storePickupContact.recipientName.trim();
    }
    const guestName = order.guestCustomer?.name.trim();
    if (guestName) return guestName;
    if (!order.customerId) return "Consumidor final";
    const customer = await this.repositories.customers.getById(order.customerId);
    if (!customer || customer.tenantId !== tenantId) return "Cliente no disponible";
    return customer.name.trim() || "Cliente no disponible";
  }
}

function getStorePickupContact(order: Order) {
  return order.deliveryMethod === DeliveryMethod.store_pickup && order.storePickupContact
    ? { ...order.storePickupContact }
    : null;
}

function getProgress(
  lines: Array<{ requestedQuantity: number; pickedQuantity: number }>,
): PickingProgressDto {
  const requiredQuantity = lines.reduce((total, line) => total + line.requestedQuantity, 0);
  const pickedQuantity = lines.reduce((total, line) => total + line.pickedQuantity, 0);
  return {
    requiredQuantity,
    pickedQuantity,
    remainingQuantity: Math.max(requiredQuantity - pickedQuantity, 0),
    percentage: requiredQuantity === 0 ? 0 : Math.round((pickedQuantity / requiredQuantity) * 100),
  };
}

function toActionResult(
  pickingOrder: {
    id: string;
    orderId?: string;
    status: PickingActionResultDto["status"];
    assignedUserId?: string;
    updatedAt: string;
  },
  idempotent: boolean,
): PickingActionResultDto {
  return {
    pickingOrderId: pickingOrder.id,
    orderId: pickingOrder.orderId,
    status: pickingOrder.status,
    assignedUserId: pickingOrder.assignedUserId ?? null,
    updatedAt: pickingOrder.updatedAt,
    idempotent,
  };
}

function toApiActionResult(result: PickingCommandActionResult): PickingActionResultDto {
  return {
    pickingOrderId: result.pickingOrderId,
    ...(result.orderId ? { orderId: result.orderId } : {}),
    status: result.status,
    assignedUserId: result.assignedUserId,
    updatedAt: result.updatedAt,
    idempotent: result.idempotent,
  };
}

function toIncidentDto(incident: {
  id: string;
  pickingOrderId: string;
  pickingLineId?: string | null;
  type: PickingIncidentType;
  quantityAffected?: number | null;
  comment: string;
  status: PickingIncidentDto["status"];
  createdBy: string;
  createdAt: string;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
}): PickingIncidentDto {
  return {
    ...incident,
    pickingLineId: incident.pickingLineId ?? null,
    quantityAffected: incident.quantityAffected ?? null,
    resolvedBy: incident.resolvedBy ?? null,
    resolvedAt: incident.resolvedAt ?? null,
  };
}

function toReleaseDto(release: {
  id: string;
  pickingOrderId: string;
  actorUserId: string;
  reason: string;
  releasedAt: string;
}): PickingReleaseDto {
  return { ...release };
}
