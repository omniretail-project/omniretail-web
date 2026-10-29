"use client";

import { useEffect, useRef } from "react";

interface UseVisiblePollingOptions {
  /** Pausa entre consultas mientras la pestana esta visible. */
  intervalMs: number;
  /** Con false no hay temporizador ni escucha de visibilidad. */
  enabled: boolean;
  /** Consulta inmediata cuando el usuario vuelve a la pestana. Por defecto true. */
  runOnVisible?: boolean;
}

/**
 * Respaldo de sincronizacion: ejecuta `callback` cada `intervalMs` SOLO con la pestana visible, nunca
 * solapa dos ejecuciones y se cancela al desmontar o al deshabilitarse. No contiene logica de negocio:
 * quien lo usa decide que consultar y cuando omitir (por ejemplo, durante una mutacion).
 */
export function useVisiblePolling(
  callback: () => void | Promise<unknown>,
  { intervalMs, enabled, runOnVisible = true }: UseVisiblePollingOptions,
) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (!enabled) return;
    let timer: number | null = null;
    let running = false;

    const run = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        await callbackRef.current();
      } catch {
        // El respaldo es silencioso: la pantalla conserva los datos visibles y el siguiente ciclo reintenta.
      } finally {
        running = false;
      }
    };
    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const start = () => {
      if (timer !== null) return;
      timer = window.setInterval(() => void run(), intervalMs);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        stop();
        return;
      }
      start();
      if (runOnVisible) void run();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, intervalMs, runOnVisible]);
}
