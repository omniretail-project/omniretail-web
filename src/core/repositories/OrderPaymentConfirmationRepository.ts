import type { InventoryReservation, Order, Payment } from "@/core/entities";

export interface ConfirmOrderPaymentInput {
  tenantId: string;
  branchId: string;
  orderId: string;
  paymentId: string;
}

export interface ConfirmOrderPaymentResult {
  order: Order;
  payment: Payment;
  inventoryReservations: InventoryReservation[];
  idempotent: boolean;
}

export interface OrderPaymentConfirmationRepository {
  confirm(input: ConfirmOrderPaymentInput): Promise<ConfirmOrderPaymentResult>;
}
