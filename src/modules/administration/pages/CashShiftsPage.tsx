"use client";

import { useMemo, useState } from "react";
import { CashShiftFilters } from "@/modules/administration/components/CashShiftFilters";
import { CashShiftTable } from "@/modules/administration/components/CashShiftTable";
import { useCashShifts } from "@/modules/administration/hooks/useCashShifts";
import { AccessDeniedState } from "@/shared/components/AccessDeniedState";
import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { PageHeader } from "@/shared/components/PageHeader";
import { TablePagination, type TablePageSize } from "@/shared/components/TablePagination";

const DEFAULT_PAGE_SIZE: TablePageSize = 10;

export function CashShiftsPage() {
  const {
    actorNames,
    branchNames,
    canRead,
    error,
    filter,
    filteredShifts,
    loading,
    reload,
    resetFilter,
    setFilter,
    shifts,
  } = useCashShifts();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<TablePageSize>(DEFAULT_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filteredShifts.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedShifts = useMemo(
    () => filteredShifts.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, filteredShifts, pageSize],
  );

  if (!loading && !canRead) {
    return <AccessDeniedState />;
  }

  function updateFilter(nextFilter: typeof filter) {
    setFilter(nextFilter);
    setPage(1);
  }

  function clearFilter() {
    resetFilter();
    setPage(1);
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <PageHeader
        description="Consulte aperturas, cierres y diferencias de los turnos de caja."
        title="Caja"
      />

      <CashShiftFilters
        branchNames={branchNames}
        filter={filter}
        shifts={shifts}
        onChange={updateFilter}
        onReset={clearFilter}
      />

      {error ? (
        <InlineAlert
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          title={error}
          tone="danger"
        >
          <Button onClick={() => void reload()} type="button" variant="secondary">
            Reintentar
          </Button>
        </InlineAlert>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
        {loading ? (
          <div
            aria-live="polite"
            className="flex min-h-56 items-center justify-center gap-3 text-sm font-medium text-[var(--color-text-muted)]"
          >
            <span
              aria-hidden="true"
              className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-structure)]"
            />
            Cargando turnos de caja...
          </div>
        ) : (
          <>
            <CashShiftTable
              actorNames={actorNames}
              branchNames={branchNames}
              shifts={paginatedShifts}
            />
            <TablePagination
              ariaLabel="Paginación de turnos de caja"
              itemLabel="turnos"
              page={currentPage}
              pageSize={pageSize}
              totalItems={filteredShifts.length}
              onPageChange={setPage}
              onPageSizeChange={(nextPageSize) => {
                setPageSize(nextPageSize);
                setPage(1);
              }}
            />
          </>
        )}
      </section>
    </div>
  );
}
