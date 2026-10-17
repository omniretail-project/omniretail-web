import type {
  CashMovementType,
  CashShiftStatus,
  DeliveryMethod,
  PaymentMethod,
  PaymentStatus,
  SaleStatus,
  TransportMode,
  OrderStatus,
} from "@/core/enums";
import type { CurrencyCode, ISODateString } from "@/core/types/common.types";
import type { AddressSnapshot } from "@/core/types/address.types";
import type { OrderNotificationContact } from "@/core/types/orderNotification.types";
import type { StorePickupContactSnapshot } from "@/core/types/storePickupContact.types";

export interface PosApiCashShift {
  id: string;
  branchId: string;
  userId: string;
  registerCode: string;
  status: CashShiftStatus;
  openedAt: ISODateString;
  openingAmount: number;
  closedAt?: ISODateString;
  expectedAmount?: number;
  countedAmount?: number;
  difference?: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface PosApiCashMovement {
  id: string;
  cashShiftId: string;
  type: CashMovementType;
  amount: number;
  reason: string;
  referenceType?: string;
  referenceId?: string;
  createdByUserId: string;
  createdAt: ISODateString;
  saleNumber?: string;
}

export interface PosApiCashShiftSummary {
  cashShiftId: string;
  branchId: string;
  cashierId: string;
  registerCode: string;
  status: CashShiftStatus;
  openedAt: ISODateString;
  closedAt?: ISODateString;
  openingAmount: number;
  cashIn: number;
  cashOut: number;
  manualCashIn: number;
  manualCashOut: number;
  salesCashIn: number;
  voidCashOut: number;
  returnCashOut: number;
  expectedAmount: number;
  countedAmount?: number;
  difference?: number;
}

export interface PosApiSaleItem {
  id: string;
  productId: string;
  promotionId?: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  subtotal: number;
}

export interface PosApiPayment {
  id: string;
  saleId?: string;
  orderId?: string;
  method: Exclude<PaymentMethod, "mixed">;
  amount: number;
  reference?: string;
  status: PaymentStatus;
  currency: CurrencyCode;
  bankAccountId?: string;
  externallyVerified?: boolean;
  verifiedByUserId?: string;
  verifiedAt?: ISODateString;
}

export interface PosApiSaleConfirmation {
  id: string;
  number: string;
  branchId: string;
  cashShiftId: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  createdAt: ISODateString;
  status: SaleStatus;
  customerId?: string;
  sourceOrderId?: string;
  items: PosApiSaleItem[];
  payments: PosApiPayment[];
  inventoryEffects: Array<{ id: string }>;
  cashMovement?: Pick<PosApiCashMovement, "id" | "cashShiftId" | "amount">;
  order?: { id: string; orderNumber: string };
  pickingOrder?: { id: string; orderId: string };
  idempotent: boolean;
}

export interface PosApiReturnEligibility {
  sale: {
    id: string;
    documentNumber: string;
    createdAt: ISODateString;
    customerDisplayName: string;
    total: number;
    status: SaleStatus;
  };
  items: Array<{
    saleItemId: string;
    productId: string;
    sku: string;
    name: string;
    soldQuantity: number;
    returnedQuantity: number;
    returnableQuantity: number;
    unitPrice: number;
    discount: number;
    subtotal: number;
    canReturn: boolean;
    blockedReason?: string;
  }>;
  payments: Array<{
    id: string;
    method: PaymentMethod;
    status: PaymentStatus;
    amount: number;
    currency: CurrencyCode;
  }>;
  previouslyReturnedAmount: number;
  cashRefundRecordedAmount: number;
  originalCashShiftOpen: boolean;
  actorHasOpenCashShift: boolean;
  allowedOperations: {
    voidTotal: boolean;
    partialReturn: boolean;
    voidBlockedReason?: string;
    returnBlockedReason?: string;
  };
}

export interface PosApiReversalEffect {
  operationId: string;
  idempotent: boolean;
  reason: string;
  saleStatus: SaleStatus;
  commercialRefundAmount: number;
  inventory: {
    inventoryRestored: boolean;
    movementIds: string[];
    reservationsReleased?: number;
  };
  cashMovement: {
    recorded: boolean;
    movementIds: string[];
    amount?: number;
  };
}

export interface PosApiVoidResult {
  operationId: string;
  idempotent: boolean;
  reason: string;
  inventory: PosApiReversalEffect["inventory"];
  cashMovement: PosApiReversalEffect["cashMovement"];
  sale: {
    id: string;
    number: string;
    status: SaleStatus;
    total: number;
  };
}

export interface PosApiSalesHistoryRow {
  saleId: string;
  saleNumber: string;
  createdAt: ISODateString;
  customerDisplayName: string;
  total: number;
  status: SaleStatus;
  sourceOrderId?: string;
  deliveryMethod?: DeliveryMethod;
  operationalStatus?: OrderStatus;
}

export interface PosApiSalesHistoryPage {
  items: PosApiSalesHistoryRow[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  summary: {
    total: number;
    completed: number;
    partiallyReturned: number;
    returned: number;
    cancelled: number;
  };
}

export interface PosApiSaleDetail {
  sale: Omit<PosApiSaleConfirmation, "items" | "payments" | "inventoryEffects" | "idempotent"> & {
    document: {
      type: "ticket" | "invoice";
      taxId?: string;
      legalName?: string;
      fiscalAddress?: string;
    };
  };
  items: PosApiSaleItem[];
  payments: PosApiPayment[];
}

export interface PosApiConfirmSaleCommand {
  branchId: string;
  cashShiftId: string;
  customerId?: string;
  taxTotal: 0;
  items: Array<{
    productId: string;
    quantity: number;
    discount: number;
    trackingSelections: [];
  }>;
  payments: Array<{
    method: Exclude<PaymentMethod, "mixed">;
    amount: number;
    bankAccountId?: string;
    reference?: string;
    externallyVerified?: boolean;
  }>;
  confirmationId: string;
  document?: {
    type: "ticket" | "invoice";
    taxId?: string;
    legalName?: string;
    fiscalAddress?: string;
  };
  sourceOrderId: null;
  deferredOrder?: {
    idempotencyKey: string;
    deliveryMethod: DeliveryMethod;
    transportMode: TransportMode;
    deliveryAddress?: AddressSnapshot;
    notificationContact?: OrderNotificationContact;
    storePickupContact?: StorePickupContactSnapshot;
  };
}

export interface PosApiRepository {
  getOpenCashShift(branchId: string): Promise<PosApiCashShift | null>;
  openCashShift(input: {
    branchId: string;
    registerCode: string;
    openingAmount: number;
  }): Promise<PosApiCashShift>;
  closeCashShift(input: { cashShiftId: string; countedAmount: number }): Promise<PosApiCashShift>;
  getCashShiftSummary(cashShiftId: string): Promise<PosApiCashShiftSummary>;
  getCashShiftMovements(cashShiftId: string): Promise<PosApiCashMovement[]>;
  registerCashMovement(input: {
    cashShiftId: string;
    type: CashMovementType;
    amount: number;
    reason: string;
  }): Promise<PosApiCashMovement>;
  confirmSale(input: PosApiConfirmSaleCommand): Promise<PosApiSaleConfirmation>;
  getSalesHistory(input: {
    branchId: string;
    search?: string;
    from?: string;
    to?: string;
    status?: SaleStatus;
    deliveryMethod?: DeliveryMethod;
    operationalStatus?: OrderStatus;
    page: number;
    pageSize: number;
  }): Promise<PosApiSalesHistoryPage>;
  getSaleDetail(saleId: string): Promise<PosApiSaleDetail>;
  getReturnEligibility(
    branchId: string,
    documentNumber: string,
  ): Promise<PosApiReturnEligibility | null>;
  processReturn(
    saleId: string,
    idempotencyKey: string,
    input: {
      reason: string;
      lines: Array<{ saleItemId: string; quantity: number; trackingSelections: [] }>;
    },
  ): Promise<PosApiReversalEffect>;
  voidSale(
    saleId: string,
    idempotencyKey: string,
    input: { reason: string },
  ): Promise<PosApiVoidResult>;
}
