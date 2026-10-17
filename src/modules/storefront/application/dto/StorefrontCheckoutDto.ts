import type { OrderStatus, PaymentStatus } from "@/core/enums";

export interface StorefrontCheckoutFormDto {
  fullName: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  department?: string;
  references?: string;
  cardholderName: string;
  cardLastFour: string;
}

export interface StorefrontCheckoutResultDto {
  orderNumber: string;
  trackingToken: string;
  guestTrackingEnabled: boolean;
  confirmationEmailSent: boolean;
  total: number;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  hasInventoryReservations: boolean;
  deliveryAddress: {
    recipientName: string;
    line1: string;
    line2?: string;
    city: string;
    department?: string;
    phone: string;
  };
  items: Array<{
    sku: string;
    name: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    imageUrl?: string;
    imageAlt?: string;
  }>;
}
