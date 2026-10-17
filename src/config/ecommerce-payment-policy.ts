import { PaymentMethod } from "@/core/enums";

const immediateMockPaymentMethods: readonly PaymentMethod[] = [PaymentMethod.card];

export const ecommercePaymentPolicy = {
  allowedMethods: immediateMockPaymentMethods,
  isImmediateMockMethod(method: PaymentMethod): boolean {
    return immediateMockPaymentMethods.includes(method);
  },
};
