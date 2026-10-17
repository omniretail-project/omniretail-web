"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Branch } from "@/core/entities";
import type { AuthRepository } from "@/core/repositories";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

interface ActiveBranchContextValue {
  branches: Branch[];
  currentBranch: Branch | null;
  loading: boolean;
  /** Mensaje si no se pudieron leer las sucursales (distinto de una lista realmente vacia). */
  error: string | null;
  /** Vuelve a pedir las sucursales (p. ej. desde el boton "Reintentar"). */
  reload: () => Promise<void>;
  setActiveBranchId: (branchId: string) => void;
}

const BRANCH_LOAD_ERROR = "No se pudieron cargar las sucursales.";

interface ActiveBranchProviderProps {
  /**
   * Optional scoping predicate: when given, only branches it accepts are
   * exposed/selectable (e.g. a Customer session with no operational branch
   * ends up with an empty list, never an arbitrary default). Omitted means
   * unrestricted, matching the previous behavior.
   */
  tenantId: string | null;
  canAccessBranch?: (branch: Branch) => boolean;
  children: ReactNode;
}

const ActiveBranchContext = createContext<ActiveBranchContextValue | null>(null);

/**
 * Pura y exportada para poder testearse sin renderizar React: dado el set de branches
 * accesibles para el User/tenant actual y la seleccion previa, decide cual queda activa.
 * Conserva la seleccion previa SOLO si sigue siendo accesible (evita que una sucursal de OTRO
 * User/tenant -- ej. tras un cambio de sesion -- sobreviva a la reconstruccion); si no, cae a
 * la primera accesible o a null si no hay ninguna ("Sin sucursales", nunca un fallback a todas).
 */
export function selectNextActiveBranchId(
  accessibleBranches: Branch[],
  currentActiveBranchId: string | null,
): string | null {
  if (
    currentActiveBranchId &&
    accessibleBranches.some((branch) => branch.id === currentActiveBranchId)
  ) {
    return currentActiveBranchId;
  }
  return accessibleBranches[0]?.id ?? null;
}

/** Sucursal activa guardada en la sesion actual (backend o mock), o null si no hay. */
async function readSessionActiveBranchId(auth: AuthRepository): Promise<string | null> {
  const sessionId = await auth.getCurrentSessionId();
  if (!sessionId) return null;
  return (await auth.getSession(sessionId))?.activeBranchId ?? null;
}

/** Pura y exportada: defensa en profundidad para setActiveBranchId (ver su uso mas abajo). */
export function isBranchIdSelectable(branches: Branch[], branchId: string): boolean {
  return branches.some((branch) => branch.id === branchId);
}

