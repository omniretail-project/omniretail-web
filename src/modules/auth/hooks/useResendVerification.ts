"use client";

import { useCallback, useState } from "react";
import { EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS } from "@/config/auth-policy";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useOptionalPublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";
import { useCooldown } from "@/shared/hooks/useCooldown";
import { validateRequestPasswordResetForm } from "@/modules/auth/validation/requestPasswordReset.validation";

/**
 * "¿No te llegó el correo? Reenviar" (cuentas de cliente pendientes de verificar). La tienda sale
 * del storefront publico, igual que en el registro; nunca de un dato que escriba el usuario.
 *
 * El resultado es SIEMPRE el mismo mensaje generico (exista o no la cuenta, falle o no la red):
 * `resendEmailVerification` nunca lanza. Despues de cada envio el boton queda deshabilitado
 * EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS segundos; el limite real lo aplica el backend.
 */
export function useResendVerification() {
  const repositories = useRepositories();
  const tenantSlug = useOptionalPublicTenant()?.tenantSlug;
  const { remaining, active, start } = useCooldown(EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS);
  const [sent, setSent] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [emailError, setEmailError] = useState<string | undefined>();

  const resend = useCallback(
    async (email: string) => {
      if (active || isSending) return;
      // Misma validacion de correo (obligatorio + formato) que la recuperacion de contraseña.
      const errors = validateRequestPasswordResetForm({ email });
      setEmailError(errors.email);
      if (errors.email) return;

      setIsSending(true);
      try {
        // Sin tienda resuelta no hay a quien pedirle el reenvio; la respuesta es la misma.
        if (tenantSlug) {
          await repositories.auth.resendEmailVerification({ email: email.trim(), tenantSlug });
        }
      } finally {
        setIsSending(false);
        setSent(true);
        start();
      }
    },
    [active, isSending, repositories, start, tenantSlug],
  );

  return {
    resend,
    sent,
    isSending,
    emailError,
    cooldownSeconds: remaining,
    coolingDown: active,
  };
}
