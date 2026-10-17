/**
 * Límites y caracteres permitidos para direcciones de entrega. Se usan tanto
 * en los formularios como en los límites autoritativos, para que una petición
 * directa no pueda guardar texto que la interfaz no permite capturar.
 */
export const DELIVERY_ADDRESS_LIMITS = {
  label: 35,
  recipientName: 60,
  line1: 200,
  line2: 200,
  references: 300,
} as const;

const PERSON_NAME_CHARACTERS = /[^\p{L}\p{M} '-]/gu;
const TYPOGRAPHIC_APOSTROPHES = /[’‘´`]/gu;
const TYPOGRAPHIC_DASHES = /[‐‑‒–—]/gu;
const PERSON_NAME_PATTERN = /^\p{L}[\p{L}\p{M}]*(?:[ '-][\p{L}\p{M}]+)*$/u;
const ADDRESS_LINE_CHARACTERS = /[^\p{L}\p{N} .,#'/-]/gu;
const ADDRESS_COMPLEMENT_CHARACTERS = /[^\p{L}\p{N} .,#'/-]/gu;
const ADDRESS_REFERENCE_CHARACTERS = /[^\p{L}\p{N} .,#'/-]/gu;
const REPEATED_ADDRESS_PUNCTUATION = /([.,#'/-])\1+/gu;
const ADJACENT_ADDRESS_PUNCTUATION = /[.,#'/-]{2,}/u;
const ADJACENT_ADDRESS_PUNCTUATION_REPLACEMENT = /[.,#'/-]{2,}/gu;

function normalizeSpaces(value: string): string {
  return value.replace(/\s{2,}/g, " ");
}

export function sanitizeRecipientName(value: string): string {
  return normalizeSpaces(
    value
      .normalize("NFC")
      .replace(TYPOGRAPHIC_APOSTROPHES, "'")
      .replace(TYPOGRAPHIC_DASHES, "-")
      .replace(PERSON_NAME_CHARACTERS, ""),
  ).slice(0, DELIVERY_ADDRESS_LIMITS.recipientName);
}

export function sanitizeDeliveryAddress(value: string, field: "line1" | "line2" | "references"): string {
  const characters =
    field === "line1"
      ? ADDRESS_LINE_CHARACTERS
      : field === "line2"
        ? ADDRESS_COMPLEMENT_CHARACTERS
        : ADDRESS_REFERENCE_CHARACTERS;
  return normalizeSpaces(
    value
      .replace(characters, "")
      .replace(REPEATED_ADDRESS_PUNCTUATION, "$1")
      .replace(ADJACENT_ADDRESS_PUNCTUATION_REPLACEMENT, (sequence) => sequence.at(-1) ?? ""),
  ).slice(0, DELIVERY_ADDRESS_LIMITS[field]);
}

export function isValidRecipientName(value: string): boolean {
  return (
    value.length <= DELIVERY_ADDRESS_LIMITS.recipientName &&
    PERSON_NAME_PATTERN.test(value.trim())
  );
}

export function isValidDeliveryAddress(
  value: string,
  field: "line1" | "line2" | "references",
): boolean {
  if (value.length > DELIVERY_ADDRESS_LIMITS[field]) return false;
  if (!value) return true;
  const normalized = value.trim();
  return (
    /^[\p{L}\p{N}](?:[\p{L}\p{N} .,#'/-]*[\p{L}\p{N}])?$/u.test(normalized) &&
    !ADJACENT_ADDRESS_PUNCTUATION.test(normalized)
  );
}

/** Correo de notificaciones: formato interoperable para los servicios de entrega. */
export function sanitizeDeliveryNotificationEmail(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._@-]/g, "").slice(0, 254);
  const [localPart = "", ...domainParts] = sanitized.split("@");
  return domainParts.length ? `${localPart}@${domainParts.join("")}` : localPart;
}

export function isValidDeliveryNotificationEmail(value: string): boolean {
  if (value.length > 254 || value.split("@").length !== 2) return false;
  const [localPart, domain] = value.split("@");
  if (!localPart || !domain || localPart.length > 64) return false;
  const localLabels = localPart.split(".");
  if (
    !localLabels.every((label) =>
      /^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/.test(label),
    )
  ) {
    return false;
  }
  const labels = domain.split(".");
  if (labels.length < 2 || !/^[A-Za-z]{2,63}$/.test(labels.at(-1) ?? "")) return false;
  return labels.slice(0, -1).every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
}
