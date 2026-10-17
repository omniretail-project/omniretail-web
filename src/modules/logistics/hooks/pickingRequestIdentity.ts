import type { PickingTrackingSelectionCommand } from "@/core/repositories";
import { normalizePickingQuantity } from "@/modules/logistics/application/pickingPhysicalSelection";

export interface PickingRequestIdentity {
  sequence: number;
  currentSequence: number;
  requestedBranchId: string;
  activeBranchId: string | null;
  requestedPickingOrderId?: string;
  selectedPickingOrderId?: string | null;
}

export function isCurrentPickingRequest(identity: PickingRequestIdentity): boolean {
  if (
    identity.sequence !== identity.currentSequence ||
    identity.requestedBranchId !== identity.activeBranchId
  ) {
    return false;
  }
  if (identity.requestedPickingOrderId === undefined) return true;
  return identity.requestedPickingOrderId === identity.selectedPickingOrderId;
}

export function getOrCreatePickingOperationId(
  pendingOperationIds: Map<string, string>,
  fingerprint: string,
  createOperationId: () => string = () => crypto.randomUUID(),
): string {
  const pendingOperationId = pendingOperationIds.get(fingerprint);
  if (pendingOperationId) return pendingOperationId;
  const operationId = createOperationId();
  pendingOperationIds.set(fingerprint, operationId);
  return operationId;
}

export interface PickingUpdateFingerprintInput {
  pickingOrderId: string;
  pickingLineId: string;
  targetQuantity: number;
  locationId: string | null;
  trackingSelections: PickingTrackingSelectionCommand[];
}

export function canonicalizePickingTrackingSelections(
  trackingSelections: PickingTrackingSelectionCommand[],
): PickingTrackingSelectionCommand[] {
  return trackingSelections
    .map((selection) => ({
      ...selection,
      lotId: selection.lotId ?? null,
      quantity: normalizePickingQuantity(selection.quantity),
      serialNumbers: [...selection.serialNumbers].sort(),
    }))
    .sort((left, right) => compareSelectionKeys(selectionKey(left), selectionKey(right)));
}

export function createPickingUpdateFingerprint(input: PickingUpdateFingerprintInput): string {
  return JSON.stringify([
    input.pickingOrderId,
    input.pickingLineId,
    normalizePickingQuantity(input.targetQuantity),
    input.locationId,
    canonicalizePickingTrackingSelections(input.trackingSelections),
  ]);
}

function selectionKey(selection: PickingTrackingSelectionCommand): string {
  return JSON.stringify([
    selection.locationId,
    selection.lotId,
    selection.quantity,
    selection.serialNumbers,
  ]);
}

function compareSelectionKeys(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
