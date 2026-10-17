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
import type { SaasCapabilityKey, SaasLimitKey } from "@/core/enums";
import type { DataEventPayloadFor } from "@/core/types/events.types";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { resolveCurrentSessionSnapshot } from "@/modules/auth/application/services/resolveCurrentSessionSnapshot";
import type { TenantEntitlementsDto } from "@/shared/application/dto/EntitlementDto";
import { getTenantLimit, hasTenantCapability } from "@/shared/application/services/entitlementGuards";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";
import { useDataEvent } from "@/shared/hooks/useDataEvent";

interface EntitlementContextValue {
  entitlements: TenantEntitlementsDto | null;
  loading: boolean;
  error?: string;
  hasCapability: (key: SaasCapabilityKey) => boolean;
  getLimit: (key: SaasLimitKey) => number | undefined;
}

const EntitlementContext = createContext<EntitlementContextValue | null>(null);

export function shouldRevalidateEntitlementsOnIdentityChanged(
  payload: DataEventPayloadFor<"auth.changed"> | DataEventPayloadFor<"user.changed">,
  currentUserId: string | undefined,
): boolean {
  if (!currentUserId) return true;
  if (!payload.entityId) return true;
  return payload.entityId === currentUserId;
}

/**
 * Fuente única de entitlements SaaS para la UI (feature/saas-entitlement-enforcement, auditoría
 * §26/§27) -- ningún componente debe resolver `plans`/`tenantSubscriptions` directo
 * (`component -> PlanRepository` está explícitamente prohibido); SIEMPRE via
 * `ResolveTenantEntitlementsService`, el MISMO boundary que ya usan los Application Services de
 * cada módulo, para que UI y enforcement nunca puedan divergir.
 *
 * Fail-closed sin drama (auditoría §27): si la sesión no existe todavía o la resolución de
 * entitlements falla (Subscription/Plan faltante), `entitlements` queda `null` y
 * `hasCapability`/`getLimit` devuelven `false`/`undefined` -- nunca asumen Enterprise ni ningún
 * plan por default. Un fallo acá NUNCA dispara logout ni redirige: Authentication (¿quién sos?) y
 * Entitlement (¿qué puede comprar/usar tu negocio?) son capas completamente distintas, y una
 * Subscription suspendida no es motivo para cerrar la sesión de nadie.
 *
 * Expone enforcement READ; la mutación de Plan vive en ChangeTenantPlanService (administration) y
 * llega acá SOLO como `tenant-subscription.changed`, que dispara un reload. Cancel/renew/billing
 * siguen fuera de scope.
 */
export function EntitlementProvider({
  children,
  tenantId,
}: {
  children: ReactNode;
  /**
   * Tenant ya resuelto por el arbol autenticado (mismo patron que `ActiveBranchProvider`): evita
   * re-resolver la sesion. `null` => sin entitlements, sin tocar la red. `undefined` (prop
   * omitida) conserva la resolucion legacy via `resolveCurrentSessionSnapshot`.
   */
  tenantId?: string | null;
}) {
  const repositories = useRepositories();
  const [entitlements, setEntitlements] = useState<TenantEntitlementsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const reloadVersion = useRef(0);
  const currentUserIdRef = useRef<string | undefined>(undefined);

  const reload = useCallback(async () => {
    const version = ++reloadVersion.current;
    setLoading(true);
    setError(undefined);
    try {
      if (tenantId !== undefined) {
        if (!tenantId) {
          setEntitlements(null);
          return;
        }
        const resolved = await new ResolveTenantEntitlementsService(repositories).execute(tenantId);
        if (version !== reloadVersion.current) return;
        setEntitlements(resolved);
        return;
      }
      const snapshot = await resolveCurrentSessionSnapshot(repositories);
      if (version !== reloadVersion.current) return;
      currentUserIdRef.current = snapshot.user?.id;
      if (!snapshot.user) {
        setEntitlements(null);
        return;
      }
      const resolved = await new ResolveTenantEntitlementsService(repositories).execute(
        snapshot.user.tenantId,
      );
      if (version !== reloadVersion.current) return;
      setEntitlements(resolved);
    } catch (caughtError) {
      if (version !== reloadVersion.current) return;
      setEntitlements(null);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "No se pudo resolver el plan del negocio.",
      );
    } finally {
      if (version === reloadVersion.current) setLoading(false);
    }
  }, [repositories, tenantId]);

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

  const handleIdentityChanged = useCallback(
    (payload: DataEventPayloadFor<"auth.changed"> | DataEventPayloadFor<"user.changed">) => {
      if (shouldRevalidateEntitlementsOnIdentityChanged(payload, currentUserIdRef.current)) {
        void reload();
      }
    },
    [reload],
  );

  useDataEvent("auth.changed", handleIdentityChanged);
  useDataEvent("user.changed", handleIdentityChanged);
  // Tenant-wide: no hay pregunta de "¿de qué identidad?" que responder -- el Plan es del
  // Tenant, no del User, así que se recarga siempre (una sola sesión por tab).
  useDataEvent("tenant-subscription.changed", reload);

  const value = useMemo<EntitlementContextValue>(
    () => ({
      entitlements,
      loading,
      error,
      hasCapability: (key) => (entitlements ? hasTenantCapability(entitlements, key) : false),
      getLimit: (key) => (entitlements ? getTenantLimit(entitlements, key) : undefined),
    }),
    [entitlements, loading, error],
  );

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlementContext() {
  const context = useContext(EntitlementContext);
  if (!context) throw new Error("useEntitlement must be used inside EntitlementProvider");
  return context;
}
