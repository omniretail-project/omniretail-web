import type { ReactNode } from "react";
import type {
  MovementReportRow,
  PaymentReportRow,
  PurchasesReportRow,
  SalesReportRow,
} from "@/modules/administration/application/dto/ReportDto";
import {
  getMovementTypeLabel,
  getPaymentMethodLabel,
} from "@/modules/administration/application/reportLabels";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { cn } from "@/shared/utils/cn";
import { formatCurrency } from "@/shared/utils/formatCurrency";
import { formatDate } from "@/shared/utils/formatDate";

export interface ReportColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface ReportTableProps<T> {
  columns: ReportColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
}

export function ReportTable<T>({ columns, rows, rowKey }: ReportTableProps<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse text-left text-sm">
        <thead className="bg-[var(--color-structure)] text-white">
          <tr>
            {columns.map((column) => (
              <th
                className={cn("px-4 py-3.5 font-semibold", column.className)}
                key={column.key}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                className="px-4 py-12 text-center text-[var(--color-text-muted)]"
                colSpan={columns.length}
              >
                <p className="font-medium text-[var(--color-text)]">No hay registros disponibles</p>
                <p className="mt-1 text-xs">Ajuste los filtros para consultar otros resultados.</p>
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                className="border-t border-[var(--color-border)] transition-colors hover:bg-slate-50/80 motion-reduce:transition-none"
                key={rowKey(row, index)}
              >
                {columns.map((column) => (
                  <td className={cn("px-4 py-3.5 align-middle", column.className)} key={column.key}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export const salesReportColumns: ReportColumn<SalesReportRow>[] = [
  { key: "number", header: "Número", cell: (row) => row.number },
  { key: "date", header: "Fecha", cell: (row) => formatDate(row.date), className: "whitespace-nowrap" },
  { key: "branch", header: "Sucursal", cell: (row) => row.branchName },
  { key: "status", header: "Estado", cell: (row) => <StatusBadge status={row.status} /> },
  {
    key: "subtotal",
    header: "Subtotal",
    cell: (row) => formatCurrency(row.subtotal),
    className: "text-right whitespace-nowrap tabular-nums",
  },
  {
    key: "discount",
    header: "Descuento",
    cell: (row) => formatCurrency(row.discountTotal),
    className: "text-right whitespace-nowrap tabular-nums",
  },
  {
    key: "tax",
    header: "Impuesto",
    cell: (row) => formatCurrency(row.taxTotal),
    className: "text-right whitespace-nowrap tabular-nums",
  },
  {
    key: "total",
    header: "Total",
    cell: (row) => formatCurrency(row.total),
    className: "text-right whitespace-nowrap font-semibold tabular-nums",
  },
];

export const purchasesReportColumns: ReportColumn<PurchasesReportRow>[] = [
  { key: "number", header: "Número", cell: (row) => row.number },
  { key: "date", header: "Fecha", cell: (row) => formatDate(row.date), className: "whitespace-nowrap" },
  { key: "branch", header: "Sucursal", cell: (row) => row.branchName },
  { key: "supplier", header: "Proveedor", cell: (row) => row.supplierName },
  { key: "status", header: "Estado", cell: (row) => <StatusBadge status={row.status} /> },
  {
    key: "subtotal",
    header: "Subtotal",
    cell: (row) => formatCurrency(row.subtotal),
    className: "text-right whitespace-nowrap tabular-nums",
  },
  {
    key: "total",
    header: "Total",
    cell: (row) => formatCurrency(row.total),
    className: "text-right whitespace-nowrap font-semibold tabular-nums",
  },
];

export const movementReportColumns: ReportColumn<MovementReportRow>[] = [
  { key: "date", header: "Fecha", cell: (row) => formatDate(row.date), className: "whitespace-nowrap" },
  { key: "branch", header: "Sucursal", cell: (row) => row.branchName },
  { key: "product", header: "Producto", cell: (row) => row.productName },
  { key: "type", header: "Tipo", cell: (row) => getMovementTypeLabel(row.type) },
  {
    key: "quantity",
    header: "Cantidad",
    cell: (row) => row.quantity,
    className: "text-right tabular-nums",
  },
  { key: "reason", header: "Motivo", cell: (row) => row.reason },
];

export const paymentReportColumns: ReportColumn<PaymentReportRow>[] = [
  { key: "date", header: "Fecha", cell: (row) => formatDate(row.date), className: "whitespace-nowrap" },
  { key: "method", header: "Método", cell: (row) => getPaymentMethodLabel(row.method) },
  { key: "status", header: "Estado", cell: (row) => <StatusBadge status={row.status} /> },
  {
    key: "amount",
    header: "Monto",
    cell: (row) => formatCurrency(row.amount),
    className: "text-right whitespace-nowrap font-semibold tabular-nums",
  },
  { key: "reference", header: "Referencia", cell: (row) => row.reference },
  { key: "origin", header: "Origen", cell: (row) => row.origin },
];
