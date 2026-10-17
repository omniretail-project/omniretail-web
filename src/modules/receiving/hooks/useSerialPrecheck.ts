"use client";

import { useEffect, useMemo, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { ReceivingDocumentDetailService } from "@/modules/receiving/application/services/ReceivingDocumentDetailService";

const PRECHECK_DEBOUNCE_MS = 600;
const KEY_SEPARATOR = "\u0000";

interface PrecheckState {
  key: string;
  duplicates: string[];
  unavailable: boolean;
}

/**
 * Precheck UX de seriales contra el backend: UNA request batch por producto tras una pausa breve.
 * El backend sigue siendo la autoridad al guardar, resolver y confirmar.
 */
export function useSerialPrecheck(input: {
  productId: string | undefined;
  serials: string[];
  enabled: boolean;
}) {
  const repositories = useRepositories();
  const service = useMemo(() => new ReceivingDocumentDetailService(repositories), [repositories]);
  const { productId, enabled } = input;
  // Unicos y estables para no disparar requests por reordenamientos o repeticiones locales.
  const key = [...new Set(input.serials)].sort().join(KEY_SEPARATOR);
  const active = enabled && Boolean(productId) && key.length > 0;
  const [state, setState] = useState<PrecheckState | null>(null);

  useEffect(() => {
    if (!active || !productId) return;
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const result = await service.validateSerials(productId, key.split(KEY_SEPARATOR));
        if (current) setState({ key, duplicates: result.duplicates, unavailable: false });
      } catch {
        if (current) setState({ key, duplicates: [], unavailable: true });
      }
    }, PRECHECK_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [active, key, productId, service]);

  const resolved = active && state?.key === key ? state : null;
  return {
    remoteDuplicates: resolved?.duplicates ?? [],
    checking: active && !resolved,
    unavailable: resolved?.unavailable ?? false,
  };
}

export function findRepeatedSerials(serials: string[]) {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  serials.forEach((serial) => {
    if (seen.has(serial)) repeated.add(serial);
    seen.add(serial);
  });
  return [...repeated];
}
