"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocationStatus } from "@/core/enums";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";
import type {
  LocationEditorDto,
  LocationListItem,
} from "@/modules/catalog/application/dto/LocationEditorDto";
import { GetLocationsService } from "@/modules/catalog/application/services/GetLocationsService";
import { SaveLocationService } from "@/modules/catalog/application/services/SaveLocationService";
import { cleanError } from "@/modules/catalog/application/services/serviceHelpers";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { isApiMode } from "@/config/api-mode";

export type LocationStatusFilter =
  LocationStatus.active | LocationStatus.inactive | LocationStatus.archived;

const DEFAULT_PAGE_SIZE = 10;

export function useLocations() {
  const repositories = useRepositories();
  const { hasPermission } = useCurrentSession();
  const canRead =
    hasPermission("catalog.locations.read") || hasPermission("catalog.locations.manage");
  const canManage = hasPermission("catalog.locations.manage");
  const { currentBranch, loading: branchLoading } = useActiveBranch();
  const getService = useMemo(() => new GetLocationsService(repositories), [repositories]);
  const saveService = useMemo(() => new SaveLocationService(repositories), [repositories]);
  const [locations, setLocations] = useState<LocationListItem[]>([]);
  const [search, setSearchState] = useState("");
  const [status, setStatusState] = useState<LocationStatusFilter>(LocationStatus.active);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(DEFAULT_PAGE_SIZE);
  // Empieza cargando: antes de la primera respuesta la lista NO esta vacia, esta pendiente.
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Errores de MUTACION. Los de carga van aparte en `loadError`: un fallo al listar nunca debe
  // leerse como «no hay ubicaciones».
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const apiMode = isApiMode();
  const scopedBranchId = currentBranch?.id;
  const canLoad = apiMode || Boolean(currentBranch);
  // Solo la ultima consulta puede escribir estado: evita que la respuesta lenta de una sucursal
  // anterior pise a la de la sucursal actual.
  const requestRef = useRef(0);
  // Sucursal a la que corresponde la ultima respuesta (o error). Mientras no coincida con la
  // sucursal actual, la lista se considera «cargando» y no «vacia», sin parpadeo al cambiar.
  const scopeKey = scopedBranchId ?? "all";
  const [loadedScope, setLoadedScope] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!canLoad) {
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    setLoadError(null);
    try {
      const nextLocations = await getService.execute(scopedBranchId);
      if (requestId !== requestRef.current) return;
      setLocations(nextLocations);
      setLoadedScope(scopeKey);
    } catch (caughtError) {
      if (requestId !== requestRef.current) return;
      setLocations([]);
      setLoadError(cleanError(caughtError));
      setLoadedScope(scopeKey);
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [canLoad, getService, scopeKey, scopedBranchId]);

  useDataEvent("inventory.changed", reload);
  useDataEvent("stock.changed", reload);
  useDataEvent("branch.changed", reload);

  useEffect(() => {
    let active = true;
    window.queueMicrotask(() => {
      if (active) void reload();
    });
    return () => {
      active = false;
      requestRef.current += 1;
    };
  }, [reload]);

  const branchLocations = useMemo(
    () =>
      scopedBranchId
        ? locations.filter((location) => location.branchId === scopedBranchId)
        : locations,
    [locations, scopedBranchId],
  );
  const filteredLocations = useMemo(
    () => filterLocations(branchLocations, search, status),
    [branchLocations, search, status],
  );
  const totalPages = Math.max(1, Math.ceil(filteredLocations.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedLocations = filteredLocations.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const setSearch = useCallback((value: string) => {
    setSearchState(value);
    setPage(1);
  }, []);

  const setStatus = useCallback((value: LocationStatusFilter) => {
    setStatusState(value);
    setPage(1);
  }, []);

  const setPageSize = useCallback((value: number) => {
    setPageSizeState(value);
    setPage(1);
  }, []);

  async function runMutation(action: () => Promise<LocationListItem | null>) {
    setBusy(true);
    setError(null);
    try {
      const location = await action();
      await reload();
      return location;
    } catch (caughtError) {
      const message = cleanError(caughtError);
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }

  return {
    loading: (!apiMode && branchLoading) || (canLoad && (loading || loadedScope !== scopeKey)),
    busy,
    error,
    loadError,
    canRead,
    canManage,
    locations: branchLocations,
    currentBranchId: scopedBranchId,
    filteredLocations,
    paginatedLocations,
    search,
    status,
    page: currentPage,
    pageSize,
    totalPages,
    setSearch,
    setStatus,
    setPage,
    setPageSize,
    reload,
    create: (dto: LocationEditorDto) =>
      runMutation(async () => {
        if (!scopedBranchId)
          throw new Error("Selecciona una sucursal antes de crear la ubicación.");
        const created = await saveService.create({
          ...dto,
          branchId: scopedBranchId,
        });
        return getService
          .execute(scopedBranchId)
          .then((items) => items.find((item) => item.id === created.id) ?? null);
      }),
    update: (locationId: string, dto: LocationEditorDto) =>
      runMutation(async () => {
        const updated = await saveService.update(locationId, dto);
        return getService
          .execute(dto.branchId)
          .then((items) => items.find((item) => item.id === updated.id) ?? null);
      }),
    archive: (locationId: string) =>
      runMutation(async () => {
        await saveService.archive(locationId);
        return null;
      }),
    restore: (locationId: string) =>
      runMutation(async () => {
        await saveService.restore(locationId);
        return null;
      }),
  };
}

function filterLocations(
  locations: LocationListItem[],
  search: string,
  status: LocationStatusFilter,
) {
  const query = search.trim().toLowerCase();

  return locations.filter((location) => {
    const matchesStatus = location.status === status;
    const matchesSearch =
      !query ||
      [location.name, location.code, location.description]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query));

    return matchesStatus && matchesSearch;
  });
}
