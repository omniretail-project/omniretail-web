import type { CustomerOrderStatus } from "@/core/orders/mapOrderStatusToCustomerStatus";

export interface StorefrontOrderTrackingDto {
  orderNumber: string;
  status: CustomerOrderStatus;
  total: number;
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    subtotal: number;
  }>;
}
