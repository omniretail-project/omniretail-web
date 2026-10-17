import type { CustomerPaymentMethod } from "@/core/entities";
import { CustomerPaymentMethodStatus, PaymentMethod } from "@/core/enums";
import type { CreateCustomerPaymentMethodInput } from "@/core/repositories";

/**
 * PaymentMethodResponse del backend (`/me/payment-methods`). No trae `providerPaymentMethodId`:
 * el token del proveedor nunca sale del servidor. `status` siempre es `active` (una tarjeta
 * eliminada se borra, no se archiva).
 */
export interface ApiCustomerPaymentMethod {
  id: string;
  tenantId: string;
  customerId: string;
  type: string;
  brand: string;
  issuingBank: string;
  last4: string;
  expirationMonth: number;
  expirationYear: number;
  cardholderName: string | null;
  isDefault: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * CreatePaymentMethodRequest del backend. Nunca el numero completo ni el CVV; tampoco
 * `providerPaymentMethodId`, `isDefault`, `tenantId` ni `customerId` (cualquier campo extra es 400).
 */
export interface ApiCreatePaymentMethodRequest {
  brand: string;
  issuingBank: string;
  last4: string;
  expirationMonth: number;
  expirationYear: number;
  cardholderName?: string;
}

/** UpdatePaymentMethodRequest del backend: solo titular y vencimiento (un titular ausente lo borra). */
export interface ApiUpdatePaymentMethodRequest {
  expirationMonth: number;
  expirationYear: number;
  cardholderName?: string;
}

/** `providerPaymentMethodId` queda sin definir: nunca se inventa. */
export function toCustomerPaymentMethod(method: ApiCustomerPaymentMethod): CustomerPaymentMethod {
  return {
    id: method.id,
    tenantId: method.tenantId,
    customerId: method.customerId,
    type: PaymentMethod.card,
    brand: method.brand,
    issuingBank: method.issuingBank,
    last4: method.last4,
    expirationMonth: method.expirationMonth,
    expirationYear: method.expirationYear,
    cardholderName: method.cardholderName ?? undefined,
    isDefault: method.isDefault,
    status: CustomerPaymentMethodStatus.active,
    createdAt: method.createdAt,
    updatedAt: method.updatedAt,
  };
}

/** Allowlist explicita: aunque el input traiga mas campos en runtime, solo estos viajan. */
export function toCreatePaymentMethodRequest(
  input: CreateCustomerPaymentMethodInput,
): ApiCreatePaymentMethodRequest {
  return {
    brand: input.brand,
    issuingBank: input.issuingBank,
    last4: input.last4,
    expirationMonth: input.expirationMonth,
    expirationYear: input.expirationYear,
    cardholderName: input.cardholderName,
  };
}

export function toUpdatePaymentMethodRequest(
  method: Pick<CustomerPaymentMethod, "cardholderName" | "expirationMonth" | "expirationYear">,
): ApiUpdatePaymentMethodRequest {
  return {
    expirationMonth: method.expirationMonth,
    expirationYear: method.expirationYear,
    cardholderName: method.cardholderName,
  };
}
