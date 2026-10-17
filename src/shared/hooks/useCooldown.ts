"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Cuenta regresiva de UI (p. ej. "Reenviar código" deshabilitado unos segundos despues de cada
 * envio). Solo presentacion: el limite real lo aplica quien recibe la accion (el backend o el mock).
 */
export function useCooldown(seconds: number) {
  const [until, setUntil] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      const next = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setRemaining(next);
      if (next === 0) setUntil(null);
    };
    window.queueMicrotask(tick);
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [until]);

  const start = useCallback(() => {
    setRemaining(seconds);
    setUntil(Date.now() + seconds * 1000);
  }, [seconds]);

  const reset = useCallback(() => {
    setUntil(null);
    setRemaining(0);
  }, []);

  return { remaining, active: remaining > 0, start, reset };
}
