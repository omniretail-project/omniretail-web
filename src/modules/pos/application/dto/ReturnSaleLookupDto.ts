import type { PaymentMethod, PaymentStatus, SaleStatus } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface ReturnSaleItemDto {
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
}

export interface ReturnSalePaymentDto {
  paymentId: string;
  method: PaymentMethod;
  amount: number;
  refundedAmount?: number;
  refundableAmount?: number;
  status: PaymentStatus;
}

export interface ReturnSaleLookupDto {
  sale: {
    saleId: string;
    documentNumber: string;
    date: ISODateString;
    customerDisplayName: string;
    total: number;
    status: SaleStatus;
  };
  items: ReturnSaleItemDto[];
  payments: ReturnSalePaymentDto[];
  returnableItems: ReturnSaleItemDto[];
  paymentSummary: string;
  isWithinCurrentShift: boolean;
  allowedOperations: {
    voidTotal: boolean;
    partialReturn: boolean;
    voidBlockedReason?: string;
    returnBlockedReason?: string;
  };
}
