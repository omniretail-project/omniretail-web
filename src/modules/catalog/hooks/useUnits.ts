"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { UnitCategory, UnitStatus } from "@/core/enums";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import type { UnitEditorDto, UnitListItem } from "@/modules/catalog/application/dto/UnitEditorDto";
import { GetUnitsService } from "@/modules/catalog/application/services/GetUnitsService";
import { SaveUnitService } from "@/modules/catalog/application/services/SaveUnitService";
import { cleanError } from "@/modules/catalog/application/services/serviceHelpers";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";

export type UnitStatusFilter = UnitStatus.active | UnitStatus.archived;
export type UnitCategoryFilter = UnitCategory | "all";

const DEFAULT_PAGE_SIZE = 10;

export function useUnits() {
  const repositories = useRepositories();
  const { hasPermission } = useCurrentSession();
  const canRead = hasPermission("catalog.units.read") || hasPermission("catalog.units.manage");
  const canManage = hasPermission("catalog.units.manage");
  const getService = useMemo(() => new GetUnitsService(repositories), [repositories]);
  const saveService = useMemo(() => new SaveUnitService(repositories), [repositories]);
  const [units, setUnits] = useState<UnitListItem[]>([]);
  const [search, setSearchState] = useState("");
  const [category, setCategoryState] = useState<UnitCategoryFilter>("all");
  const [status, setStatusState] = useState<UnitStatusFilter>(UnitStatus.active);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUnits(await getService.execute());
    } catch {
      setError("No se pudieron cargar las unidades.");
    } finally {
      setLoading(false);
    }
  }, [getService]);

  useDataEvent("business-config.changed", reload);
  useDataEvent("product.changed", reload);
  useDataEvent("unit-conversion.changed", reload);

  useEffect(() => {
    let active = true;
    getService
      .execute()
      .then((nextUnits) => {
        if (!active) return;
        setUnits(nextUnits);
        setError(null);
      })
      .catch(() => {
        if (active) setError("No se pudieron cargar las unidades.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [getService]);

  const filteredUnits = useMemo(
    () => filterUnits(units, search, category, status),
    [category, search, status, units],
  );
  const totalPages = Math.max(1, Math.ceil(filteredUnits.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedUnits = filteredUnits.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const setSearch = useCallback((value: string) => {
    setSearchState(value);
    setPage(1);
  }, []);

  const setCategory = useCallback((value: UnitCategoryFilter) => {
    setCategoryState(value);
    setPage(1);
  }, []);

  const setStatus = useCallback((value: UnitStatusFilter) => {
    setStatusState(value);
    setPage(1);
  }, []);

  const setPageSize = useCallback((value: number) => {
    setPageSizeState(value);
    setPage(1);
  }, []);

  async function runMutation(action: () => Promise<UnitListItem | null>) {
    setBusy(true);
    setError(null);
    try {
      const unit = await action();
      await reload();
      return unit;
    } catch (caughtError) {
      const message = cleanError(caughtError);
      setError(message);
      throw new Error(message);
    } finally {
      setBusy(false);
    }
  }

  return {
    loading,
    busy,
    error,
    canRead,
    canManage,
    units,
    filteredUnits,
    paginatedUnits,
    search,
    category,
    status,
    page: currentPage,
    pageSize,
    totalPages,
    setSearch,
    setCategory,
    setStatus,
    setPage,
    setPageSize,
    reload,
    create: (dto: UnitEditorDto) =>
      runMutation(async () => {
        const created = await saveService.create(dto);
        return getService
          .execute()
          .then((items) => items.find((item) => item.id === created.id) ?? null);
      }),
    update: (unitId: string, dto: UnitEditorDto) =>
      runMutation(async () => {
        const updated = await saveService.update(unitId, dto);
        return getService
          .execute()
          .then((items) => items.find((item) => item.id === updated.id) ?? null);
      }),
    archive: (unitId: string) =>
      runMutation(async () => {
        await saveService.archive(unitId);
        return null;
      }),
    restore: (unitId: string) =>
      runMutation(async () => {
        await saveService.restore(unitId);
        return null;
      }),
  };
}

function filterUnits(
  units: UnitListItem[],
  search: string,
  category: UnitCategoryFilter,
  status: UnitStatusFilter,
) {
  const query = search.trim().toLowerCase();

  return units.filter((unit) => {
    const matchesStatus = unit.status === status;
    const matchesCategory = category === "all" || unit.category === category;
    const matchesSearch =
      !query ||
      [unit.name, unit.symbol, unit.code, unit.categoryLabel]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query));

    return matchesStatus && matchesCategory && matchesSearch;
  });
}
