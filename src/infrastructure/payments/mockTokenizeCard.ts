import {
  detectStorefrontCardBrand,
  getStorefrontCardSecurityCodeLength,
  type StorefrontCardBrand,
} from "@/config/card-brands";
import { isCardNumberComplete } from "@/config/card-input-policy";

export interface MockCardTokenizationInput {
  cardNumber: string;
  cardholderName?: string;
  expirationMonth: number;
  expirationYear: number;
  cvv: string;
}

export interface MockCardTokenizationResult {
  providerPaymentMethodId: string;
  brand: StorefrontCardBrand;
  last4: string;
  expirationMonth: number;
  expirationYear: number;
  cardholderName?: string;
}

/**
 * Simula la tokenizacion de una pasarela: recibe el numero completo y el CVV y
 * devuelve solo datos no sensibles. La marca usa los mismos nombres que
 * CARD_BRANDS ("Visa", "Mastercard", "American Express"); cualquier otra se
 * rechaza. Los errores nunca incluyen el numero ni el CVV.
 */
export function mockTokenizeCard(input: MockCardTokenizationInput): MockCardTokenizationResult {
  const digits = input.cardNumber.replace(/\D/g, "");
  const brand = detectStorefrontCardBrand(digits);
  if (!brand) {
    throw new Error("Solo se aceptan tarjetas Visa, Mastercard o American Express.");
  }
  if (!isCardNumberComplete(digits)) {
    throw new Error("El número de tarjeta no es válido.");
  }
  const securityCodeLength = getStorefrontCardSecurityCodeLength(brand);
  if (!new RegExp(String.raw`^\d{${securityCodeLength}}$`).test(input.cvv)) {
    throw new Error(`Ingresa un código de seguridad de ${securityCodeLength} dígitos.`);
  }

  return {
    providerPaymentMethodId: `pm_demo_${crypto.randomUUID()}`,
    brand,
    last4: digits.slice(-4),
    expirationMonth: input.expirationMonth,
    expirationYear: input.expirationYear,
    cardholderName: input.cardholderName,
  };
}
