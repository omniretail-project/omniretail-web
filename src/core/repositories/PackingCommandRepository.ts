import type { InventoryTransferStatus, OrderStatus } from "@/core/enums";
import type { PackingChecklist } from "@/core/entities";
import type { PackingScope } from "@/core/repositories/PackingRepository";
import type { PackingDetailReadModel } from "@/core/repositories/PackingReadRepository";

export interface SavePackingPreparationApiCommand {
  expectedVersion: number;
  operationId: string;
  checklist: PackingChecklist;
  totalWeight?: number;
  packageCount?: number;
}

export interface PackingVersionedApiCommand {
  expectedVersion: number;
  operationId: string;
}

export interface RegisterPackingLabelPrintApiCommand extends PackingVersionedApiCommand {
  labelGenerationId: string;
}

export interface PackingCommandActionResult {
  packing: PackingDetailReadModel;
  idempotent: boolean;
}

export interface FinalizePackingCommandResult extends PackingCommandActionResult {
  orderStatus: OrderStatus | null;
  transferStatus: InventoryTransferStatus | null;
}

/** Commands de Packing; tenant y actor nunca se aceptan desde el navegador. */
export interface PackingCommandRepository {
  savePreparation(
    scope: PackingScope,
    packingId: string,
    command: SavePackingPreparationApiCommand,
  ): Promise<PackingCommandActionResult>;
  generateLabel(
    scope: PackingScope,
    packingId: string,
    command: PackingVersionedApiCommand,
  ): Promise<PackingCommandActionResult>;
  registerLabelPrint(
    scope: PackingScope,
    packingId: string,
    command: RegisterPackingLabelPrintApiCommand,
  ): Promise<PackingCommandActionResult>;
  finalize(
    scope: PackingScope,
    packingId: string,
    command: PackingVersionedApiCommand,
  ): Promise<FinalizePackingCommandResult>;
}
