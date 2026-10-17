/**
 * Limite de largo canonico para campos de nombre libre -- reutilizado por
 * Profile.name y PaymentMethod.cardholderName. Antes ninguno de estos
 * campos tenia limite (ni en el input ni en la validacion funcional), lo
 * que permitia guardar strings arbitrariamente largos. Mismo criterio que
 * las password policies en auth-policy.ts y PHONE_POLICY en contact-policy.ts:
 * una sola funcion, un solo lugar para cambiarla.
 *
 * Las direcciones (label/recipientName/line1/line2/references) tienen su
 * propia politica mas estricta -- ver config/delivery-address-policy.ts
 * (limites por campo + caracteres permitidos), no duplicar esas reglas
 * aca.
 */
export const TEXT_FIELD_POLICY = {
  NAME_MAX_LENGTH: 100,
} as const;

export function validateMaxLength(
  value: string,
  max: number,
  fieldLabel: string,
): string | null {
  if (value.trim().length > max) {
    return `${fieldLabel} no puede superar ${max} caracteres.`;
  }
  return null;
}
