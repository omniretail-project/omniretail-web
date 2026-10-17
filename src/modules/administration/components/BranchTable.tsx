import { BranchStatus, BranchType } from "@/core/enums";
import type { BranchDto } from "@/modules/administration/application/dto/BranchDto";
import { Button } from "@/shared/components/Button";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { StatusBadge } from "@/shared/components/StatusBadge";

const branchTypeLabels: Record<BranchType, string> = {
  [BranchType.main]: "Principal",
  [BranchType.store]: "Tienda",
  [BranchType.warehouse]: "Bodega",
};

interface BranchTableProps {
  branches: BranchDto[];
  canManage: boolean;
  onArchive: (branch: BranchDto) => void;
  onEdit: (branch: BranchDto) => void;
}

export function BranchTable({ branches, canManage, onArchive, onEdit }: BranchTableProps) {
  const columns: DataTableColumn<BranchDto>[] = [
    {
      key: "code",
      header: "Código",
      cell: (branch) => (
        <span className="font-semibold text-[var(--color-title)]">{branch.code}</span>
      ),
    },
    {
      key: "name",
      header: "Nombre",
      cell: (branch) => <span className="text-[var(--color-text)]">{branch.name}</span>,
    },
    {
      key: "type",
      header: "Tipo",
      cell: (branch) => (
        <span className="text-[var(--color-text)]">{branchTypeLabels[branch.type]}</span>
      ),
    },
    {
      key: "address",
      header: "Dirección",
      cell: (branch) => (
        <span className="text-[var(--color-text-muted)]">{branch.address ?? "—"}</span>
      ),
    },
    {
      key: "status",
      header: "Estado",
      cell: (branch) => <StatusBadge status={branch.status} />,
    },
  ];

  if (canManage) {
    columns.push({
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (branch) => (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            className="min-h-9 px-3 py-1.5"
            onClick={() => onEdit(branch)}
            type="button"
            variant="ghost"
          >
            Editar
          </Button>
          {branch.status !== BranchStatus.archived ? (
            <Button
              className="min-h-9 px-3 py-1.5"
              onClick={() => onArchive(branch)}
              type="button"
              variant="danger"
            >
              Archivar
            </Button>
          ) : null}
        </div>
      ),
    });
  }

  return (
    <DataTable
      columns={columns}
      data={branches}
      emptyMessage="Aún no hay sucursales registradas."
      rowKey={(branch) => branch.id}
    />
  );
}
