"use client";

import { useMemo, useState } from "react";
import { AccountStatus } from "@/core/enums";
import type { EmployeeDto } from "@/modules/administration/application/dto/EmployeeDto";
import { Button } from "@/shared/components/Button";
import { LinkIcon, PencilIcon, SendIcon } from "@/shared/components/icons";
import { DataTable, type DataTableColumn } from "@/shared/components/DataTable";
import { SearchInput } from "@/shared/components/SearchInput";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { TablePagination, type TablePageSize } from "@/shared/components/TablePagination";
import { formatDate } from "@/shared/utils/formatDate";

interface EmployeeTableProps {
  employees: EmployeeDto[];
  roleNames: ReadonlyMap<string, string>;
  branchNames: ReadonlyMap<string, string>;
  canManage: boolean;
  busy: boolean;
  onEdit: (employee: EmployeeDto) => void;
  onResendInvitation: (employee: EmployeeDto) => void;
  onCopyInvitation: (employee: EmployeeDto) => void;
}

/**
 * Estados en los que reintentar la invitación tiene sentido (ticket §1): sin cuenta todavía
 * (`authStatus` undefined -- p.ej. el alta creó el User pero `inviteEmployee` falló) o con una
 * invitación previa vencida/nunca aceptada (`password_reset_required`). Cualquier otro estado
 * (`active`, `temporarily_locked`, `disabled`, `archived`, `pending_verification`) ya lo rechaza
 * `AuthRepository.inviteEmployee` con su propio mensaje -- no tiene sentido ofrecer un botón que
 * siempre va a fallar, y así una cuenta `active` nunca puede reinvitarse por accidente desde acá.
 */
function canResendInvitation(authStatus: EmployeeDto["authStatus"]): boolean {
  return authStatus === undefined || authStatus === AccountStatus.password_reset_required;
}

export function EmployeeTable({
  employees,
  roleNames,
  branchNames,
  canManage,
  busy,
  onEdit,
  onResendInvitation,
  onCopyInvitation,
}: EmployeeTableProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<TablePageSize>(10);

  const filteredEmployees = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return employees;

    return employees.filter((employee) =>
      [employee.name, employee.email, employee.employeeCode ?? ""].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [employees, search]);

  const paginatedEmployees = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredEmployees.slice(start, start + pageSize);
  }, [filteredEmployees, page, pageSize]);

  function handleSearchChange(event: React.ChangeEvent<HTMLInputElement>) {
    setSearch(event.target.value);
    setPage(1);
  }

  function handlePageSizeChange(nextPageSize: TablePageSize) {
    setPageSize(nextPageSize);
    setPage(1);
  }

  const columns: DataTableColumn<EmployeeDto>[] = [
    {
      key: "name",
      header: "Empleado",
      cell: (employee) => (
        <div>
          <span className="font-semibold text-[var(--color-title)]">{employee.name}</span>
          {employee.employeeCode ? (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{employee.employeeCode}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "email",
      header: "Correo electrónico",
      cell: (employee) => <span className="text-[var(--color-text)]">{employee.email}</span>,
    },
    {
      key: "role",
      header: "Rol",
      cell: (employee) => (
        <span className="text-[var(--color-text)]">
          {employee.roleId ? (roleNames.get(employee.roleId) ?? employee.roleId) : "Sin rol"}
        </span>
      ),
    },
    {
      key: "branches",
      header: "Sucursales",
      cell: (employee) => {
        const names = employee.allowedBranchIds.map((id) => branchNames.get(id) ?? id);
        return (
          <span className="text-[var(--color-text)]">
            {names.length > 0 ? names.join(", ") : "—"}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Estado empleado",
      cell: (employee) => <StatusBadge status={employee.status} />,
    },
    {
      key: "authStatus",
      header: "Estado cuenta",
      cell: (employee) =>
        employee.authStatus ? (
          <StatusBadge status={employee.authStatus} />
        ) : (
          <span className="text-xs text-[var(--color-text-muted)]">Sin cuenta</span>
        ),
    },
    {
      key: "mfa",
      header: "MFA",
      cell: (employee) => (
        <StatusBadge
          status={employee.mfaEnabled ? "Activo" : "Inactivo"}
          tone={employee.mfaEnabled ? "success" : "neutral"}
        />
      ),
    },
    {
      key: "lastLoginAt",
      header: "Último acceso",
      cell: (employee) => (
        <span className="text-[var(--color-text)]">
          {employee.lastLoginAt ? formatDate(employee.lastLoginAt) : "Nunca"}
        </span>
      ),
    },
  ];

  if (canManage) {
    columns.push({
      key: "actions",
      header: <span className="sr-only">Acciones</span>,
      className: "text-right",
      cell: (employee) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          {employee.authStatus === AccountStatus.password_reset_required ? (
            <Button
              className="min-h-9 gap-1.5 px-3 py-1.5"
              disabled={busy}
              onClick={() => onCopyInvitation(employee)}
              title="Copiar enlace"
              type="button"
              variant="ghost"
            >
              <LinkIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Copiar enlace</span>
            </Button>
          ) : canResendInvitation(employee.authStatus) ? (
            <Button
              className="min-h-9 gap-1.5 px-3 py-1.5"
              disabled={busy}
              onClick={() => onResendInvitation(employee)}
              title="Enviar invitación"
              type="button"
              variant="ghost"
            >
              <SendIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Invitar</span>
            </Button>
          ) : null}
          <Button
            className="min-h-9 gap-1.5 px-3 py-1.5"
            onClick={() => onEdit(employee)}
            title="Editar"
            type="button"
            variant="ghost"
          >
            <PencilIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Editar</span>
          </Button>
        </div>
      ),
    });
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
        <SearchInput
          aria-label="Buscar empleados"
          onChange={handleSearchChange}
          placeholder="Buscar por nombre, correo o código"
          value={search}
        />
      </section>

      <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
        <DataTable
          columns={columns}
          data={paginatedEmployees}
          emptyMessage="No hay empleados para los filtros actuales."
          headerClassName="bg-[var(--color-structure)] text-white [&_th]:text-white"
          rowKey={(employee) => employee.id}
        />
        <TablePagination
          ariaLabel="Paginación de empleados"
          itemLabel="empleados"
          page={page}
          pageSize={pageSize}
          totalItems={filteredEmployees.length}
          onPageChange={setPage}
          onPageSizeChange={handlePageSizeChange}
        />
      </div>
    </div>
  );
}
