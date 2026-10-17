"use client";

import { useEffect, useRef, useState } from "react";

const PRECHECK_DEBOUNCE_MS = 600;
const KEY_SEPARATOR = "\u0000";

interface PrecheckState {
  key: string;
  duplicates: string[];
  unavailable: boolean;
}

/**
 * Precheck UX de numeros de serie NUEVOS: una sola request batch tras una pausa breve, nunca una
 * por serie ni por tecla. Es agnostico del dominio (recibe `validate`); el backend sigue siendo la
 * autoridad al guardar/confirmar y esto no garantiza concurrencia.
 */
export function useSerialBatchPrecheck(input: {
  serials: string[];
  enabled: boolean;
  validate: (serials: string[]) => Promise<{ duplicates: string[] }>;
}) {
  const { enabled, validate } = input;
  const key = [...new Set(input.serials)].sort().join(KEY_SEPARATOR);
  const active = enabled && key.length > 0;
  const [state, setState] = useState<PrecheckState | null>(null);
  const validateRef = useRef(validate);

  useEffect(() => {
    validateRef.current = validate;
  }, [validate]);

  useEffect(() => {
    if (!active) return;
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const result = await validateRef.current(key.split(KEY_SEPARATOR));
        if (current) setState({ key, duplicates: result.duplicates, unavailable: false });
      } catch {
        if (current) setState({ key, duplicates: [], unavailable: true });
      }
    }, PRECHECK_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [active, key]);

  const resolved = active && state?.key === key ? state : null;
  return {
    remoteDuplicates: resolved?.duplicates ?? [],
    checking: active && !resolved,
    unavailable: resolved?.unavailable ?? false,
  };
}
