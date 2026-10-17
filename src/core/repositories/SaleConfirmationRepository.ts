import type {
  CashMovement,
  InventoryMovement,
  Order,
  Payment,
  PickingOrder,
  Sale,
  SaleDocumentSnapshot,
} from "@/core/entities";
import type { DeliveryMethod, PaymentMethod, PaymentStatus, TransportMode } from "@/core/enums";
import type { CreateSaleItemInput } from "@/core/repositories/SalesRepository";
import type { AddressSnapshot } from "@/core/types/address.types";
import type { CurrencyCode } from "@/core/types/common.types";
import type { OrderNotificationContact } from "@/core/types/orderNotification.types";
import type { StorePickupContactSnapshot } from "@/core/types/storePickupContact.types";

export type SaleConfirmationPaymentMethod = Exclude<PaymentMethod, "mixed">;

export interface SaleConfirmationPaymentInput {
  method: SaleConfirmationPaymentMethod;
  amount: number;
  currency: CurrencyCode;
  status?: PaymentStatus;
  bankAccountId?: string;
  reference?: string;
  manualVerification?: {
    externallyVerified: boolean;
    verifiedByUserId: string;
  };
}

export interface SaleConfirmationDeferredOrderInput {
  idempotencyKey: string;
  deliveryMethod: DeliveryMethod;
  transportMode: TransportMode;
  deliveryAddress?: AddressSnapshot;
  storePickupContact?: StorePickupContactSnapshot;
  notificationContact?: OrderNotificationContact;
}

export interface ConfirmSaleInput {
  confirmationId: string;
  tenantId: string;
  branchId: string;
  cashierUserId: string;
  cashShiftId: string;
  customerId?: string;
  sourceOrderId?: string;
  deferredOrder?: SaleConfirmationDeferredOrderInput;
  items: Array<CreateSaleItemInput & { inventoryQuantity?: number }>;
  document?: SaleDocumentSnapshot;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  payments: SaleConfirmationPaymentInput[];
}

export interface ConfirmSaleResult {
  sale: Sale;
  payments: Payment[];
  inventoryMovements: InventoryMovement[];
  cashMovement?: CashMovement;
  order?: Order;
  pickingOrder?: PickingOrder;
  idempotent: boolean;
}

export interface SaleConfirmationRepository {
  confirm(input: ConfirmSaleInput): Promise<ConfirmSaleResult>;
}
