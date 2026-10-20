"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import type {
  PickingFefoPreviewDto,
  PickingFefoPreviewQueryDto,
} from "@/modules/logistics/application/dto/PickingReadModelDto";
import { PickingApplicationService } from "@/modules/logistics/application/services/PickingApplicationService";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";

export interface PickingFefoPreviewState {
  status: "idle" | "loading" | "loaded" | "error";
  data: PickingFefoPreviewDto | null;
  error: string | null;
}

interface PreviewRequestContext {
  readonly identity: string;
  activate(): void;
  deactivate(): void;
  begin(): symbol;
  finish(request: symbol): boolean;
}

const idleState: PickingFefoPreviewState = { status: "idle", data: null, error: null };

function createRequestContext(identity: string): PreviewRequestContext {
  let active = false;
  let current: symbol | null = null;
  return {
    identity,
    activate: () => { active = true; },
    deactivate: () => { active = false; current = null; },
    begin: () => {
      const request = Symbol("picking-fefo-preview");
      current = request;
      return request;
    },
    finish: (request) => {
      if (!active || current !== request) return false;
      current = null;
      return true;
    },
  };
}

export function usePickingFefoPreview(query: PickingFefoPreviewQueryDto | null) {
  const repositories = useRepositories();
  const { currentBranch, loading: branchLoading } = useActiveBranch();
  const {
    sessionId,
    user,
    canAccessBranch,
    hasPermission,
    loading: sessionLoading,
  } = useCurrentSession();
  const service = useMemo(() => new PickingApplicationService(repositories), [repositories]);
  const hasContextAccess = Boolean(
    user &&
      currentBranch &&
      user.tenantId === currentBranch.tenantId &&
      canAccessBranch(currentBranch.id),
  );
  const hasStartPermission = hasPermission("logistics.picking.start");
  const queryKey = query
    ? `${query.pickingOrderId}:${query.pickingLineId}:${query.productId}:${query.locationId}:${query.pickedQuantity}`
    : "disabled";
  const contextKey = `${sessionId ?? ""}:${user?.id ?? ""}:${user?.tenantId ?? ""}:${currentBranch?.tenantId ?? ""}:${currentBranch?.id ?? ""}:${repositories.pickingReadDataSource ?? ""}:${hasContextAccess}:${hasStartPermission}:${branchLoading}:${sessionLoading}:${queryKey}`;
  const requestContext = useMemo(() => createRequestContext(contextKey), [contextKey]);
  const [contextualState, setContextualState] = useState<{
    context: PreviewRequestContext;
    value: PickingFefoPreviewState;
  }>(() => ({ context: requestContext, value: idleState }));
  const state = contextualState.context === requestContext ? contextualState.value : idleState;
  const canQuery = Boolean(
    query &&
      repositories.pickingReadDataSource === "api" &&
      currentBranch &&
      query.pickedQuantity >= 0 &&
      hasContextAccess &&
      hasStartPermission &&
      !branchLoading &&
      !sessionLoading,
  );

  useLayoutEffect(() => {
    requestContext.activate();
    return () => requestContext.deactivate();
  }, [requestContext]);

  const load = useCallback(async (): Promise<boolean> => {
    if (!query || !canQuery || !currentBranch) return false;
    const request = requestContext.begin();
    setContextualState({
      context: requestContext,
      value: { status: "loading", data: null, error: null },
    });
    try {
      const data = await service.getFefoPreview(currentBranch.id, query);
      if (!requestContext.finish(request)) return false;
      setContextualState({
        context: requestContext,
        value: { status: "loaded", data, error: null },
      });
      return true;
    } catch (cause) {
      if (!requestContext.finish(request)) return false;
      setContextualState({
        context: requestContext,
        value: {
          status: "error",
          data: null,
          error: cause instanceof Error
            ? cause.message
            : "No se pudo calcular la vista previa FEFO.",
        },
      });
      return false;
    }
  }, [canQuery, currentBranch, query, requestContext, service]);

  useEffect(() => {
    if (!canQuery) return;
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => { active = false; };
  }, [canQuery, load]);

  return { ...state, canQuery, reload: load };
}
