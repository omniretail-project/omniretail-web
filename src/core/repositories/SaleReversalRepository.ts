import type {
  CashMovement,
  CreditNote,
  InventoryMovement,
  Payment,
  RefundTransaction,
  ReturnRequest,
  Sale,
  SaleVoid,
} from "@/core/entities";
import type { ProductType } from "@/core/enums";
import type { ProductTrackingConfig } from "@/core/types/tracking.types";

export interface InspectSaleReversalInput {
  tenantId: string;
  branchId: string;
  saleId: string;
  actorUserId: string;
}

export interface SaleReversalItemSnapshot {
  saleItemId: string;
  productId: string;
  soldQuantity: number;
  returnedQuantity: number;
  returnableQuantity: number;
  productType: ProductType;
  tracking: ProductTrackingConfig;
  isSafelyReversible: boolean;
  blockedReason?: string;
}

export interface SaleReversalInspection {
  sale: Sale;
  payments: Payment[];
  refunds: RefundTransaction[];
  customerDisplayName: string;
  items: SaleReversalItemSnapshot[];
  isWithinCurrentShift: boolean;
  voidAllowed: boolean;
  partialReturnAllowed: boolean;
  voidBlockedReason?: string;
  returnBlockedReason?: string;
}

export interface ProcessSaleReturnInput {
  tenantId: string;
  branchId: string;
  saleId: string;
  actorUserId: string;
  idempotencyKey: string;
  reason: string;
  lines: Array<{ saleItemId: string; quantity: number }>;
}

export interface VoidSaleInput {
  tenantId: string;
  branchId: string;
  saleId: string;
  actorUserId: string;
  idempotencyKey: string;
  reason: string;
}

export interface SaleReversalResult {
  sale: Sale;
  returnRequest?: ReturnRequest;
  void?: SaleVoid;
  refunds: RefundTransaction[];
  inventoryMovements: InventoryMovement[];
  cashMovement?: CashMovement;
  creditNote: CreditNote;
  idempotent: boolean;
}

export interface SaleReversalRepository {
  inspect(input: InspectSaleReversalInput): Promise<SaleReversalInspection>;
  processReturn(input: ProcessSaleReturnInput): Promise<SaleReversalResult>;
  voidSale(input: VoidSaleInput): Promise<SaleReversalResult>;
}
