import type { DeliveryMethod, OrderStatus, PaymentMethod, PaymentStatus } from "@/core/enums";

export interface EcommerceOrderItemDto {
  id: string;
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  subtotal: number;
}

export interface EcommerceOrderPaymentDto {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  currency: string;
  bankAccountId: string | null;
  reference: string | null;
  externallyVerified: boolean | null;
}

export interface EcommerceOrderDto {
  id: string;
  orderNumber: string;
  branchId: string;
  customerId: string | null;
  customerName: string | null;
  guestCustomer: Record<string, unknown> | null;
  status: OrderStatus;
  deliveryMethod: DeliveryMethod;
  deliveryAddress: Record<string, unknown> | null;
  storePickupContact: Record<string, unknown> | null;
  notificationContact: Record<string, unknown> | null;
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  total: number;
  trackingToken: string | null;
  createdAt: string;
  updatedAt: string;
  items: EcommerceOrderItemDto[];
  payments: EcommerceOrderPaymentDto[];
}
