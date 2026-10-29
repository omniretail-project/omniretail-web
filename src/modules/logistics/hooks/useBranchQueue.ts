"use client";

import { useCallback, useRef, useState } from "react";

interface UseBranchQueueOptions<Item> {
  branchLoading: boolean;
  sessionLoading: boolean;
  currentBranch: { id: string } | null;
  hasBranchAccess: boolean;
  canRead: boolean;
  sessionError?: string | null;
  /** Sucursal activa que mantiene el hook que llama; una respuesta de otra sucursal se descarta. */
  activeBranchIdRef: { readonly current: string | null };
  /**
   * Debe tener una referencia ESTABLE (useCallback): cuando cambia, `reload` cambia y el hook que llama
   * vuelve a consultar, igual que antes cambiaba el servicio.
   */
  fetchQueue: (branchId: string) => Promise<Item[]>;
  /** Mensaje por defecto (constante) cuando falla la consulta y no hay un error de sesion. */
  fallbackError: string;
}

/**
 * Cola de una sucursal con recarga silenciosa, compartida por Picking y Packing.
 * - Primera lectura de una sucursal: `loading` y limpieza del error. Las siguientes (ya hay cola de esa
 *   sucursal) son en segundo plano: no activan `loading`, y una lectura valida limpia el error.
 * - Sin acceso o sin permiso de lectura la cola se vacia y se olvida la sucursal mostrada.
 * - Una respuesta que ya no es la ultima solicitud, o que es de otra sucursal, no se aplica.
 */
export function useBranchQueue<Item>({
  branchLoading,
  sessionLoading,
  currentBranch,
  hasBranchAccess,
  canRead,
  sessionError,
  activeBranchIdRef,
  fetchQueue,
  fallbackError,
}: UseBranchQueueOptions<Item>) {
  const [queue, setQueue] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const loadSequenceRef = useRef(0);
  // Sucursal cuya cola ya se mostro: las lecturas siguientes son en segundo plano (no ocultan la mesa).
  const queueBranchIdRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;
    if (branchLoading || sessionLoading) return;
    const background = Boolean(
      currentBranch && hasBranchAccess && canRead && queueBranchIdRef.current === currentBranch.id,
    );
    if (!background) {
      setLoading(true);
      setQueueError(null);
    }
    if (!currentBranch || !hasBranchAccess || !canRead) {
      queueBranchIdRef.current = null;
      setQueue([]);
      setLoading(false);
      return;
    }
    try {
      const items = await fetchQueue(currentBranch.id);
      if (sequence === loadSequenceRef.current && currentBranch.id === activeBranchIdRef.current) {
        queueBranchIdRef.current = currentBranch.id;
        setQueue(items);
        setQueueError(null);
      }
    } catch (cause) {
      if (sequence === loadSequenceRef.current) {
        setQueueError(toMessage(cause, sessionError ?? fallbackError));
      }
    } finally {
      if (sequence === loadSequenceRef.current) setLoading(false);
    }
  }, [
    activeBranchIdRef,
    branchLoading,
    canRead,
    currentBranch,
    fallbackError,
    fetchQueue,
    hasBranchAccess,
    sessionError,
    sessionLoading,
  ]);

  return { queue, loading, queueError, reload };
}

function toMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
