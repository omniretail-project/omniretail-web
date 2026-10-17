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
import type { Role, User } from "@/core/entities";
import { isBranchIdInUserScope } from "@/core/scopes/userBranchAccess";
import type { DataEventPayloadFor } from "@/core/types/events.types";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { resolveCurrentSessionSnapshot } from "@/modules/auth/application/services/resolveCurrentSessionSnapshot";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

interface CurrentSessionContextValue {
  sessionId: string | null;
  user: User | null;
  role: Role | null;
  permissions: string[];
  hasPermission: (permission: string) => boolean;
  canAccessBranch: (branchId: string) => boolean;
  loading: boolean;
  isDemo: boolean;
  error?: string;
}

const CurrentSessionContext = createContext<CurrentSessionContextValue | null>(null);

/**
 * Pura y exportada para poder testearse sin renderizar React. Un role.changed de un role
 * DISTINTO al de la sesion actual (incluido role.created, que nunca trae el roleId de esta
 * sesion) no debe revalidar -- revalidar ahi dispara reload() -> loading=true ->
 * RequireSession desmonta el subarbol autenticado por una mutacion que no le afecta. Sin
 * sesion resuelta todavia (currentRoleId undefined) no hay nada que comparar: se ignora.
 */
export function shouldRevalidateSessionOnRoleChanged(
  payload: DataEventPayloadFor<"role.changed">,
  currentRoleId: string | undefined,
): boolean {
  if (!currentRoleId) return false;
  if (payload.entityId && payload.entityId !== currentRoleId) return false;
  return true;
}

/**
 * Pura y exportada, mismo criterio que shouldRevalidateSessionOnRoleChanged pero para
 * auth.changed/user.changed. El bus de eventos es un singleton por pestaña/instancia de la
 * app -- solo recibe eventos de acciones disparadas DESDE esta misma pestaña -- asi que un
 * entityId que no coincide ni con el userId ni con el sessionId actual es, por construccion,
 * otra identidad (ej. `inviteEmployee`/`revokeAllSessionsByUserId` sobre OTRO empleado, o
 * `user.changed` al crear/editar a alguien mas): revalidar ahi solo desmontaria
 * RequireSession/PrivateShell sin necesidad. `entityId` identifica un userId en la mayoria de
 * los eventos (create/update/inviteEmployee/revokeAllSessionsByUserId) pero un sessionId en
 * login/logout -- por eso se compara contra ambos. Sin sesion/identidad resuelta todavia
 * (currentUserId undefined: pre-login, o justo despues de un logout) o sin entityId
 * (evento ambiguo: registerCustomer/requestPasswordReset/resetPassword/verifyEmail/
 * activateEmployeeAccount/changePassword/clearLocalSession) se revalida siempre (fail-open),
 * porque no hay forma segura de probar que el evento es ajeno.
 */
export function shouldRevalidateSessionOnIdentityChanged(
  payload: DataEventPayloadFor<"auth.changed"> | DataEventPayloadFor<"user.changed">,
  currentUserId: string | undefined,
  currentSessionId: string | undefined,
): boolean {
  if (!currentUserId) return true;
  if (!payload.entityId) return true;
  return payload.entityId === currentUserId || payload.entityId === currentSessionId;
}

export function CurrentSessionProvider({ children }: { children: ReactNode }) {
  const repositories = useRepositories();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const reloadVersion = useRef(0);
  const currentUserRoleIdRef = useRef<string | undefined>(undefined);
  const currentUserIdRef = useRef<string | undefined>(undefined);
  const currentSessionIdRef = useRef<string | undefined>(undefined);

  const reload = useCallback(async () => {
    const version = ++reloadVersion.current;
    setLoading(true);
    setError(undefined);
    try {
      const snapshot = await resolveCurrentSessionSnapshot(repositories);
      // auth.changed/user.changed y la carga inicial pueden solaparse.
      // Solo la reconstruccion mas reciente puede publicar estado; asi
      // una lectura iniciada con la sesion anterior nunca sobreescribe
      // el resultado de un login/logout posterior.
      if (version !== reloadVersion.current) return;
      setSessionId(snapshot.sessionId);
      setUser(snapshot.user);
      setRole(snapshot.role);
      setError(snapshot.error);
      currentUserRoleIdRef.current = snapshot.user?.roleId;
      currentUserIdRef.current = snapshot.user?.id;
      currentSessionIdRef.current = snapshot.sessionId ?? undefined;
    } catch {
      if (version !== reloadVersion.current) return;
      setSessionId(null);
      setUser(null);
      setRole(null);
      setError("No se pudo cargar la sesion actual.");
      currentUserRoleIdRef.current = undefined;
      currentUserIdRef.current = undefined;
      currentSessionIdRef.current = undefined;
    } finally {
      if (version === reloadVersion.current) {
        setLoading(false);
      }
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

  const handleRoleChanged = useCallback(
    (payload: DataEventPayloadFor<"role.changed">) => {
      if (shouldRevalidateSessionOnRoleChanged(payload, currentUserRoleIdRef.current)) {
        void reload();
      }
    },
    [reload],
  );

  const handleIdentityChanged = useCallback(
    (payload: DataEventPayloadFor<"auth.changed"> | DataEventPayloadFor<"user.changed">) => {
      if (
        shouldRevalidateSessionOnIdentityChanged(
          payload,
          currentUserIdRef.current,
          currentSessionIdRef.current,
        )
      ) {
        void reload();
      }
    },
    [reload],
  );

  useDataEvent("auth.changed", handleIdentityChanged);
  useDataEvent("user.changed", handleIdentityChanged);
  useDataEvent("role.changed", handleRoleChanged);

  const permissions = useMemo(() => role?.permissions ?? [], [role]);
  const permissionSet = useMemo(() => new Set(permissions), [permissions]);

  const value = useMemo<CurrentSessionContextValue>(
    () => ({
      sessionId,
      user,
      role,
      permissions,
      hasPermission: (permission) => permissionSet.has(permission),
      canAccessBranch: (branchId) =>
        user && role ? isBranchIdInUserScope(user, role, branchId) : false,
      loading,
      isDemo: false,
      error,
    }),
    [error, loading, permissionSet, permissions, role, sessionId, user],
  );

  return <CurrentSessionContext.Provider value={value}>{children}</CurrentSessionContext.Provider>;
}

export function useCurrentSessionContext() {
  const context = useContext(CurrentSessionContext);
  if (!context) throw new Error("useCurrentSession must be used inside CurrentSessionProvider");
  return context;
}
