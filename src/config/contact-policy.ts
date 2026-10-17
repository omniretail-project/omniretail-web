/**
 * Regla canónica de teléfono, reutilizada por registro (register.
 * validation.ts) y por editar perfil (profile.validation.ts) -- antes
 * cada uno duplicaba a mano "largo >= 8, sin más formato", lo que
 * dejaba pasar letras/símbolos (ej. "abcdefgh" pasaba el chequeo).
 * Mismo patrón que validatePasswordAgainstPolicy en auth-policy.ts: una
 * sola función, un solo lugar para cambiarla.
 *
 * DIGITS fijo en 8: en Guatemala todos los números (fijos y celulares)
 * tienen exactamente 8 dígitos, sin código de área -- no es un rango
 * "entre 8 y 15", es un largo exacto.
 *
 * El teléfono sigue siendo OPCIONAL en ambos formularios -- esta
 * función solo valida el formato SI se escribió algo; que el campo sea
 * requerido o no lo decide cada formulario.
 */
export const PHONE_POLICY = {
  DIGITS: 8,
} as const;

export function validatePhoneNumber(phone: string): string | null {
  const trimmed = phone.trim();
  if (!trimmed) return null;

  if (!/^\d+$/.test(trimmed)) return "El teléfono solo puede contener números.";
  if (trimmed.length !== PHONE_POLICY.DIGITS) {
    return `El teléfono debe tener exactamente ${PHONE_POLICY.DIGITS} dígitos.`;
  }
  return null;
}
