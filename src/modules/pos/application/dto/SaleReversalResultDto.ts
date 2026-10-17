import type { PaymentMethod, SaleStatus } from "@/core/enums";

export interface SaleReversalResultDto {
  saleId: string;
  documentNumber?: string;
  saleStatus: SaleStatus;
  operationType: "return" | "void";
  operationId: string;
  amount: number;
  refunds?: Array<{
    paymentId: string;
    method: Exclude<PaymentMethod, "mixed">;
    amount: number;
  }>;
  inventoryMovementIds: string[];
  cashMovementId?: string;
  cashMovementIds: string[];
  inventoryRestored: boolean;
  cashMovementRecorded: boolean;
  cashMovementAmount?: number;
  creditNote?: {
    id: string;
    documentNumber: string;
    amount: number;
  };
  idempotent: boolean;
}
