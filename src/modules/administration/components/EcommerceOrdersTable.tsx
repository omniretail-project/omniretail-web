"use client";

import { useMemo } from "react";
import { DeliveryMethod, OrderStatus } from "@/core/enums";
import type { EcommerceOrderDto } from "@/modules/administration/application/dto/EcommerceOrderDto";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { formatDate } from "@/shared/utils/formatDate";

interface EcommerceOrdersTableProps {
  orders: EcommerceOrderDto[];
  canManage: boolean;
  busy: boolean;
  onSelect: (order: EcommerceOrderDto) => void;
  onConfirm: (order: EcommerceOrderDto) => void;
  onCancel: (order: EcommerceOrderDto) => void;
}

export function EcommerceOrdersTable({
  orders,
  canManage,
  busy,
  onSelect,
  onConfirm,
  onCancel,
}: EcommerceOrdersTableProps) {
  const columns = useMemo<DataTableColumn<EcommerceOrderDto>[]>(
    () => [
      {
        key: "orderNumber",
        header: "Pedido",
        cell: (order) => (
          <div>
            <p className="font-semibold text-[var(--color-title)]">{order.orderNumber}</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{formatDate(order.createdAt)}</p>
          </div>
        ),
      },
      {
        key: "customer",
        header: "Cliente",
        cell: (order) => <span>{customerName(order) ?? "Invitado"}</span>,
      },
      {
        key: "deliveryMethod",
        header: "Entrega",
        cell: (order) => <span>{deliveryMethodLabel(order.deliveryMethod)}</span>,
      },
      {
        key: "total",
        header: "Total",
        className: "text-right whitespace-nowrap",
        cell: (order) => <span className="font-semibold tabular-nums">{formatAmount(order.total)}</span>,
      },
      {
        key: "status",
        header: "Estado",
        cell: (order) => <StatusBadge status={order.status} />,
      },
      {
        key: "actions",
        header: "Acciones",
        className: "text-right whitespace-nowrap",
        cell: (order) =>
          canManage ? (
            <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
              {order.status === OrderStatus.pending ? (
                <Button
                  className="min-h-9 px-3 py-1.5"
                  disabled={busy}
                  onClick={() => onConfirm(order)}
                  type="button"
                >
                  Confirmar
                </Button>
              ) : null}
              {canCancel(order.status) ? (
                <Button
                  className="min-h-9 px-3 py-1.5"
                  disabled={busy}
                  onClick={() => onCancel(order)}
                  type="button"
                  variant="danger"
                >
                  Cancelar
                </Button>
              ) : null}
              {order.status !== OrderStatus.pending && !canCancel(order.status) ? "—" : null}
            </div>
          ) : (
            "—"
          ),
      },
    ],
    [busy, canManage, onCancel, onConfirm],
  );

  return (
    <DataTable
      columns={columns}
      data={orders}
      emptyMessage="No hay pedidos e-commerce para los filtros seleccionados."
      headerClassName="bg-[var(--color-structure)] text-white [&_th]:text-white"
      onRowClick={onSelect}
      rowKey={(order) => order.id}
    />
  );
}

export function customerName(order: EcommerceOrderDto): string | null {
  if (order.customerName?.trim()) return order.customerName;
  const guest = order.guestCustomer;
  if (!guest) return null;
  return stringField(guest, "fullName") ?? stringField(guest, "name") ?? stringField(guest, "email");
}

export function deliveryMethodLabel(method: DeliveryMethod): string {
  return method === DeliveryMethod.store_pickup ? "Recoge en tienda" : "Entrega a domicilio";
}

export function formatAmount(value: number, currency = "GTQ") {
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

export function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

function canCancel(status: OrderStatus) {
  return status !== OrderStatus.cancelled && status !== OrderStatus.delivered;
}
