import { TEXT_FIELD_POLICY } from "@/config/text-field-policy";

/**
 * Regla canonica de nombres de persona (registro de clientes y destinatario de entregas): solo letras
 * Unicode con sus marcas (acentos, ñ), separadas por un unico espacio, apostrofo o guion. Rechaza HTML,
 * digitos, simbolos, caracteres de control e invisibles (ancho cero, overrides bidi) y saltos de linea.
 * El backend aplica la misma expresion (CustomerRegistrationService); si cambia aqui, cambia alla.
 */
export const PERSON_NAME_PATTERN = /^\p{L}[\p{L}\p{M}]*(?:[ '-][\p{L}\p{M}]+)*$/u;
export const TYPOGRAPHIC_APOSTROPHES = /[’‘´`]/gu;
export const TYPOGRAPHIC_DASHES = /[‐‑‒–—]/gu;

/**
 * Forma canonica antes de validar y guardar: NFC (una "é" escrita como e + acento combinado queda
 * como un solo caracter), apostrofos y guiones tipograficos a ASCII, y espacios normales repetidos a
 * uno solo. No quita caracteres no permitidos: un nombre invalido se rechaza, nunca se recorta en
 * silencio.
 */
export function normalizePersonName(value: string): string {
  return value
    .normalize("NFC")
    .replace(TYPOGRAPHIC_APOSTROPHES, "'")
    .replace(TYPOGRAPHIC_DASHES, "-")
    .trim()
    .replace(/ {2,}/g, " ");
}

export const CUSTOMER_NAME_MESSAGES = {
  required: "El nombre es obligatorio.",
  tooLong: `El nombre no puede superar ${TEXT_FIELD_POLICY.NAME_MAX_LENGTH} caracteres.`,
  invalid: "El nombre solo puede contener letras, espacios, apóstrofos y guiones.",
} as const;

/**
 * Nombre del registro de clientes. Recibe el valor YA normalizado (normalizePersonName) y devuelve el
 * mensaje de error, o null. Mismos mensajes que CustomerRegistrationService en el backend.
 */
export function validateCustomerName(normalized: string): string | null {
  if (!normalized) return CUSTOMER_NAME_MESSAGES.required;
  if (normalized.length > TEXT_FIELD_POLICY.NAME_MAX_LENGTH) return CUSTOMER_NAME_MESSAGES.tooLong;
  return PERSON_NAME_PATTERN.test(normalized) ? null : CUSTOMER_NAME_MESSAGES.invalid;
}
