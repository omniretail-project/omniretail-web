import { CashMovementType } from "@/core/enums";
import type { CashMovementDto } from "@/modules/pos/application/dto/CashMovementDto";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { formatCurrency } from "@/shared/utils/formatCurrency";

const columns: DataTableColumn<CashMovementDto>[] = [
  {
    key: "createdAt",
    header: "Fecha",
    cell: (movement) => formatDateTime(movement.createdAt),
  },
  {
    key: "type",
    header: "Tipo",
    cell: (movement) => (
      <StatusBadge
        status={movement.type === CashMovementType.in ? "Ingreso" : "Egreso"}
        tone={movement.type === CashMovementType.in ? "success" : "warning"}
      />
    ),
  },
  {
    key: "reason",
    header: "Motivo",
    cell: (movement) => (movement.referenceType === "sale" ? "Venta" : movement.reason),
  },
  {
    key: "reference",
    header: "Referencia",
    cell: (movement) =>
      movement.referenceType === "sale" ? (movement.saleNumber ?? "No disponible") : "Manual",
  },
  {
    key: "amount",
    header: "Monto",
    className: "whitespace-nowrap text-right tabular-nums",
    cell: (movement) => (
      <span
        className={
          movement.type === CashMovementType.in
            ? "font-semibold text-[var(--color-success)]"
            : "font-semibold text-[var(--color-warning)]"
        }
      >
        {movement.type === CashMovementType.in ? "+" : "−"} {formatCurrency(movement.amount)}
      </span>
    ),
  },
];

export function CashMovementList({ movements }: { movements: CashMovementDto[] }) {
  return (
    <DataTable
      columns={columns}
      data={movements}
      emptyMessage="Este turno todavía no tiene movimientos."
      headerClassName="bg-[var(--color-structure)] text-xs uppercase tracking-wide text-white [&_th]:text-white"
      rowKey={(movement) => movement.id}
    />
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
