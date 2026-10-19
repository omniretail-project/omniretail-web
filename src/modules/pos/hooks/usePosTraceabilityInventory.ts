"use client";

import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import type {
  PosTraceabilityInventoryDto,
  PosTraceabilityInventoryQueryDto,
} from "@/modules/pos/application/dto/PosTraceabilityInventoryDto";
import {
  GetPosTraceabilityInventoryService,
  POS_TRACEABILITY_LOCATIONS_PERMISSION,
  POS_TRACEABILITY_STOCK_PERMISSION,
} from "@/modules/pos/application/services/GetPosTraceabilityInventoryService";
import { cleanPosError } from "@/modules/pos/application/services/posServiceContext";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";

export interface PosTraceabilityReadFilters {
  locationId?: string;
  lotId?: string;
}

export interface PosTraceabilityReadState {
  status: "idle" | "loading" | "loaded" | "error";
  data: PosTraceabilityInventoryDto | null;
  error: string | null;
}

const idleState: PosTraceabilityReadState = { status: "idle", data: null, error: null };

interface ContextualReadState {
  context: TraceabilityRequestContext;
  value: PosTraceabilityReadState;
}

interface TraceabilityRequestContext {
  readonly key: string;
  activate: () => void;
  deactivate: () => void;
  begin: () => symbol;
  finish: (request: symbol) => boolean;
  cancel: () => void;
}

function createTraceabilityRequestContext(key: string): TraceabilityRequestContext {
  let active = false;
  let currentRequest: symbol | null = null;

  return {
    key,
    activate: () => {
      active = true;
    },
    deactivate: () => {
      active = false;
      currentRequest = null;
    },
    begin: () => {
      const request = Symbol("pos-traceability-request");
      currentRequest = request;
      return request;
    },
    finish: (request) => {
      if (!active || currentRequest !== request) return false;
      currentRequest = null;
      return true;
    },
    cancel: () => {
      currentRequest = null;
    },
  };
}

export function usePosTraceabilityInventory() {
  const repositories = useRepositories();
  const { currentBranch, loading: branchLoading } = useActiveBranch();
  const {
    sessionId,
    user,
    canAccessBranch,
    hasPermission,
    loading: sessionLoading,
    error: sessionError,
  } = useCurrentSession();
  const service = useMemo(
    () => new GetPosTraceabilityInventoryService(repositories),
    [repositories],
  );
  const contextKey = `${sessionId ?? ""}:${user?.id ?? ""}:${user?.tenantId ?? ""}:${currentBranch?.tenantId ?? ""}:${currentBranch?.id ?? ""}`;
  const requestContext = useMemo(() => createTraceabilityRequestContext(contextKey), [contextKey]);
  const [contextualState, setContextualState] = useState<ContextualReadState>(() => ({
    context: requestContext,
    value: idleState,
  }));
  const state = contextualState.context === requestContext ? contextualState.value : idleState;

  const hasBranchAccess = Boolean(
    user &&
      currentBranch &&
      user.tenantId === currentBranch.tenantId &&
      canAccessBranch(currentBranch.id),
  );
  const hasReadPermissions =
    hasPermission(POS_TRACEABILITY_STOCK_PERMISSION) &&
    hasPermission(POS_TRACEABILITY_LOCATIONS_PERMISSION);
  const canQuery =
    repositories.inventoryStockDataSource === "api" &&
    hasBranchAccess &&
    hasReadPermissions &&
    !branchLoading &&
    !sessionLoading;

  useLayoutEffect(() => {
    requestContext.activate();
    return () => requestContext.deactivate();
  }, [requestContext]);

  const close = useCallback(() => {
    requestContext.cancel();
    setContextualState({ context: requestContext, value: idleState });
  }, [requestContext]);

  const load = useCallback(
    async (productId: string, filters: PosTraceabilityReadFilters = {}): Promise<boolean> => {
      const request = requestContext.begin();
      const normalizedProductId = productId.trim();

      if (branchLoading || sessionLoading) {
        requestContext.finish(request);
        setContextualState({
          context: requestContext,
          value: {
            status: "error",
            data: null,
            error: "La sesion y la sucursal aun se estan cargando.",
          },
        });
        return false;
      }
      if (!normalizedProductId) {
        requestContext.finish(request);
        setContextualState({
          context: requestContext,
          value: { status: "error", data: null, error: "Debe seleccionar un producto." },
        });
        return false;
      }
      if (!user || !currentBranch || !hasBranchAccess) {
        requestContext.finish(request);
        setContextualState({
          context: requestContext,
          value: {
            status: "error",
            data: null,
            error: sessionError ?? "No dispone de acceso a la sucursal seleccionada.",
          },
        });
        return false;
      }
      if (repositories.inventoryStockDataSource !== "api") {
        requestContext.finish(request);
        setContextualState({
          context: requestContext,
          value: {
            status: "error",
            data: null,
            error: "La consulta de inventario trazable solo esta disponible en modo API.",
          },
        });
        return false;
      }
      if (!hasReadPermissions) {
        requestContext.finish(request);
        setContextualState({
          context: requestContext,
          value: {
            status: "error",
            data: null,
            error: "No dispone de permisos para consultar inventario trazable y ubicaciones.",
          },
        });
        return false;
      }

      setContextualState({
        context: requestContext,
        value: { status: "loading", data: null, error: null },
      });
      const input: PosTraceabilityInventoryQueryDto = {
        branchId: currentBranch.id,
        productId: normalizedProductId,
        locationId: filters.locationId,
        lotId: filters.lotId,
      };
      try {
        const data = await service.execute(input);
        if (!requestContext.finish(request)) return false;
        setContextualState({
          context: requestContext,
          value: { status: "loaded", data, error: null },
        });
        return true;
      } catch (error) {
        if (!requestContext.finish(request)) return false;
        setContextualState({
          context: requestContext,
          value: {
            status: "error",
            data: null,
            error: cleanPosError(error, "No se pudo consultar el inventario trazable."),
          },
        });
        return false;
      }
    },
    [
      branchLoading,
      currentBranch,
      hasBranchAccess,
      hasReadPermissions,
      repositories.inventoryStockDataSource,
      requestContext,
      service,
      sessionError,
      sessionLoading,
      user,
    ],
  );

  return {
    ...state,
    canQuery,
    load,
    close,
  };
}
