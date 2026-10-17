"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CategoryStatus } from "@/core/enums";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { useDataEvent } from "@/shared/hooks/useDataEvent";
import type {
  CategoryEditorDto,
  CategoryListItem,
} from "@/modules/catalog/application/dto/CategoryEditorDto";
import { GetCategoriesService } from "@/modules/catalog/application/services/GetCategoriesService";
import { SaveCategoryService } from "@/modules/catalog/application/services/SaveCategoryService";
import { cleanError } from "@/modules/catalog/application/services/serviceHelpers";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";

export type CategoryStatusFilter = CategoryStatus.active | CategoryStatus.archived;

const DEFAULT_PAGE_SIZE = 10;

export function useCategories() {
  const repositories = useRepositories();
  const { hasPermission } = useCurrentSession();
  const canRead = hasPermission("catalog.categories.read") || hasPermission("catalog.categories.manage");
  const canManage = hasPermission("catalog.categories.manage");
  const getService = useMemo(() => new GetCategoriesService(repositories), [repositories]);
  const saveService = useMemo(() => new SaveCategoryService(repositories), [repositories]);
  const [categories, setCategories] = useState<CategoryListItem[]>([]);
  const [search, setSearchState] = useState("");
  const [status, setStatusState] = useState<CategoryStatusFilter>(CategoryStatus.active);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCategories(await getService.execute());
    } catch {
      setError("No se pudieron cargar las categorías.");
    } finally {
      setLoading(false);
    }
  }, [getService]);

  useDataEvent("category.changed", reload);
  useDataEvent("product.changed", reload);

  useEffect(() => {
    let active = true;
    getService
      .execute()
      .then((nextCategories) => {
        if (!active) return;
        setCategories(nextCategories);
        setError(null);
      })
      .catch(() => {
        if (active) setError("No se pudieron cargar las categorías.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [getService]);

  const filteredCategories = useMemo(
    () => filterCategories(categories, search, status),
    [categories, search, status],
  );
  const totalPages = Math.max(1, Math.ceil(filteredCategories.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedCategories = filteredCategories.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const setSearch = useCallback((value: string) => {
    setSearchState(value);
    setPage(1);
  }, []);

  const setStatus = useCallback((value: CategoryStatusFilter) => {
    setStatusState(value);
    setPage(1);
  }, []);

  const setPageSize = useCallback((value: number) => {
    setPageSizeState(value);
    setPage(1);
  }, []);

  async function runMutation(action: () => Promise<CategoryListItem | null>) {
    setBusy(true);
    setError(null);
    try {
      const category = await action();
      await reload();
      return category;
    } catch (caughtError) {
      const message = cleanError(caughtError);
      setError(message);
      await reload();
      if (caughtError instanceof Error) throw caughtError;
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
    categories,
    filteredCategories,
    paginatedCategories,
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
    create: (dto: CategoryEditorDto) =>
      runMutation(async () => {
        const created = await saveService.create(dto);
        return getService
          .execute()
          .then((items) => items.find((item) => item.id === created.id) ?? null);
      }),
    update: (categoryId: string, dto: CategoryEditorDto) =>
      runMutation(async () => {
        const updated = await saveService.update(categoryId, dto);
        return getService
          .execute()
          .then((items) => items.find((item) => item.id === updated.id) ?? null);
      }),
    archive: (categoryId: string) =>
      runMutation(async () => {
        await saveService.archive(categoryId);
        return null;
      }),
    restore: (categoryId: string) =>
      runMutation(async () => {
        await saveService.restore(categoryId);
        return null;
      }),
  };
}

function filterCategories(
  categories: CategoryListItem[],
  search: string,
  status: CategoryStatusFilter,
) {
  const query = search.trim().toLowerCase();

  return categories.filter((category) => {
    const matchesStatus = category.status === status;
    const matchesSearch =
      !query ||
      [category.name, category.slug, category.code, category.parentName]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query));

    return matchesStatus && matchesSearch;
  });
}
