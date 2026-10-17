import type { InventoryTransfer, Order, Packing, PackingChecklist } from "@/core/entities";

export interface PackingScope {
  tenantId: string;
  branchId: string;
}

interface PackingMutationInput extends PackingScope {
  packingId: string;
  actorUserId: string;
  operationId: string;
  expectedVersion: number;
}

export interface SavePackingPreparationInput extends PackingMutationInput {
  checklist: PackingChecklist;
  totalWeight?: number;
  packageCount?: number;
}

export type GeneratePackingLabelInput = PackingMutationInput;

export interface RegisterPackingLabelPrintInput extends PackingMutationInput {
  labelGenerationId: string;
}

export type FinalizePackingInput = PackingMutationInput & { sourceType?: "order" };
export type FinalizeTransferPackingInput = PackingMutationInput & { sourceType: "transfer" };

export interface PackingMutationResult {
  packing: Packing;
  idempotent: boolean;
}

export interface FinalizePackingResult extends PackingMutationResult {
  order: Order;
}

export interface FinalizeTransferPackingResult extends PackingMutationResult {
  transfer: InventoryTransfer;
}

export interface PackingRepository {
  getQueue(scope: PackingScope): Promise<Packing[]>;
  getById(scope: PackingScope, packingId: string): Promise<Packing | null>;
  getByOrder(scope: PackingScope, orderId: string): Promise<Packing | null>;
  getBySource(scope: PackingScope, sourceType: "order" | "transfer", sourceId: string): Promise<Packing | null>;
  savePreparation(input: SavePackingPreparationInput): Promise<PackingMutationResult>;
  generateLabel(input: GeneratePackingLabelInput): Promise<PackingMutationResult>;
  registerLabelPrint(input: RegisterPackingLabelPrintInput): Promise<PackingMutationResult>;
  finalize(input: FinalizePackingInput): Promise<FinalizePackingResult>;
  finalize(input: FinalizeTransferPackingInput): Promise<FinalizeTransferPackingResult>;
}
