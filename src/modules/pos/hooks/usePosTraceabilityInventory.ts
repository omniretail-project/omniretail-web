"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  const [state, setState] = useState<PosTraceabilityReadState>(idleState);
  const requestSequenceRef = useRef(0);
  const contextKey = `${sessionId ?? ""}:${user?.id ?? ""}:${user?.tenantId ?? ""}:${currentBranch?.id ?? ""}`;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;

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
    requestSequenceRef.current += 1;
    setState(idleState);
  }, [contextKey]);

  const close = useCallback(() => {
    requestSequenceRef.current += 1;
    setState(idleState);
  }, []);

  const load = useCallback(
    async (productId: string, filters: PosTraceabilityReadFilters = {}): Promise<boolean> => {
      const requestId = ++requestSequenceRef.current;
      const requestContextKey = contextKeyRef.current;
      const normalizedProductId = productId.trim();

      if (branchLoading || sessionLoading) {
        setState({
          status: "error",
          data: null,
          error: "La sesion y la sucursal aun se estan cargando.",
        });
        return false;
      }
      if (!normalizedProductId) {
        setState({ status: "error", data: null, error: "Debe seleccionar un producto." });
        return false;
      }
      if (!user || !currentBranch || !hasBranchAccess) {
        setState({
          status: "error",
          data: null,
          error: sessionError ?? "No dispone de acceso a la sucursal seleccionada.",
        });
        return false;
      }
      if (repositories.inventoryStockDataSource !== "api") {
        setState({
          status: "error",
          data: null,
          error: "La consulta de inventario trazable solo esta disponible en modo API.",
        });
        return false;
      }
      if (!hasReadPermissions) {
        setState({
          status: "error",
          data: null,
          error: "No dispone de permisos para consultar inventario trazable y ubicaciones.",
        });
        return false;
      }

      setState({ status: "loading", data: null, error: null });
      const input: PosTraceabilityInventoryQueryDto = {
        branchId: currentBranch.id,
        productId: normalizedProductId,
        locationId: filters.locationId,
        lotId: filters.lotId,
      };
      try {
        const data = await service.execute(input);
        if (
          requestId !== requestSequenceRef.current ||
          requestContextKey !== contextKeyRef.current
        ) {
          return false;
        }
        setState({ status: "loaded", data, error: null });
        return true;
      } catch (error) {
        if (
          requestId !== requestSequenceRef.current ||
          requestContextKey !== contextKeyRef.current
        ) {
          return false;
        }
        setState({
          status: "error",
          data: null,
          error: cleanPosError(error, "No se pudo consultar el inventario trazable."),
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
