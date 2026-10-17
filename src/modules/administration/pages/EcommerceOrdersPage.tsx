"use client";

import { useState } from "react";
import { OrderStatus } from "@/core/enums";
import type { EcommerceOrderDto } from "@/modules/administration/application/dto/EcommerceOrderDto";
import { EcommerceOrderDetailView } from "@/modules/administration/components/EcommerceOrderDetailView";
import { EcommerceOrdersTable } from "@/modules/administration/components/EcommerceOrdersTable";
import { useEcommerceOrders } from "@/modules/administration/hooks/useEcommerceOrders";
import { AccessDeniedState } from "@/shared/components/AccessDeniedState";
import { Button } from "@/shared/components/Button";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Modal } from "@/shared/components/Modal";
import { PageHeader } from "@/shared/components/PageHeader";
import { Select } from "@/shared/components/Select";
import { TablePagination } from "@/shared/components/TablePagination";
import { useToast } from "@/shared/components/Toast";

export function EcommerceOrdersPage() {
  const {
    busy,
    canManage,
    canRead,
    changePage,
    changePageSize,
    changeStatus,
    error,
    loading,
    page,
    pageSize,
    reload,
    result,
    setFilter,
    status,
  } = useEcommerceOrders();
  const { showToast } = useToast();
  const [selectedOrder, setSelectedOrder] = useState<EcommerceOrderDto | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    order: EcommerceOrderDto;
    status: OrderStatus;
  } | null>(null);

  if (!loading && !canRead) return <AccessDeniedState />;

  async function applyStatusChange() {
    if (!pendingAction) return;
    try {
      const updated = await changeStatus(pendingAction.order, pendingAction.status);
      setSelectedOrder((current) => (current?.id === updated.id ? updated : current));
      showToast({
        title: pendingAction.status === OrderStatus.confirmed ? "Pedido confirmado" : "Pedido cancelado",
        tone: "success",
      });
      setPendingAction(null);
    } catch (caughtError) {
      showToast({
        title: "No se pudo actualizar el pedido",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <PageHeader
        description="Consulte y gestione los pedidos realizados en la tienda en línea."
        title="Pedidos e-commerce"
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <label className="grid gap-1 text-sm font-medium text-[var(--color-text)]">
          Estado
          <Select
            aria-label="Filtrar pedidos por estado"
            className="min-w-52"
            onChange={(event) => setFilter(event.target.value as typeof status)}
            value={status}
          >
            <option value="all">Todos los estados</option>
            {Object.values(OrderStatus).map((value) => (
              <option key={value} value={value}>
                {statusLabel(value)}
              </option>
            ))}
          </Select>
        </label>
      </div>

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
          <div className="flex min-h-56 items-center justify-center gap-3 text-sm font-medium text-[var(--color-text-muted)]">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-structure)]" />
            Cargando pedidos...
          </div>
        ) : (
          <>
            <EcommerceOrdersTable
              busy={busy}
              canManage={canManage}
              onCancel={(order) => setPendingAction({ order, status: OrderStatus.cancelled })}
              onConfirm={(order) => setPendingAction({ order, status: OrderStatus.confirmed })}
              onSelect={setSelectedOrder}
              orders={result.items}
            />
            <TablePagination
              ariaLabel="Paginación de pedidos e-commerce"
              itemLabel="pedidos"
              onPageChange={changePage}
              onPageSizeChange={changePageSize}
              page={page}
              pageSize={pageSize}
              totalItems={result.totalItems}
            />
          </>
        )}
      </section>

      <Modal
        onClose={() => setSelectedOrder(null)}
        open={Boolean(selectedOrder)}
        size="xl"
        subtitle="Productos, pago y datos de entrega del pedido."
        title={selectedOrder ? `Pedido ${selectedOrder.orderNumber}` : "Detalle del pedido"}
      >
        {selectedOrder ? <EcommerceOrderDetailView order={selectedOrder} /> : null}
      </Modal>

      <ConfirmDialog
        cancelLabel="Volver"
        confirmLabel={pendingAction?.status === OrderStatus.confirmed ? "Confirmar pedido" : "Cancelar pedido"}
        message={
          pendingAction?.status === OrderStatus.confirmed
            ? "El pedido quedará disponible para el flujo de logística."
            : "Se cancelará el pedido y se liberará la reserva de inventario correspondiente."
        }
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void applyStatusChange()}
        open={Boolean(pendingAction)}
        title={pendingAction?.status === OrderStatus.confirmed ? "Confirmar pedido" : "Cancelar pedido"}
      />
    </div>
  );
}

function statusLabel(status: OrderStatus) {
  const labels: Record<OrderStatus, string> = {
    [OrderStatus.pending]: "Pendiente",
    [OrderStatus.confirmed]: "Confirmado",
    [OrderStatus.preparing]: "Preparando",
    [OrderStatus.picking]: "Picking",
    [OrderStatus.packing]: "Empacando",
    [OrderStatus.ready_for_pickup]: "Listo para recoger",
    [OrderStatus.ready_for_dispatch]: "Listo para despacho",
    [OrderStatus.dispatched]: "Despachado",
    [OrderStatus.delivered]: "Entregado",
    [OrderStatus.cancelled]: "Cancelado",
  };
  return labels[status];
}