export function ActiveBranchProvider({
  tenantId,
  canAccessBranch,
  children,
}: Readonly<ActiveBranchProviderProps>) {
  const repositories = useRepositories();
  // Ultima lista de sucursales ACTIVAS leida del backend (sin filtrar por alcance). null = aun no
  // hay lectura valida (cargando, o la lectura fallo).
  const [fetchedBranches, setFetchedBranches] = useState<Branch[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // La seleccion activa se lee desde una ref: cambiarla NO debe recrear los callbacks de carga ni
  // volver a consultar la lista (solo cambia cual de las sucursales ya cargadas esta activa).
  const activeBranchIdRef = useRef<string | null>(null);
  // Solo la ultima lectura/aplicacion puede escribir estado: una respuesta vieja (otro tenant, un
  // `branch.changed` anterior o un reintento superado) se descarta.
  const fetchRequestRef = useRef(0);
  const applyRequestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    activeBranchIdRef.current = activeBranchId;
  }, [activeBranchId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Si la lista no se puede leer (red, 403...) se distingue de una lista realmente vacia: el
  // selector sale de "Cargando sucursal" y ofrece reintentar en vez de decir "Sin sucursales".
  const failBranches = useCallback(() => {
    setFetchedBranches(null);
    setBranches([]);
    setActiveBranchId(null);
    setError(BRANCH_LOAD_ERROR);
    setLoading(false);
  }, []);

  // Lee las sucursales del tenant. Solo se dispara por: cambio de tenant, `branch.changed` o
  // "Reintentar" -- nunca por cambiar la sucursal activa.
  const fetchBranches = useCallback(async () => {
    const requestId = ++fetchRequestRef.current;
    const isCurrent = () => mountedRef.current && fetchRequestRef.current === requestId;
    try {
      const activeBranches = tenantId
        ? await repositories.branches.getActiveByTenant(tenantId)
        : [];
      if (!isCurrent()) return;
      setError(null);
      setFetchedBranches(activeBranches);
    } catch {
      if (isCurrent()) {
        applyRequestRef.current += 1;
        failBranches();
      }
    }
  }, [failBranches, repositories, tenantId]);

  // Filtra por alcance, resuelve cual queda activa y la persiste en la sesion. No consulta
  // sucursales: solo vuelve a correr si llega una lista nueva o cambia el predicado de acceso.
  const applyBranches = useCallback(
    async (fetched: Branch[], canAccess: ((branch: Branch) => boolean) | undefined) => {
      const requestId = ++applyRequestRef.current;
      const isCurrent = () => mountedRef.current && applyRequestRef.current === requestId;
      try {
        const accessibleBranches = canAccess
          ? fetched.filter((branch) => canAccess(branch))
          : fetched;
        // Al cargar (sin seleccion previa en memoria) se parte de la sucursal guardada en la
        // sesion, asi se conserva al recargar; solo se persiste si cambia.
        const sessionBranchId = await readSessionActiveBranchId(repositories.auth);
        if (!isCurrent()) return;
        const nextBranchId = selectNextActiveBranchId(
          accessibleBranches,
          activeBranchIdRef.current ?? sessionBranchId,
        );
        if (nextBranchId && nextBranchId !== sessionBranchId) {
          try {
            await repositories.auth.setActiveBranchId(nextBranchId);
          } catch {
            // Si no se puede guardar, la sucursal igual queda elegida en esta pestaña: el
            // selector no se queda en "Cargando sucursal".
          }
          if (!isCurrent()) return;
        }
        activeBranchIdRef.current = nextBranchId;
        setBranches(accessibleBranches);
        setActiveBranchId(nextBranchId);
        setLoading(false);
      } catch {
        if (isCurrent()) failBranches();
      }
    },
    [failBranches, repositories.auth],
  );

  const reloadBranches = useCallback(async () => {
    setLoading(true);
    await fetchBranches();
  }, [fetchBranches]);

  // Carga inicial y cambio de tenant. Mientras llega la lista del nuevo tenant no se conservan las
  // sucursales del anterior.
  useEffect(() => {
    window.queueMicrotask(() => {
      if (!mountedRef.current) return;
      setFetchedBranches(null);
      setBranches([]);
      setActiveBranchId(null);
      setLoading(true);
      void fetchBranches();
    });

    return () => {
      // Invalida la lectura en vuelo: su respuesta ya no pertenece a este tenant.
      fetchRequestRef.current += 1;
    };
  }, [fetchBranches]);

  useEffect(() => {
    if (fetchedBranches === null) return;
    window.queueMicrotask(() => {
      if (mountedRef.current) void applyBranches(fetchedBranches, canAccessBranch);
    });
  }, [applyBranches, canAccessBranch, fetchedBranches]);

  const onBranchChanged = useCallback(() => {
    void fetchBranches();
  }, [fetchBranches]);

  useDataEvent("branch.changed", onBranchChanged);

  const currentBranch = useMemo(
    () => branches.find((branch) => branch.id === activeBranchId) ?? null,
    [activeBranchId, branches],
  );

  // Defensa en profundidad: aunque hoy el unico consumidor (BranchSelector) solo ofrece
  // branches ya presentes en `branches` (ya filtradas por canAccessBranch), esta funcion es
  // parte del contrato publico del context -- un branchId fuera de `branches` (manipulado o
  // de otro alcance) se ignora en vez de aceptarse silenciosamente. Solo cambia la seleccion: no
  // vuelve a consultar la lista.
  const selectActiveBranch = useCallback(
    (branchId: string) => {
      if (!isBranchIdSelectable(branches, branchId)) return;
      void repositories.auth.setActiveBranchId(branchId).then(() => {
        activeBranchIdRef.current = branchId;
        setActiveBranchId(branchId);
      });
    },
    [branches, repositories.auth],
  );

  const value = useMemo<ActiveBranchContextValue>(
    () => ({
      branches,
      currentBranch,
      loading,
      error,
      reload: reloadBranches,
      setActiveBranchId: selectActiveBranch,
    }),
    [branches, currentBranch, loading, error, reloadBranches, selectActiveBranch],
  );

  return <ActiveBranchContext.Provider value={value}>{children}</ActiveBranchContext.Provider>;
}

export function useActiveBranch() {
  const context = useContext(ActiveBranchContext);
  if (!context) throw new Error("useActiveBranch must be used inside ActiveBranchProvider");
  return context;
}
