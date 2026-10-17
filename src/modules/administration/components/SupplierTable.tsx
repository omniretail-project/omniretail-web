import type { SupplierDto } from "@/modules/administration/application/dto/SupplierDto";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { StatusBadge } from "@/shared/components/StatusBadge";

interface SupplierTableProps {
  suppliers: SupplierDto[];
  onSelect: (supplier: SupplierDto) => void;
}

export function SupplierTable({ suppliers, onSelect }: SupplierTableProps) {
  const columns: DataTableColumn<SupplierDto>[] = [
    {
      key: "name",
      header: "Nombre",
      cell: (supplier) => (
        <div>
          <span className="font-semibold text-[var(--color-title)]">{supplier.name}</span>
          {supplier.legalName ? (
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{supplier.legalName}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "taxId",
      header: "NIT",
      cell: (supplier) => (
        <span className="font-mono text-[var(--color-text)]">{supplier.taxId || "—"}</span>
      ),
    },
    {
      key: "email",
      header: "Correo",
      cell: (supplier) => <span className="text-[var(--color-text)]">{supplier.email || "—"}</span>,
    },
    {
      key: "phone",
      header: "Teléfono",
      cell: (supplier) => <span className="text-[var(--color-text)]">{supplier.phone || "—"}</span>,
    },
    {
      key: "address",
      header: "Dirección",
      cell: (supplier) => (
        <span className="text-[var(--color-text-muted)]">{supplier.address || "—"}</span>
      ),
    },
    {
      key: "leadTimeDays",
      header: "Lead time",
      className: "text-right",
      cell: (supplier) => (
        <span className="text-[var(--color-text)]">
          {supplier.leadTimeDays != null ? `${supplier.leadTimeDays}d` : "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Estado",
      cell: (supplier) => <StatusBadge status={supplier.status} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={suppliers}
      emptyMessage="Aún no hay proveedores registrados."
      headerClassName="bg-[var(--color-structure)] text-white [&_th]:text-white"
      onRowClick={onSelect}
      rowKey={(supplier) => supplier.id}
    />
  );
}
