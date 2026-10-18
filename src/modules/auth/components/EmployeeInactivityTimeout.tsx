"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { SESSION_POLICY } from "@/config/session-policy";
import { UserType } from "@/core/enums";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { employeeActivityStore } from "@/infrastructure/storage/employeeActivityStore";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";

/** Sale de SESSION_POLICY (fuente canonica, mismo valor que el backend): no repetir el numero. */
export const EMPLOYEE_INACTIVITY_TIMEOUT_MS = SESSION_POLICY.employee.inactivityExpirationMinutes * 60 * 1000;

/** La actividad se guarda como maximo cada 10 s: scroll/pointerdown se disparan sin parar. */
export const EMPLOYEE_ACTIVITY_WRITE_INTERVAL_MS = 10 * 1000;

const activityEvents = ["keydown", "pointerdown", "scroll", "touchstart"] as const;

/**
 * Marca guardada que cuenta para esta sesion: una anterior al inicio de la sesion (o sin inicio
 * conocido) es de una sesion previa y se ignora, para no cerrar un login recien hecho.
 */
export function storedActivityForSession(
  stored: number | null,
  sessionStartedAt: number | null,
): number | null {
  if (stored === null || sessionStartedAt === null) return null;
  return stored >= sessionStartedAt ? stored : null;
}

/**
 * Protege el área operativa cerrando la sesión tras el tiempo de inactividad de SESSION_POLICY.
 * Solo se monta dentro de las rutas privadas de empleados y administradores.
 *
 * La ultima actividad se comparte entre pestañas (`employeeActivityStore`): la actividad en una
 * cuenta para todas, y al montar o volver a la pestaña se cierra la sesion si se supero ese tiempo
 * aunque la pestaña haya estado cerrada. Cerrar por inactividad borra la marca, y las
 * demas pestañas cierran tambien.
 */
export function EmployeeInactivityTimeout() {
  const { user, sessionId } = useCurrentSession();
  const repositories = useRepositories();
  const router = useRouter();
  const lastActivityAtRef = useRef(0);
  const lastWriteAtRef = useRef(0);
  const sessionStartedAtRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);

  const closeSession = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    employeeActivityStore.clear();

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

  /** Toma la marca de otra pestaña si es mas reciente que la propia. */
  const adoptStoredActivity = useCallback(() => {
    const stored = storedActivityForSession(employeeActivityStore.read(), sessionStartedAtRef.current);
    if (stored !== null && stored > lastActivityAtRef.current) {
      lastActivityAtRef.current = stored;
    }
  }, []);

  useEffect(() => {
    if (user?.type !== UserType.employee) return;

    let active = true;
    lastActivityAtRef.current = Date.now();
    // Sin escrituras hasta revisar la marca guardada: la actividad de estos milisegundos no puede
    // pisar una marca vieja que deberia cerrar la sesion.
    lastWriteAtRef.current = Number.POSITIVE_INFINITY;
    sessionStartedAtRef.current = null;
    closingRef.current = false;
    scheduleTimeout();

    // Al montar: la marca guardada (quizas de una pestaña ya cerrada) decide si la sesion sigue.
    void (async () => {
      let sessionStartedAt: number | null = null;
      try {
        const session = sessionId ? await repositories.auth.getSession(sessionId) : null;
        const parsed = session ? Date.parse(session.createdAt) : Number.NaN;
        sessionStartedAt = Number.isFinite(parsed) ? parsed : null;
      } catch {
        sessionStartedAt = null;
      }
      if (!active) return;
      sessionStartedAtRef.current = sessionStartedAt;
      const stored = storedActivityForSession(employeeActivityStore.read(), sessionStartedAt);
      if (stored === null) {
        // Sin marca valida de esta sesion: se empieza a contar desde ahora.
        lastWriteAtRef.current = lastActivityAtRef.current;
        employeeActivityStore.write(lastActivityAtRef.current);
      } else {
        lastWriteAtRef.current = stored;
        lastActivityAtRef.current = stored;
      }
      scheduleTimeout();
    })();

    const recordActivity = () => {
      const now = Date.now();
      lastActivityAtRef.current = now;
      if (now - lastWriteAtRef.current >= EMPLOYEE_ACTIVITY_WRITE_INTERVAL_MS) {
        lastWriteAtRef.current = now;
        employeeActivityStore.write(now);
      }
      scheduleTimeout();
    };
    const validateAfterVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        adoptStoredActivity();
        scheduleTimeout();
      }
    };
    const unsubscribe = employeeActivityStore.subscribe((timestamp) => {
      if (timestamp === null) {
        // Otra pestaña cerro la sesion por inactividad.
        void closeSession();
        return;
      }
      if (timestamp > lastActivityAtRef.current) {
        lastActivityAtRef.current = timestamp;
        scheduleTimeout();
      }
    });

    for (const eventName of activityEvents) {
      window.addEventListener(eventName, recordActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", validateAfterVisibilityChange);

    return () => {
      active = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      unsubscribe();
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, recordActivity);
      }
      document.removeEventListener("visibilitychange", validateAfterVisibilityChange);
    };
  }, [adoptStoredActivity, closeSession, repositories, scheduleTimeout, sessionId, user?.type]);

  return null;
}
