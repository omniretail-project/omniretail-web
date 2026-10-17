"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { UserType } from "@/core/enums";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";

export const EMPLOYEE_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

const activityEvents = ["keydown", "pointerdown", "scroll", "touchstart"] as const;

/**
 * Protege el área operativa cerrando la sesión tras 30 minutos sin actividad.
 * Solo se monta dentro de las rutas privadas de empleados y administradores.
 */
export function EmployeeInactivityTimeout() {
  const { user } = useCurrentSession();
  const repositories = useRepositories();
  const router = useRouter();
  const lastActivityAtRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);

  const closeSession = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;

    try {
      const sessionId = await repositories.auth.getCurrentSessionId();
      if (sessionId) {
        await repositories.auth.logout(sessionId);
      }
    } finally {
      try {
        await repositories.auth.clearLocalSession();
      } finally {
        router.replace("/iniciar-sesion");
      }
    }
  }, [repositories, router]);

  const scheduleTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    const elapsed = Date.now() - lastActivityAtRef.current;
    const remaining = Math.max(0, EMPLOYEE_INACTIVITY_TIMEOUT_MS - elapsed);

    timeoutRef.current = setTimeout(() => {
      void closeSession();
    }, remaining);
  }, [closeSession]);

  useEffect(() => {
    if (user?.type !== UserType.employee) return;

    lastActivityAtRef.current = Date.now();
    closingRef.current = false;
    scheduleTimeout();

    const recordActivity = () => {
      lastActivityAtRef.current = Date.now();
      scheduleTimeout();
    };
    const validateAfterVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleTimeout();
      }
    };

    for (const eventName of activityEvents) {
      window.addEventListener(eventName, recordActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", validateAfterVisibilityChange);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, recordActivity);
      }
      document.removeEventListener("visibilitychange", validateAfterVisibilityChange);
    };
  }, [scheduleTimeout, user?.type]);

  return null;
}
