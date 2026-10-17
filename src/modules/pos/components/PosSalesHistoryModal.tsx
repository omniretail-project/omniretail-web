"use client";

import { useEffect, useState } from "react";
import type { PosSaleHistoryItemDto } from "@/modules/pos/application/dto/PosSaleHistoryDto";
import { PosSaleHistoryDetails } from "@/modules/pos/components/PosSaleHistoryDetails";
import { PosSaleProductsModal } from "@/modules/pos/components/PosSaleProductsModal";
import { PosSalesHistoryFilters } from "@/modules/pos/components/PosSalesHistoryFilters";
import { PosSalesHistoryTable } from "@/modules/pos/components/PosSalesHistoryTable";
import { usePosSalesHistory } from "@/modules/pos/hooks/usePosSalesHistory";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { TablePagination, type TablePageSize } from "@/shared/components/TablePagination";
import { KPICard } from "@/shared/components/KPICard";
import { Modal } from "@/shared/components/Modal";

interface PosSalesHistoryModalProps {
  open: boolean;
  onClose: () => void;
}

export function PosSalesHistoryModal({ open, onClose }: PosSalesHistoryModalProps) {
  const history = usePosSalesHistory(open);
  const [selectedSaleId, setSelectedSaleId] = useState<string>();
  const [productsSale, setProductsSale] = useState<PosSaleHistoryItemDto | null>(null);
  const selectedRow =
    history.sales.find((sale) => sale.saleId === selectedSaleId) ?? history.sales[0] ?? null;
  const selectedSale = selectedRow ? history.getLoadedSale(selectedRow.saleId) : null;
  const { loadSaleDetail } = history;
  const pendingDetailId = selectedRow && !selectedSale ? selectedRow.saleId : null;

  // En modo API el detalle se pide solo para la venta seleccionada.
  useEffect(() => {
    if (!pendingDetailId) return;
    window.queueMicrotask(() => void loadSaleDetail(pendingDetailId));
  }, [loadSaleDetail, pendingDetailId]);

  async function openProducts(saleId: string) {
    const sale = await history.loadSaleDetail(saleId);
    if (sale) setProductsSale(sale);
  }

  function closeHistory() {
    if (productsSale) {
      setProductsSale(null);
      return;
    }
    onClose();
  }

  return (
    <>
      <Modal
        density="compact"
        maxWidth="1440px"
        open={open}
        size="xl"
        subtitle="Consulte todas las facturas y tickets emitidos en la terminal."
        title="Historial de ventas"
        onClose={closeHistory}
      >
        <div className="space-y-3">
          <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5 [&>article]:rounded-lg [&>article]:p-3 [&>article>p:first-child]:text-xs [&>article>p:nth-child(2)]:mt-1 [&>article>p:nth-child(2)]:text-xl">
            <KPICard
              label="Total de ventas"
              loading={history.loading}
              value={history.summary.total}
            />
            <KPICard
              label="Completadas"
              loading={history.loading}
              tone="success"
              value={history.summary.active}
            />
            <KPICard
              label="Devolución parcial"
              loading={history.loading}
              tone="warning"
              value={history.summary.partiallyReturned}
            />
            <KPICard label="Devueltas" loading={history.loading} value={history.summary.returned} />
            <KPICard
              label="Anuladas"
              loading={history.loading}
              tone="danger"
              value={history.summary.cancelled}
            />
          </section>

          {history.error ? (
            <InlineAlert
              description={history.error}
              title={history.accessBlocked ? "Acceso bloqueado" : "No se pudo cargar el historial"}
              tone={history.accessBlocked ? "warning" : "danger"}
            />
          ) : null}

          <div className="[&_:has(>button)]:hidden">
            <PosSalesHistoryFilters
              disabled={history.loading || history.accessBlocked}
              filters={history.filters}
              onChange={history.updateFilters}
              onReset={history.resetFilters}
            />
          </div>

          {history.loading ? (
            <div
              aria-live="polite"
              className="flex min-h-64 items-center justify-center gap-3 rounded-lg border border-[var(--color-border)] text-sm font-medium text-[var(--color-text-muted)]"
            >
              <span
                aria-hidden="true"
                className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-structure)]"
              />
              Cargando historial de ventas...
            </div>
          ) : (
            <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,7fr)_minmax(300px,3fr)]">
              <div className="min-w-0 space-y-2">
                <PosSalesHistoryTable
                  sales={history.sales}
                  selectedSaleId={selectedRow?.saleId}
                  onOpenProducts={(sale) => void openProducts(sale.saleId)}
                  onSelect={setSelectedSaleId}
                />
                <TablePagination
                  ariaLabel="Paginación del historial de ventas"
                  itemLabel="ventas"
                  page={history.pagination.page}
                  pageSize={history.pagination.pageSize as TablePageSize}
                  totalItems={history.pagination.totalItems}
                  onPageChange={history.setPage}
                  onPageSizeChange={history.setPageSize}
                />
              </div>
              <PosSaleHistoryDetails
                error={selectedSale ? null : history.detailError}
                loading={history.detailLoadingId === selectedRow?.saleId}
                sale={selectedSale}
              />
            </div>
          )}
        </div>
      </Modal>

      <PosSaleProductsModal sale={productsSale} onClose={() => setProductsSale(null)} />
    </>
  );
}
