"use client";

import { useState, type FormEvent } from "react";
import { statusesConfig } from "@/config/statuses";
import { UserStatus } from "@/core/enums";
import type {
  EmployeeDto,
  EmployeeInputDto,
} from "@/modules/administration/application/dto/EmployeeDto";
import type { BranchOption, RoleOption } from "@/modules/administration/hooks/useEmployees";
import {
  ADMIN_FIELD_LIMITS,
  formatGuatemalaPhoneInput,
  isValidGuatemalaPhone,
} from "@/modules/administration/validation/adminFieldConstraints";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { Input } from "@/shared/components/Input";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Select } from "@/shared/components/Select";

/**
 * `archived` no es un estado asignable desde este formulario -- Employee no tiene flujo de
 * archivado en esta entrega (ver EmployeeDto.ts).
 */
const statusOptions = [UserStatus.active, UserStatus.inactive, UserStatus.blocked];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPLOYEE_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;
type EmployeeFieldErrors = Partial<
  Record<"name" | "employeeCode" | "email" | "phone" | "roleId", string>
>;

interface EmployeeFormProps {
  employee?: EmployeeDto;
  roleOptions: RoleOption[];
  branchOptions: BranchOption[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (value: EmployeeInputDto) => Promise<void>;
}

export function EmployeeForm({
  employee,
  roleOptions,
  branchOptions,
  busy,
  onCancel,
  onSubmit,
}: EmployeeFormProps) {
  const [value, setValue] = useState<EmployeeInputDto>(() => toEmployeeInput(employee));
  const [errors, setErrors] = useState<EmployeeFieldErrors>({});
  const [submitError, setSubmitError] = useState<string>();
  const isEdit = Boolean(employee);

  const visibleBranchIds = new Set(branchOptions.map((option) => option.id));
  const preservedBranchIds = value.allowedBranchIds.filter((id) => !visibleBranchIds.has(id));

  function setField<Key extends keyof EmployeeInputDto>(
    key: Key,
    fieldValue: EmployeeInputDto[Key],
  ) {
    const nextValue = { ...value, [key]: fieldValue } as EmployeeInputDto;
    setValue(nextValue);
    setErrors((currentErrors) => {
      const field = key as keyof EmployeeFieldErrors;
      if (!currentErrors[field]) return currentErrors;
      return { ...currentErrors, [field]: validateEmployeeFields(nextValue)[field] };
    });
  }

  function toggleBranch(branchId: string, checked: boolean) {
    setValue((current) => {
      const next = new Set(current.allowedBranchIds);
      if (checked) next.add(branchId);
      else next.delete(branchId);
      return { ...current, allowedBranchIds: [...next] };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateEmployeeFields(value);
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    setSubmitError(undefined);
    try {
      await onSubmit(value);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "No se pudo guardar el empleado.");
    }
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      {submitError ? <InlineAlert title={submitError} tone="danger" /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField error={errors.name} id="employee-name" label="Nombre">
          <Input
            disabled={busy}
            id="employee-name"
            maxLength={ADMIN_FIELD_LIMITS.employee.name}
            onChange={(event) => setField("name", event.target.value)}
            required
            value={value.name}
          />
        </FormField>

        <FormField
          hint="Letras, números, guión y guión bajo."
          error={errors.employeeCode}
          id="employee-code"
          label="Código de empleado"
        >
          <Input
            autoComplete="off"
            disabled={busy}
            id="employee-code"
            maxLength={ADMIN_FIELD_LIMITS.employee.employeeCode}
            onChange={(event) => setField("employeeCode", event.target.value)}
            placeholder="EMP-001"
            required
            value={value.employeeCode}
          />
        </FormField>

        <FormField
          hint={isEdit ? "El correo no se puede cambiar desde acá." : undefined}
          error={errors.email}
          id="employee-email"
          label="Correo electrónico"
        >
          <Input
            disabled={busy || isEdit}
            id="employee-email"
            maxLength={ADMIN_FIELD_LIMITS.employee.email}
            onChange={(event) => setField("email", event.target.value)}
            required
            type="email"
            value={value.email}
          />
        </FormField>

        <FormField error={errors.phone} id="employee-phone" label="Teléfono">
          <Input
            disabled={busy}
            id="employee-phone"
            maxLength={ADMIN_FIELD_LIMITS.employee.phone}
            onChange={(event) => setField("phone", formatGuatemalaPhoneInput(event.target.value))}
            placeholder="0000-0000"
            type="tel"
            value={value.phone ?? ""}
          />
        </FormField>

        <FormField error={errors.roleId} id="employee-role" label="Rol">
          <Select
            disabled={busy}
            id="employee-role"
            onChange={(event) => setField("roleId", event.target.value)}
            required
            value={value.roleId}
          >
            <option value="">Seleccionar rol</option>
            {roleOptions.map((option) => (
              <option disabled={!option.isDelegable} key={option.id} value={option.id}>
                {option.name}
                {option.isDelegable ? "" : " (permisos fuera de tu alcance)"}
              </option>
            ))}
          </Select>
        </FormField>

        <FormField id="employee-status" label="Estado">
          <Select
            disabled={busy}
            id="employee-status"
            onChange={(event) => setField("status", event.target.value as UserStatus)}
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

      <FormField
        hint="Solo las sucursales activas pueden habilitarse. Las que no figuran acá se conservan."
        id="employee-branches"
        label="Sucursales asignadas"
      >
        <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
          {branchOptions.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">No hay sucursales activas.</p>
          ) : (
            branchOptions.map((option) => (
              <label
                className="flex items-center gap-2 text-sm text-[var(--color-text)]"
                key={option.id}
              >
                <input
                  checked={value.allowedBranchIds.includes(option.id)}
                  disabled={busy}
                  onChange={(event) => toggleBranch(option.id, event.target.checked)}
                  type="checkbox"
                />
                {option.name}
              </label>
            ))
          )}
          {preservedBranchIds.length > 0 ? (
            <p className="text-xs text-[var(--color-text-muted)]">
              {preservedBranchIds.length} sucursal(es) fuera de la lista se mantienen asignadas.
            </p>
          ) : null}
        </div>
      </FormField>

      <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:justify-end">
        <Button disabled={busy} onClick={onCancel} type="button" variant="secondary">
          Cancelar
        </Button>
        <Button disabled={busy} type="submit">
          {busy ? "Guardando..." : employee ? "Guardar cambios" : "Crear empleado"}
        </Button>
      </div>
    </form>
  );
}

function validateEmployeeFields(value: EmployeeInputDto): EmployeeFieldErrors {
  const errors: EmployeeFieldErrors = {};
  if (!value.name.trim()) errors.name = "Ingrese el nombre del empleado.";
  if (!value.employeeCode.trim()) errors.employeeCode = "Ingrese el código de empleado.";
  else if (!EMPLOYEE_CODE_PATTERN.test(value.employeeCode.trim())) {
    errors.employeeCode = "Use letras, números, guión y guión bajo.";
  }
  if (!value.email.trim() || !EMAIL_PATTERN.test(value.email.trim())) {
    errors.email = "Ingrese un correo electrónico válido.";
  }
  if (value.phone?.trim() && !isValidGuatemalaPhone(value.phone)) {
    errors.phone = "El teléfono del empleado debe tener 8 dígitos.";
  }
  if (!value.roleId.trim()) errors.roleId = "Seleccione un rol para el empleado.";
  return errors;
}

function toEmployeeInput(employee?: EmployeeDto): EmployeeInputDto {
  if (employee) {
    return {
      name: employee.name,
      email: employee.email,
      phone: employee.phone,
      employeeCode: employee.employeeCode ?? "",
      roleId: employee.roleId ?? "",
      allowedBranchIds: [...employee.allowedBranchIds],
      status: employee.status,
    };
  }

  return {
    name: "",
    email: "",
    phone: "",
    employeeCode: "",
    roleId: "",
    allowedBranchIds: [],
    status: UserStatus.active,
  };
}
