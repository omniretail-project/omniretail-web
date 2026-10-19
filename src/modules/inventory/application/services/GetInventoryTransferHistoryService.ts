import { DispatchStatus, InventoryMovementType, InventoryTransferStatus } from "@/core/enums";
import { canUserOperateBranch } from "@/core/scopes/userBranchAccess";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  ensureCanReadStock,
  ensureUserCanOperateInventoryBranch,
  INVENTORY_TRANSFERS_MANAGE_PERMISSION,
  resolveInventoryContext,
} from "@/modules/inventory/application/services/serviceHelpers";

export interface TransferLifecycleStep {
  label: string;
  at: string;
}

export interface TransferMovementRow {
  id: string;
  label: "Transfer Out" | "Transfer In";
  quantity: number;
  reason: string;
  at: string;
  branchName: string;
}

export interface TransferHistoryRow {
  id: string;
  number: string;
  sourceRequestIds: string[];
  requestedQuantity: number;
  sourceBranchName: string;
  destinationBranchName: string;
  status: InventoryTransferStatus;
  createdAt: string;
  updatedAt: string;
  canCancel: boolean;
  lifecycle: TransferLifecycleStep[];
  movements: TransferMovementRow[];
  /**
   * Modo API: el historial de movimientos solo cubre la sucursal consultada y las paginas leidas.
   * Se informa en vez de completar con datos simulados.
   */
  movementsLimitation?: string;
}

/** Forma comun de un movimiento del historial (mock completo o pagina real de la API). */
interface HistoryMovement {
  id: string;
  tenantId?: string;
  branchId: string;
  branchName?: string | null;
  type: InventoryMovementType;
  reason: string;
  quantity: number;
  referenceType?: string | null;
  referenceId?: string | null;
  createdAt: string;
}

/** Tope de paginas de movimientos leidas por consulta (100 por pagina). */
export const TRANSFER_HISTORY_MOVEMENT_MAX_PAGES = 5;
const API_MOVEMENT_PAGE_SIZE = 100;
const BRANCH_ONLY_MOVEMENTS_NOTICE =
  "Solo se muestran los movimientos de esta sucursal registrados en el historial de inventario.";
const INCOMPLETE_MOVEMENTS_NOTICE =
  "El historial de movimientos es parcial: se leyeron solo las paginas mas recientes.";

/** Read-only projection from persisted Transfer, Picking, Packing, Dispatch and movements. */
export class GetInventoryTransferHistoryService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(branchId: string, productId?: string): Promise<TransferHistoryRow[]> {
    const { tenantId, user, permissions } = await resolveInventoryContext(this.repositories);
    ensureCanReadStock(permissions);
    await ensureUserCanOperateInventoryBranch(this.repositories, user, branchId);
    const apiMovements = this.repositories.inventoryMovementsDataSource === "api";
    const [outgoing, incoming, branches, dispatches, movementRead] = await Promise.all([
      this.repositories.inventoryTransfers.query({ tenantId, sourceBranchId: branchId }),
      this.repositories.inventoryTransfers.query({ tenantId, destinationBranchId: branchId }),
      this.repositories.branches.getAll(),
      this.repositories.dispatches.getAll({ tenantId }),
      apiMovements
        ? this.loadApiMovements(branchId, productId)
        : this.repositories.inventory
            .getMovements()
            .then((items): { items: HistoryMovement[]; complete: boolean } => ({
              items,
              complete: true,
            })),
    ]);
    const movements: HistoryMovement[] = movementRead.items;
    const movementsLimitation = apiMovements
      ? movementRead.complete
        ? BRANCH_ONLY_MOVEMENTS_NOTICE
        : `${BRANCH_ONLY_MOVEMENTS_NOTICE} ${INCOMPLETE_MOVEMENTS_NOTICE}`
      : undefined;
    const transfers = [...new Map([...outgoing, ...incoming].map((item) =>
      [item.transfer.id, item])).values()].filter((item) =>
      !productId || item.items.some((entry) => entry.productId === productId));
    const branchById = new Map(branches.filter((branch) => branch.tenantId === tenantId)
      .map((branch) => [branch.id, branch.name]));

