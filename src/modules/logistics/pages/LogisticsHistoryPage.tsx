"use client";

import { LogisticsHistoryFilters } from "@/modules/logistics/components/LogisticsHistoryFilters";
import { LogisticsHistoryDetailModal } from "@/modules/logistics/components/LogisticsHistoryDetailModal";
import { LogisticsHistoryDispatchModal } from "@/modules/logistics/components/LogisticsHistoryDispatchModal";
import { LogisticsHistoryTable } from "@/modules/logistics/components/LogisticsHistoryTable";
import { useLogisticsHistory } from "@/modules/logistics/hooks/useLogisticsHistory";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { PageHeader } from "@/shared/components/PageHeader";
import { useToast } from "@/shared/components/Toast";

export function LogisticsHistoryPage() {
  const history = useLogisticsHistory();
  const { showToast } = useToast();
  const { pagination } = history;

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <PageHeader
        description={`Consulta pedidos preparados y finalizados de ${history.currentBranchName}.`}
        title="Historial de pedidos"
      />

      {history.error ? (
        <InlineAlert description={history.error} title="No se pudo consultar el historial" />
      ) : null}

      <LogisticsHistoryFilters
        disabled={history.loading || !history.hasBranchAccess || !history.canRead}
        filters={history.filters}
        onChange={history.updateFilters}
      />

      <section className="min-w-0 rounded-xl border border-[var(--color-border)] bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex flex-col gap-2 border-b border-[var(--color-border)] pb-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-[var(--color-title)] sm:text-lg">
              Pedidos preparados y finalizados
            </h2>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              La tabla queda preparada para abrir el detalle mediante doble clic en una fila.
            </p>
          </div>
          <span className="w-fit rounded-md bg-[var(--color-warning)]/20 px-2.5 py-1 text-xs font-semibold text-[var(--color-title)]">
            {pagination.totalItems} registros
          </span>
        </div>

        {history.loading ? (
          <div className="rounded-lg border border-[var(--color-border)] px-4 py-10 text-center text-sm text-[var(--color-text-muted)]">
            Consultando historial logístico...
          </div>
        ) : (
          <LogisticsHistoryTable
            canConfirmDispatch={history.canConfirmDispatch}
            currentPage={pagination.page}
            items={history.items}
            onAddGuide={(item) => void history.openDispatch(item)}
            onPageChange={history.setPage}
            onPageSizeChange={history.setPageSize}
            pageSize={pagination.pageSize}
            onRowDoubleClick={(item) => void history.openDetail(item)}
            serverTotalItems={pagination.mode === "server" ? pagination.totalItems : undefined}
          />
        )}
      </section>

      <LogisticsHistoryDetailModal
        detail={history.detail}
        error={history.detailError}
        loading={history.detailLoading}
        open={history.detailOpen}
        onClose={history.closeDetail}
      />
      <LogisticsHistoryDispatchModal
        key={history.dispatchDetail?.orderId ?? "history-dispatch-closed"}
        detail={history.dispatchDetail}
        error={history.dispatchError}
        loading={history.dispatchLoading}
        open={history.dispatchOpen}
        submitting={history.dispatchSubmitting}
        onClose={() => {
          history.closeDispatch();
        }}
        onConfirm={async (validation) => {
          const notificationContact = history.dispatchDetail?.notificationContact;
          const confirmed = await history.confirmDispatch(validation);
          if (confirmed && notificationContact?.emailMode === "send") {
            showToast({
              title: `Despacho confirmado. Guía enviada a ${notificationContact.email}`,
              tone: "success",
            });
          }
          return confirmed;
        }}
      />
    </div>
  );
}
