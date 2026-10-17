import type { CustomerPaymentMethodStatus, PaymentMethod } from "@/core/enums";
import type { ISODateString } from "@/core/types/common.types";

export interface CustomerPaymentMethod {
  id: string;
  tenantId: string;
  customerId: string;
  type: PaymentMethod.card;
  /**
   * Token del proveedor de pagos. Opcional porque el backend nunca lo expone (no sale del
   * servidor); solo el mock lo genera.
   */
  providerPaymentMethodId?: string;
  brand: string;
  issuingBank: string;
  last4: string;
  expirationMonth: number;
  expirationYear: number;
  cardholderName?: string;
  isDefault: boolean;
  status: CustomerPaymentMethodStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
