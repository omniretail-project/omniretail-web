"use client";

import { useMemo, useState, type FormEvent } from "react";
import { permissionsConfig } from "@/config/permissions";
import { statusesConfig } from "@/config/statuses";
import { RoleStatus } from "@/core/enums";
import type { RoleDto, RoleInputDto } from "@/modules/administration/application/dto/RoleDto";
import {
  getEmployeeAssignablePermissions,
  groupPermissionsByModule,
  permissionModuleLabels,
} from "@/modules/administration/permissionModuleLabels";
import { ADMIN_FIELD_LIMITS } from "@/modules/administration/validation/adminFieldConstraints";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { Input } from "@/shared/components/Input";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Select } from "@/shared/components/Select";

/**
 * `archived` no es un estado asignable desde este formulario a propósito -- solo la acción
 * Archivar (`ArchiveRoleService`) puede llevar un rol ahí. Ver `role.validation.ts`.
 */
const statusOptions = [RoleStatus.active, RoleStatus.inactive];

interface RoleFormProps {
  role?: RoleDto;
  busy: boolean;
  /**
   * Permisos efectivos del actor actual -- determina qué checkboxes del catálogo puede marcar
   * (ticket "FIXES FOCALIZADOS" §2: `requestedPermissions ⊆ actorEffectivePermissions`). Es
   * únicamente UX: `ensureDelegatablePermissions` en el service sigue siendo quien realmente
   * aplica la regla, así que una llamada directa que se salte este formulario queda igual de
   * bloqueada.
   */
  actorPermissions: readonly string[];
  onCancel: () => void;
  onSubmit: (value: RoleInputDto) => Promise<void>;
}

export function RoleForm({ role, busy, actorPermissions, onCancel, onSubmit }: RoleFormProps) {
  const [value, setValue] = useState<RoleInputDto>(() => toRoleInput(role));
  const [errors, setErrors] = useState<{ name?: string; permissions?: string }>({});
  const [submitError, setSubmitError] = useState<string>();

  const permissionsByModule = useMemo(
    () => groupPermissionsByModule(getEmployeeAssignablePermissions(permissionsConfig)),
    [],
  );
  const actorPermissionSet = useMemo(() => new Set(actorPermissions), [actorPermissions]);

  function setField<Key extends keyof RoleInputDto>(key: Key, fieldValue: RoleInputDto[Key]) {
    const nextValue = { ...value, [key]: fieldValue } as RoleInputDto;
    setValue(nextValue);
    if (key === "name" && errors.name) {
      setErrors((current) => ({
        ...current,
        name: nextValue.name.trim() ? undefined : "Ingrese el nombre del rol.",
      }));
    }
  }

  function togglePermission(key: string, checked: boolean) {
    const permissions = new Set(value.permissions);
    if (checked) permissions.add(key);
    else permissions.delete(key);
    const nextValue = { ...value, permissions: [...permissions] };
    setValue(nextValue);
    if (errors.permissions) {
      setErrors((current) => ({
        ...current,
        permissions: nextValue.permissions.length ? undefined : "Seleccione al menos un permiso.",
      }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = {
      name: value.name.trim() ? undefined : "Ingrese el nombre del rol.",
      permissions: value.permissions.length ? undefined : "Seleccione al menos un permiso.",
    };
    setErrors(nextErrors);
    if (nextErrors.name || nextErrors.permissions) return;

    setSubmitError(undefined);
    try {
      await onSubmit(value);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "No se pudo guardar el rol.");
    }
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      {submitError ? <InlineAlert title={submitError} tone="danger" /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField error={errors.name} id="role-name" label="Nombre">
          <Input
            disabled={busy}
            id="role-name"
            maxLength={ADMIN_FIELD_LIMITS.role.name}
            onChange={(event) => setField("name", event.target.value)}
            required
            value={value.name}
          />
        </FormField>

        <FormField id="role-status" label="Estado">
          <Select
            disabled={busy}
            id="role-status"
            onChange={(event) => setField("status", event.target.value as RoleInputDto["status"])}
            value={value.status}
          >
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {statusesConfig[status]?.label ?? status}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <FormField id="role-description" label="Descripción">
        <textarea
          className="min-h-20 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          id="role-description"
          maxLength={ADMIN_FIELD_LIMITS.role.description}
          onChange={(event) => setField("description", event.target.value)}
          value={value.description ?? ""}
        />
      </FormField>

      <FormField
        hint="Los permisos no son texto libre: solo se pueden asignar los que ya existen en el catálogo de la app."
        error={errors.permissions}
        id="role-permissions"
        label={`Permisos (${value.permissions.length} seleccionados)`}
      >
        <div className="space-y-4 rounded-lg border border-[var(--color-border)] p-3">
          {permissionsByModule.map(([moduleKey, modulePermissions]) => (
            <div key={moduleKey}>
              <p className="text-xs font-bold uppercase text-[var(--color-text-muted)]">
                {permissionModuleLabels[moduleKey] ?? moduleKey}
              </p>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {modulePermissions.map((permission) => {
                  const checked = value.permissions.includes(permission.key);
                  const delegable = actorPermissionSet.has(permission.key);
                  // Un permiso ya marcado siempre se puede desmarcar (reducir nunca es
                  // escalación) -- lo que se bloquea es agregar uno que el actor no tiene. Así,
                  // editar un rol que otro admin con más alcance dejó con permisos fuera del
                  // alcance actual del actor no queda en un callejón sin salida: se puede seguir
                  // guardando mientras no se agregue nada nuevo no delegable.
                  const disabled = busy || (!checked && !delegable);
                  return (
                    <label
                      className="flex items-start gap-2 text-sm text-[var(--color-text)]"
                      key={permission.key}
                      title={permission.description}
                    >
                      <input
                        checked={checked}
                        disabled={disabled}
                        onChange={(event) => togglePermission(permission.key, event.target.checked)}
                        type="checkbox"
                      />
                      <span>
                        {permission.name}
                        {!delegable ? (
                          <span className="ml-1.5 text-xs text-[var(--color-text-muted)]">
                            (No disponible para tu cuenta)
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </FormField>

      <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:justify-end">
        <Button disabled={busy} onClick={onCancel} type="button" variant="secondary">
          Cancelar
        </Button>
        <Button disabled={busy} type="submit">
          {busy ? "Guardando..." : role ? "Guardar cambios" : "Crear rol"}
        </Button>
      </div>
    </form>
  );
}

function toRoleInput(role?: RoleDto): RoleInputDto {
  if (role) {
    return {
      name: role.name,
      description: role.description,
      permissions: [...role.permissions],
      status: role.status,
    };
  }

  return {
    name: "",
    description: "",
    permissions: [],
    status: RoleStatus.active,
  };
}
