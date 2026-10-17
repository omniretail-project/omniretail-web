import {
  CARDHOLDER_NAME_MAX_LENGTH,
  detectStorefrontCardBrand,
  getStorefrontCardNumberLengths,
  MAX_EXPIRATION_YEARS_AHEAD,
  validateStorefrontCardNumber,
} from "@/config/card-brands";
import { validateMaxLength } from "@/config/text-field-policy";

const CARDHOLDER_NAME_DISALLOWED_CHARACTERS = /[^\p{L}\p{M} '-]/gu;
const CARDHOLDER_NAME_PATTERN = /^\p{L}[\p{L}\p{M}]*(?:[ '-][\p{L}\p{M}]+)*$/u;

/**
 * Formato y validacion de los campos de una tarjeta nueva, compartidos por el
 * checkout publico y "Mis metodos de pago". Solo transforman texto: el numero
 * completo y el CVV nunca salen del estado de la pantalla que los captura.
 */

/** Agrupa el numero 4-4-4-4 (4-6-5 para American Express). */
export function formatCardNumber(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 19);
  if (detectStorefrontCardBrand(digits) === "American Express") {
    return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15)]
      .filter(Boolean)
      .join(" ");
  }
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

export function formatCardExpiration(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

/** "MM/AA" a mes y año de cuatro digitos; null si el formato no es valido. */
export function parseCardExpiration(value: string): { month: number; year: number } | null {
  const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(value);
  if (!match) return null;
  return { month: Number(match[1]), year: 2000 + Number(match[2]) };
}

export function getCardExpirationError(value: string): string | null {
  const expiration = parseCardExpiration(value);
  if (!expiration) return "Ingresa una fecha válida en formato MM/AA.";

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (
    expiration.year < currentYear ||
    (expiration.year === currentYear && expiration.month < currentMonth)
  ) {
    return "La tarjeta está vencida.";
  }
  if (expiration.year > currentYear + MAX_EXPIRATION_YEARS_AHEAD) {
    return "Ingresa una fecha de vencimiento válida.";
  }
  return null;
}

/**
 * Nombre del titular: solo letras, espacios, guiones y apostrofes (lo que
 * imprime una tarjeta), hasta CARDHOLDER_NAME_MAX_LENGTH -- el mismo limite
 * que aplica el backend.
 */
export function sanitizeCardholderName(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[’‘´`]/gu, "'")
    .replace(/[‐‑‒–—]/gu, "-")
    .replace(CARDHOLDER_NAME_DISALLOWED_CHARACTERS, "")
    .replace(/\s{2,}/g, " ")
    .slice(0, CARDHOLDER_NAME_MAX_LENGTH);
}

/** `required`: al registrar una tarjeta nueva el titular es obligatorio, como en el checkout. */
export function getCardholderNameError(value: string, required: boolean): string | null {
  const name = value.trim();
  if (!name) return required ? "Ingrese el nombre del titular." : null;
  const lengthError = validateMaxLength(value, CARDHOLDER_NAME_MAX_LENGTH, "El nombre del titular");
  if (lengthError) return lengthError;
  if (!CARDHOLDER_NAME_PATTERN.test(name)) {
    return "El nombre del titular solo permite letras, espacios, guiones y apóstrofes.";
  }
  return null;
}

/** Numero de una marca aceptada, con el largo de esa marca y que pasa Luhn. */
export function isCardNumberComplete(digits: string): boolean {
  const brand = detectStorefrontCardBrand(digits);
  return (
    brand !== null &&
    getStorefrontCardNumberLengths(brand).includes(digits.length) &&
    !validateStorefrontCardNumber(digits)
  );
}
