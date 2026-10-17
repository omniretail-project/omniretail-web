import type { InventoryTransferWithItems } from "@/core/repositories";
import { BranchStatus, type InventoryTransferReason } from "@/core/enums";
import { resolveCurrentSessionSnapshot } from "@/modules/auth/application/services/resolveCurrentSessionSnapshot";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { assertValidTransferQuantity } from "@/modules/inventory/application/services/TransferRequestServices";
import {
  ensureCanManageTransfers,
  ensureInventoryBranchBelongsToTenant,
  ensureProductBelongsToTenant,
  ensureTenantCanUseInventory,
  ensureTenantCanUseTracking,
  ensureUserCanOperateInventoryBranch,
  InventoryServiceError,
  resolveInventoryContext,
} from "@/modules/inventory/application/services/serviceHelpers";

export interface CreateInventoryTransferCommand {
  destinationBranchId: string;
  sourceBranchId: string;
  productId: string;
  quantity: number;
  operationId: string;
  reason?: InventoryTransferReason;
  notes?: string;
}

/** Session and active branch are authoritative; the caller only proposes destination. */
export class CreateInventoryTransferService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(command: CreateInventoryTransferCommand): Promise<InventoryTransferWithItems> {
    const { tenantId, actorUserId, user, permissions } = await resolveInventoryContext(
      this.repositories,
    );
    ensureCanManageTransfers(permissions);
    if (command.sourceBranchId === command.destinationBranchId) {
      throw new InventoryServiceError("El origen y el destino deben ser sucursales distintas.");
    }
    const session = await resolveCurrentSessionSnapshot(this.repositories);
    const activeBranchId = session.sessionId
      ? (await this.repositories.auth.getSession(session.sessionId))?.activeBranchId
      : undefined;
    if (!activeBranchId || activeBranchId !== command.destinationBranchId) {
      throw new InventoryServiceError("El destino debe ser la sucursal activa de la sesión.");
    }
    const entitlements = await ensureTenantCanUseInventory(this.repositories, tenantId);
    const destination = await ensureUserCanOperateInventoryBranch(
      this.repositories, user, command.destinationBranchId,
    );
    const source = await ensureUserCanOperateInventoryBranch(
      this.repositories, user, command.sourceBranchId,
    );
    if (destination.status !== BranchStatus.active || source.status !== BranchStatus.active) {
      throw new InventoryServiceError("Las sucursales del traslado deben estar activas.");
    }
    const product = ensureProductBelongsToTenant(
      await this.repositories.products.getById(command.productId), tenantId,
    );
    const capabilities = await this.repositories.businessConfig.getCapabilities(tenantId);
    if (!capabilities) throw new InventoryServiceError("Configuración de inventario no disponible.");
    ensureTenantCanUseTracking(entitlements, capabilities, product);
    const unit = await this.repositories.units.getByIdScoped(tenantId, product.baseUnitId);
    if (!unit) throw new InventoryServiceError("La unidad base del producto no está disponible.");
    assertValidTransferQuantity(command.quantity, unit.allowsDecimals);
    if (!command.operationId.trim()) {
      throw new InventoryServiceError("La operación de traslado requiere una identidad.");
    }
    return this.repositories.inventoryTransfers.create({
      tenantId, sourceBranchId: command.sourceBranchId,
      destinationBranchId: command.destinationBranchId,
      operationId: command.operationId.trim(), preparedByUserId: actorUserId,
      reason: command.reason,
      notes: command.notes?.trim(),
      items: [{ productId: product.id, requestedQuantity: command.quantity }],
    });
  }
}

export class CancelInventoryTransferService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(transferId: string, reason: string, operationId: string) {
    const { tenantId, actorUserId, user, permissions } = await resolveInventoryContext(
      this.repositories,
    );
    ensureCanManageTransfers(permissions);
    await ensureTenantCanUseInventory(this.repositories, tenantId);
    const item = await this.repositories.inventoryTransfers.getById(transferId);
    if (!item || item.transfer.tenantId !== tenantId) {
      throw new InventoryServiceError("Traslado no encontrado.");
    }
    await ensureUserCanOperateInventoryBranch(this.repositories, user, item.transfer.sourceBranchId);
    await ensureInventoryBranchBelongsToTenant(
      this.repositories, tenantId, item.transfer.destinationBranchId,
    );
    return this.repositories.inventoryTransfers.cancel(transferId, {
      reason, actorUserId, operationId,
    });
  }
}
