/**
 * Lista cerrada de marcas de tarjeta reales aceptadas al guardar un
 * método de pago. Antes "Marca" era texto libre (aceptaba "casa" o
 * cualquier cosa) -- se reemplaza por un selector para que ni siquiera
 * sea posible escribir un valor que no sea una marca real.
 */
export const CARD_BRANDS = [
  "Visa",
  "Mastercard",
  "American Express",
  "Discover",
] as const;

export type CardBrand = (typeof CARD_BRANDS)[number];

/** Marcas aceptadas por el checkout público mientras no haya una pasarela de pago. */
export const STOREFRONT_CARD_BRANDS = ["Visa", "Mastercard", "American Express"] as const;

export type StorefrontCardBrand = (typeof STOREFRONT_CARD_BRANDS)[number];

export function detectStorefrontCardBrand(digits: string): StorefrontCardBrand | null {
  if (digits.startsWith("4")) return "Visa";
  if (/^5[1-5]/.test(digits)) return "Mastercard";
  if (digits.length >= 4) {
    const mastercardPrefix = Number(digits.slice(0, 4));
    if (mastercardPrefix >= 2221 && mastercardPrefix <= 2720) return "Mastercard";
  }
  if (/^3[47]/.test(digits)) return "American Express";
  return null;
}

export function validateStorefrontCardNumber(digits: string): string | null {
  if (!digits) return null;
  const brand = detectStorefrontCardBrand(digits);
  if (!brand) {
    return digits.length >= 4
      ? "Solo se aceptan tarjetas Visa, Mastercard o American Express."
      : null;
  }

  const validLengths = getStorefrontCardNumberLengths(brand);
  if (digits.length < Math.min(...validLengths)) return null;
  if (!validLengths.includes(digits.length)) {
    return "El número de tarjeta no es válido.";
  }
  if (!passesLuhnCheck(digits)) return "El número de tarjeta no es válido.";
  return null;
}

export function getStorefrontCardNumberLengths(brand: StorefrontCardBrand): number[] {
  return brand === "Visa" ? [13, 16, 19] : brand === "Mastercard" ? [16] : [15];
}

export function getStorefrontCardSecurityCodeLength(brand: StorefrontCardBrand | null): number {
  return brand === "American Express" ? 4 : 3;
}

function passesLuhnCheck(digits: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

/**
 * Margen maximo de vigencia para el año de expiracion, sin importar la
 * marca (la vigencia real depende del emisor, pero ninguna red emite una
 * tarjeta con una vigencia mayor a esto) -- antes solo se rechazaba una
 * fecha YA vencida, asi que un año como "2240" pasaba sin problema por no
 * estar en el pasado.
 */
export const MAX_EXPIRATION_YEARS_AHEAD = 20;

/** Largo maximo del nombre en la tarjeta: el mismo limite que aplica el backend. */
export const CARDHOLDER_NAME_MAX_LENGTH = 60;