    return Promise.all(transfers.map(async ({ transfer, items }): Promise<TransferHistoryRow> => {
      const scope = { tenantId, branchId: transfer.sourceBranchId };
      const [picking, packing] = await Promise.all([
        this.repositories.picking.getBySource(scope, "transfer", transfer.id),
        this.repositories.packings.getBySource(scope, "transfer", transfer.id),
      ]);
      const dispatch = dispatches.find((item) => item.sourceType === "transfer" &&
        item.sourceId === transfer.id && item.branchId === transfer.sourceBranchId);
      const lifecycle: TransferLifecycleStep[] = [
        { label: "Traslado creado", at: transfer.createdAt },
      ];
      if (picking?.createdAt) lifecycle.push({ label: "Picking pendiente", at: picking.createdAt });
      if (picking?.startedAt) lifecycle.push({ label: "Picking iniciado", at: picking.startedAt });
      if (picking?.completedAt) lifecycle.push({ label: "Picking finalizado", at: picking.completedAt });
      if (packing?.startedAt) lifecycle.push({ label: "Packing iniciado", at: packing.startedAt });
      if (packing?.finalizedAt) lifecycle.push({ label: "Packing finalizado", at: packing.finalizedAt });
      if (dispatch?.status === DispatchStatus.dispatched && dispatch.dispatchedAt) {
        lifecycle.push({ label: "Despachado / En tránsito", at: dispatch.dispatchedAt });
      } else if (transfer.dispatchedAt) {
        lifecycle.push({ label: "Marcado en tránsito", at: transfer.dispatchedAt });
      }
      if (transfer.receivedAt) lifecycle.push({ label: "Recibido / Completado", at: transfer.receivedAt });
      if (transfer.cancelledAt) lifecycle.push({ label: "Cancelado", at: transfer.cancelledAt });
      // La identidad del traslado es el unico vinculo fiable (referenceId); el tipo de referencia
      // del API no se asume. En mock se conserva la comprobacion de tenant y de referencia.
      const transferMovements = movements.filter((item) =>
        (apiMovements || (item.tenantId === tenantId && item.referenceType === "transfer")) &&
        item.referenceId === transfer.id &&
        (item.branchId === transfer.sourceBranchId || item.branchId === transfer.destinationBranchId) &&
        (item.type === InventoryMovementType.out || item.type === InventoryMovementType.in));
      return {
        id: transfer.id,
        number: transfer.number,
        sourceRequestIds: transfer.sourceRequestIds ?? [],
        requestedQuantity: items.filter((entry) => !productId || entry.productId === productId)
          .reduce((total, entry) => total + entry.requestedQuantity, 0),
        sourceBranchName: branchById.get(transfer.sourceBranchId) ?? "Sucursal origen no disponible",
        destinationBranchName: branchById.get(transfer.destinationBranchId) ?? "Sucursal destino no disponible",
        status: transfer.status,
        createdAt: transfer.createdAt,
        updatedAt: transfer.updatedAt,
        canCancel: transfer.status === InventoryTransferStatus.preparing && !dispatch &&
          permissions.includes(INVENTORY_TRANSFERS_MANAGE_PERMISSION) &&
          branches.some((branch) => branch.id === transfer.sourceBranchId &&
            canUserOperateBranch(user, branch)),
        lifecycle: lifecycle.sort((left, right) => left.at.localeCompare(right.at)),
        movements: transferMovements.map((item): TransferMovementRow => ({
          id: item.id,
          label: item.type === InventoryMovementType.out ? "Transfer Out" : "Transfer In",
          quantity: item.quantity,
          reason: item.reason,
          at: item.createdAt,
          branchName: item.branchName ?? branchById.get(item.branchId) ?? "Sucursal no disponible",
        })).sort((left, right) => left.at.localeCompare(right.at)),
        movementsLimitation,
      };
    })).then((rows) => rows.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || left.number.localeCompare(right.number)));
  }

  /** Modo API: movimientos reales paginados del backend; nunca el store mock. */
  private async loadApiMovements(
    branchId: string,
    productId?: string,
  ): Promise<{ items: HistoryMovement[]; complete: boolean }> {
    const items: HistoryMovement[] = [];
    for (let page = 1; page <= TRANSFER_HISTORY_MOVEMENT_MAX_PAGES; page += 1) {
      const result = await this.repositories.inventory.getMovementPage({
        branchId,
        productId,
        page,
        pageSize: API_MOVEMENT_PAGE_SIZE,
        sort: "createdAt,desc",
      });
      items.push(...result.items);
      if (page >= result.totalPages) return { items, complete: true };
    }
    return { items, complete: false };
  }
}
