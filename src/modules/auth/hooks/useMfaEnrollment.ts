"use client";

import { useCallback, useEffect, useState } from "react";
import type { MfaMethod } from "@/core/entities";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

/**
 * Enrolamiento de MFA para Employee/Admin (PR13). Equivalente a
 * modules/customer/hooks/useMfaEnrollment.ts -- AuthRepository ya es
 * agnóstico a UserType para todo esto, igual que changePassword() desde
 * PR12; cada módulo tiene su propio hook para no acoplar auth a
 * modules/customer.
 */
/**
 * Metodos que el backend todavia no soporta (se muestran como "Próximamente"). Hoy TOTP y correo
 * estan disponibles en ambos modos.
 */
const UNAVAILABLE_METHODS: readonly MfaMethod[] = [];

export function useMfaEnrollment() {
  const repositories = useRepositories();
  const [status, setStatus] = useState<{ enabled: boolean; method: MfaMethod } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const sessionId = await repositories.auth.getCurrentSessionId();
      const next = sessionId ? await repositories.auth.getMfaStatus(sessionId) : null;
      setStatus(next);
    } finally {
      setLoading(false);
    }
  }, [repositories]);

  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => {
      if (!active) return;
      void reload();
    });
    return () => {
      active = false;
    };
  }, [reload]);

  // "mfa.changed", NO "auth.changed" -- ver DataEventName
  // (core/types/events.types.ts): auth.changed lo escucha tambien
  // CurrentSessionProvider (recarga user/role), y eso hace que
  // RequireSession muestre "Cargando sesion..." un instante, remontando
  // el subarbol y perdiendo el paso actual del wizard de MFA.
  useDataEvent("mfa.changed", reload);

  const requireSessionId = useCallback(async () => {
    const sessionId = await repositories.auth.getCurrentSessionId();
    if (!sessionId) {
      throw new Error("Tu sesión ya no es válida. Vuelve a iniciar sesión.");
    }
    return sessionId;
  }, [repositories]);

  const begin = useCallback(
    async (method: MfaMethod) => {
      setBusy(true);
      try {
        const sessionId = await requireSessionId();
        return await repositories.auth.beginMfaEnrollment(sessionId, method);
      } finally {
        setBusy(false);
      }
    },
    [repositories, requireSessionId],
  );

  const verify = useCallback(
    async (code: string) => {
      setBusy(true);
      try {
        const sessionId = await requireSessionId();
        return await repositories.auth.verifyMfaEnrollment(sessionId, code);
      } finally {
        setBusy(false);
      }
    },
    [repositories, requireSessionId],
  );

  const disable = useCallback(
    async (currentPassword: string) => {
      setBusy(true);
      try {
        const sessionId = await requireSessionId();
        await repositories.auth.disableMfa(sessionId, currentPassword);
      } finally {
        setBusy(false);
      }
    },
    [repositories, requireSessionId],
  );

  /**
   * Con el MFA por correo activo, envia un codigo para el cambio de contraseña. En mock devuelve el
   * codigo de demostracion para mostrarlo en pantalla.
   */
  const sendActionCode = useCallback(async () => {
    const sessionId = await requireSessionId();
    return repositories.auth.requestMfaActionCode(sessionId);
  }, [repositories, requireSessionId]);

  return {
    status,
    loading,
    busy,
    begin,
    verify,
    disable,
    sendActionCode,
    unavailableMethods: UNAVAILABLE_METHODS,
  };
}
