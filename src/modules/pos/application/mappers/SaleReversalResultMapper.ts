import type {
  PosApiReversalEffect,
  PosApiVoidResult,
  SaleReversalResult,
} from "@/core/repositories";
import type { SaleReversalResultDto } from "@/modules/pos/application/dto/SaleReversalResultDto";

export function mapSaleReversalResult(result: SaleReversalResult): SaleReversalResultDto {
  const operation = result.returnRequest ?? result.void;
  if (!operation) throw new Error("La reversion no contiene una operacion procesada.");
  return {
    saleId: result.sale.id,
    documentNumber: result.sale.number,
    saleStatus: result.sale.status,
    operationType: result.returnRequest ? "return" : "void",
    operationId: operation.id,
    amount: operation.refundTotal,
    refunds: result.refunds.map((refund) => ({
      paymentId: refund.paymentId,
      method: refund.method,
      amount: refund.amount,
    })),
    inventoryMovementIds: result.inventoryMovements.map((movement) => movement.id),
    cashMovementId: result.cashMovement?.id,
    cashMovementIds: result.cashMovement ? [result.cashMovement.id] : [],
    inventoryRestored: result.inventoryMovements.length > 0,
    cashMovementRecorded: Boolean(result.cashMovement),
    cashMovementAmount: result.cashMovement?.amount,
    creditNote: {
      id: result.creditNote.id,
      documentNumber: result.creditNote.documentNumber,
      amount: result.creditNote.amount,
    },
    idempotent: result.idempotent,
  };
}

export function mapApiReturnResult(
  saleId: string,
  result: PosApiReversalEffect,
): SaleReversalResultDto {
  return {
    saleId,
    saleStatus: result.saleStatus,
    operationType: "return",
    operationId: result.operationId,
    amount: result.commercialRefundAmount,
    inventoryMovementIds: result.inventory.movementIds,
    cashMovementIds: result.cashMovement.movementIds,
    inventoryRestored: result.inventory.inventoryRestored,
    cashMovementRecorded: result.cashMovement.recorded,
    cashMovementAmount: result.cashMovement.amount,
    idempotent: result.idempotent,
  };
}

export function mapApiVoidResult(result: PosApiVoidResult): SaleReversalResultDto {
  return {
    saleId: result.sale.id,
    documentNumber: result.sale.number,
    saleStatus: result.sale.status,
    operationType: "void",
    operationId: result.operationId,
    amount: result.sale.total,
    inventoryMovementIds: result.inventory.movementIds,
    cashMovementIds: result.cashMovement.movementIds,
    inventoryRestored: result.inventory.inventoryRestored,
    cashMovementRecorded: result.cashMovement.recorded,
    cashMovementAmount: result.cashMovement.amount,
    idempotent: result.idempotent,
  };
}
