"use client";

import { permissionsConfig } from "@/config/permissions";
import type { RoleDto } from "@/modules/administration/application/dto/RoleDto";
import {
  groupPermissionsByModule,
  permissionModuleLabels,
} from "@/modules/administration/permissionModuleLabels";
import { Button } from "@/shared/components/Button";
import { ArchiveIcon, PencilIcon } from "@/shared/components/icons";
import { StatusBadge } from "@/shared/components/StatusBadge";

interface RoleDetailViewProps {
  role: RoleDto;
  canManage: boolean;
  busy: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onClose: () => void;
}

export function RoleDetailView({ role, canManage, busy, onEdit, onArchive }: RoleDetailViewProps) {
  const rolePermissions = permissionsConfig.filter((p) => role.permissions.includes(p.key));
  const permissionsByModule = groupPermissionsByModule(rolePermissions);
  const isArchived = role.status === "archived";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-bold text-[var(--color-title)]">{role.name}</h3>
        <StatusBadge status={role.status} />
        {role.isSystem ? (
          <span className="rounded-full bg-[var(--color-app-background)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
            Sistema
          </span>
        ) : null}
      </div>

      {role.description ? (
        <p className="text-sm text-[var(--color-text-muted)]">{role.description}</p>
      ) : null}

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-[var(--color-title)]">
          Permisos ({rolePermissions.length})
        </h4>
        {rolePermissions.length === 0 ? (
          <p className="text-sm italic text-[var(--color-text-muted)]">
            Este rol no tiene permisos asignados.
          </p>
        ) : (
          <div className="space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-app-background)] p-4">
            {permissionsByModule.map(([moduleKey, modulePermissions]) => (
              <div key={moduleKey}>
                <p className="text-xs font-bold uppercase text-[var(--color-text-muted)]">
                  {permissionModuleLabels[moduleKey] ?? moduleKey}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {modulePermissions.map((permission) => (
                    <li
                      className="text-sm text-[var(--color-text)]"
                      key={permission.key}
                      title={permission.description}
                    >
                      {permission.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {canManage && !role.isSystem ? (
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:justify-end">
            {!isArchived ? (
              <Button className="gap-2" disabled={busy} onClick={onArchive} type="button" variant="danger">
                <ArchiveIcon className="h-4 w-4" />
                Archivar
              </Button>
            ) : null}
            <Button className="gap-2" disabled={busy} onClick={onEdit} type="button">
              <PencilIcon className="h-4 w-4" />
              Editar
            </Button>
        </div>
      ) : null}
    </div>
  );
}
