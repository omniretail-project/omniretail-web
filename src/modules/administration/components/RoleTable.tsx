"use client";

import type { RoleDto } from "@/modules/administration/application/dto/RoleDto";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { StatusBadge } from "@/shared/components/StatusBadge";

interface RoleTableProps {
  roles: RoleDto[];
  onSelect: (role: RoleDto) => void;
}

export function RoleTable({ roles, onSelect }: RoleTableProps) {
  const columns: DataTableColumn<RoleDto>[] = [
    {
      key: "name",
      header: "Nombre",
      cell: (role) => (
        <div>
          <span className="font-semibold text-[var(--color-title)]">{role.name}</span>
          {role.isSystem ? (
            <span className="ml-2 rounded-full bg-[var(--color-app-background)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
              Sistema
            </span>
          ) : null}
          {role.description ? (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{role.description}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "permissions",
      header: "Permisos",
      cell: (role) => (
        <span className="text-sm text-[var(--color-text-muted)]">
          {role.permissions.length} permisos
        </span>
      ),
    },
    {
      key: "status",
      header: "Estado",
      cell: (role) => <StatusBadge status={role.status} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={roles}
      emptyMessage="Aún no hay roles registrados."
      headerClassName="bg-[var(--color-structure)] text-white [&_th]:text-white"
      onRowClick={onSelect}
      rowKey={(role) => role.id}
    />
  );
}
