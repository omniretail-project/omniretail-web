"use client";

import { useMemo, useState } from "react";
import type {
  MovementReportRow,
  PaymentReportRow,
  PurchasesReportRow,
  ReportFilter,
  ReportKind,
  ReportRow,
  SalesReportRow,
} from "@/modules/administration/application/dto/ReportDto";
import { ReportFilters } from "@/modules/administration/components/ReportFilters";
import { ReportsExportModal } from "@/modules/administration/components/ReportsExportModal";
import {
  movementReportColumns,
  paymentReportColumns,
  purchasesReportColumns,
  ReportTable,
  salesReportColumns,
} from "@/modules/administration/components/ReportTable";
import { ReportTotals } from "@/modules/administration/components/ReportTotals";
import { useReports } from "@/modules/administration/hooks/useReports";
import { AccessDeniedState } from "@/shared/components/AccessDeniedState";
import { Button } from "@/shared/components/Button";
import { DownloadIcon } from "@/shared/components/icons";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { PageHeader } from "@/shared/components/PageHeader";
import { TablePagination, type TablePageSize } from "@/shared/components/TablePagination";

const DEFAULT_PAGE_SIZE: TablePageSize = 10;

export function ReportsPage() {
  const {
    canExport,
    canRead,
    data,
    error,
    exportConfigs,
    filter,
    kind,
    loading,
    reload,
    resetFilter,
    rows,
    setFilter,
    setKind,
    totals,
  } = useReports();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<TablePageSize>(DEFAULT_PAGE_SIZE);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedRows = useMemo(
    () => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, pageSize, rows],
  );

  if (!loading && !canRead) {
    return <AccessDeniedState />;
  }

  function changeKind(nextKind: ReportKind) {
    setKind(nextKind);
    setPage(1);
  }

  function changeFilter(nextFilter: ReportFilter) {
    setFilter(nextFilter);
    setPage(1);
  }

  function clearFilter() {
    resetFilter();
    setPage(1);
  }

  return (
    <div className="mx-auto min-w-0 max-w-7xl space-y-5">
      <PageHeader
        actions={
          <div className="flex flex-col items-end gap-1">
            <Button
              className="gap-2"
              disabled={!canExport || loading}
              onClick={() => setIsExportModalOpen(true)}
              title={canExport ? undefined : "Exportar Excel requiere Reportes avanzados y el permiso admin.reports.export"}
              type="button"
            >
              <DownloadIcon className="h-4 w-4" />
              Exportar Excel
            </Button>
            {!canExport ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                Requerí el módulo Reportes avanzados para exportar.
              </p>
            ) : null}
          </div>
        }
        description="Consultá información consolidada de ventas, compras, inventario y pagos."
        title="Reportes"
      />

      {error ? (
        <InlineAlert className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" title={error} tone="danger">
          <Button onClick={() => void reload()} type="button" variant="secondary">
            Reintentar
          </Button>
        </InlineAlert>
      ) : null}

      <ReportFilters
        data={data}
        filter={filter}
        kind={kind}
        onChange={changeFilter}
        onKindChange={changeKind}
        onReset={clearFilter}
      />

      {loading ? (
        <div
          aria-live="polite"
          className="flex min-h-48 items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-sm font-medium text-[var(--color-text-muted)] shadow-sm"
        >
          <span
            aria-hidden="true"
            className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-structure)]"
          />
          Cargando reportes...
        </div>
      ) : (
        <>
          <ReportTotals totals={totals} />
          <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
            <ActiveReportTable kind={kind} rows={paginatedRows} />
            <TablePagination
              ariaLabel="Paginación del reporte"
              itemLabel="registros"
              page={currentPage}
              pageSize={pageSize}
              totalItems={rows.length}
              onPageChange={setPage}
              onPageSizeChange={(nextPageSize) => {
                setPageSize(nextPageSize);
                setPage(1);
              }}
            />
          </section>
        </>
      )}

      {isExportModalOpen && (
        <ReportsExportModal
          open={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          data={data}
          initialKind={kind}
          initialFilter={filter}
          onExport={exportConfigs}
        />
      )}
    </div>
  );
}

function ActiveReportTable({ kind, rows }: { kind: ReportKind; rows: ReportRow[] }) {
  if (kind === "sales") {
    return (
      <ReportTable
        columns={salesReportColumns}
        rowKey={(row, index) => `${row.number}-${row.date}-${index}`}
        rows={rows as SalesReportRow[]}
      />
    );
  }
  if (kind === "purchases") {
    return (
      <ReportTable
        columns={purchasesReportColumns}
        rowKey={(row, index) => `${row.number}-${row.date}-${index}`}
        rows={rows as PurchasesReportRow[]}
      />
    );
  }
  if (kind === "movements") {
    return (
      <ReportTable
        columns={movementReportColumns}
        rowKey={(row, index) => `${row.date}-${row.branchId}-${row.productName}-${index}`}
        rows={rows as MovementReportRow[]}
      />
    );
  }
  return (
    <ReportTable
      columns={paymentReportColumns}
      rowKey={(row, index) => `${row.date}-${row.reference}-${index}`}
      rows={rows as PaymentReportRow[]}
    />
  );
}
