import {
  detectStorefrontCardBrand,
  getStorefrontCardSecurityCodeLength,
  validateStorefrontCardNumber,
} from "@/config/card-brands";
import {
  getCardExpirationError,
  getCardholderNameError,
  isCardNumberComplete,
} from "@/config/card-input-policy";
import { GUATEMALA_BANKS } from "@/config/guatemala-banks";
import type { PaymentMethodFormDto } from "@/modules/customer/application/dto/PaymentMethodFormDto";

export type PaymentMethodFormMode = "create" | "edit";

export type PaymentMethodValidationErrors = Partial<
  Record<"cardNumber" | "cardholderName" | "expiration" | "cvv" | "issuingBank", string>
>;

/**
 * Mismas reglas que el checkout (card-brands + card-input-policy): numero de
 * una marca aceptada que pasa Luhn, tarjeta no vencida en formato MM/AA y CVV
 * del largo de la marca (4 para American Express). El titular es obligatorio
 * al crear, igual que en el checkout; al editar sigue opcional para no
 * bloquear tarjetas antiguas sin titular, pero si se escribe se valida.
 * Al editar no se validan numero, CVV ni banco: no son editables.
 */
export function validatePaymentMethodForm(
  dto: PaymentMethodFormDto,
  mode: PaymentMethodFormMode,
): PaymentMethodValidationErrors {
  const errors: PaymentMethodValidationErrors = {};

  if (mode === "create") {
    const digits = dto.cardNumber.replace(/\D/g, "");
    if (!digits) {
      errors.cardNumber = "Ingrese el número de tarjeta.";
    } else if (!isCardNumberComplete(digits)) {
      errors.cardNumber =
        validateStorefrontCardNumber(digits) ??
        "Completa un número de tarjeta Visa, Mastercard o American Express.";
    }

    const securityCodeLength = getStorefrontCardSecurityCodeLength(detectStorefrontCardBrand(digits));
    if (!new RegExp(String.raw`^\d{${securityCodeLength}}$`).test(dto.cvv)) {
      errors.cvv = `Ingresa un código de seguridad de ${securityCodeLength} dígitos.`;
    }

    if (!dto.issuingBank.trim()) {
      errors.issuingBank = "El banco emisor es obligatorio.";
    } else if (!GUATEMALA_BANKS.includes(dto.issuingBank as (typeof GUATEMALA_BANKS)[number])) {
      errors.issuingBank = "Selecciona un banco emisor válido.";
    }
  }

  const cardholderNameError = getCardholderNameError(dto.cardholderName, mode === "create");
  if (cardholderNameError) errors.cardholderName = cardholderNameError;

  const expirationError = getCardExpirationError(dto.expiration);
  if (expirationError) errors.expiration = expirationError;

  return errors;
}

export function hasPaymentMethodValidationErrors(errors: PaymentMethodValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}
