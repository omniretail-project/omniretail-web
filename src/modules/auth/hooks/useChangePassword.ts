"use client";

import { useCallback, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import type { ChangePasswordFormDto } from "@/modules/auth/application/dto/ChangePasswordFormDto";

/**
 * Equivalente a modules/customer/hooks/useChangePassword.ts, para
 * Employee/Admin. AuthRepository.changePassword() opera unicamente sobre
 * sessionId -> AuthAccount -> User, sin distinguir UserType -- el mismo
 * flujo de seguridad (reautenticacion con password actual, politica de
 * password, revocacion de las demas sesiones) aplica igual para Customer
 * y Employee, sin cambios en la capa funcional.
 */
export function useChangePassword() {
  const repositories = useRepositories();
  const [busy, setBusy] = useState(false);

  const changePassword = useCallback(
    async (dto: ChangePasswordFormDto) => {
      setBusy(true);
      try {
        const sessionId = await repositories.auth.getCurrentSessionId();
        if (!sessionId) {
          throw new Error("Tu sesión ya no es válida. Vuelve a iniciar sesión.");
        }
        await repositories.auth.changePassword({
          sessionId,
          currentPasswordMock: dto.currentPassword,
          newPasswordMock: dto.newPassword,
          mfaCodeMock: dto.mfaCode,
        });
      } finally {
        setBusy(false);
      }
    },
    [repositories],
  );

  return { busy, changePassword };
}
