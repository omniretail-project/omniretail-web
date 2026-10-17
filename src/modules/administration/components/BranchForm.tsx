"use client";

import { useState, type FormEvent } from "react";
import { statusesConfig } from "@/config/statuses";
import { BranchStatus, BranchType } from "@/core/enums";
import type { BranchDto, BranchInputDto } from "@/modules/administration/application/dto/BranchDto";
import {
  ADMIN_FIELD_LIMITS,
  formatGuatemalaPhoneInput,
} from "@/modules/administration/validation/adminFieldConstraints";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { Input } from "@/shared/components/Input";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Select } from "@/shared/components/Select";

interface BranchFormProps {
  branch?: BranchDto;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (value: BranchInputDto) => Promise<void>;
}
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type BranchFieldErrors = Partial<Record<"code" | "name" | "email", string>>;

export function BranchForm({ branch, busy, onCancel, onSubmit }: BranchFormProps) {
  const [value, setValue] = useState<BranchInputDto>(() => toBranchInput(branch));
  const [errors, setErrors] = useState<BranchFieldErrors>({});
  const [submitError, setSubmitError] = useState<string>();

  function setField<Key extends keyof BranchInputDto>(key: Key, fieldValue: BranchInputDto[Key]) {
    const nextValue = { ...value, [key]: fieldValue } as BranchInputDto;
    setValue(nextValue);
    setErrors((currentErrors) => {
      const field = key as keyof BranchFieldErrors;
      if (!currentErrors[field]) return currentErrors;
      return { ...currentErrors, [field]: validateBranchFields(nextValue)[field] };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateBranchFields(value);
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    setSubmitError(undefined);
    try {
      await onSubmit(value);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "No se pudo guardar la sucursal.");
    }
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      {submitError ? <InlineAlert title={submitError} tone="danger" /> : null}
      <div className="grid gap-4 rounded-xl bg-slate-50/70 p-4 sm:grid-cols-2">
        <FormField error={errors.code} id="branch-code" label="Código">
          <Input
            autoComplete="off"
            disabled={busy}
            id="branch-code"
            maxLength={ADMIN_FIELD_LIMITS.branch.code}
            onChange={(event) => setField("code", event.target.value)}
            required
            value={value.code}
          />
        </FormField>

        <FormField error={errors.name} id="branch-name" label="Nombre">
          <Input
            disabled={busy}
            id="branch-name"
            maxLength={ADMIN_FIELD_LIMITS.branch.name}
            onChange={(event) => setField("name", event.target.value)}
            required
            value={value.name}
          />
        </FormField>

        <FormField id="branch-type" label="Tipo">
          <Select
            disabled={busy}
            id="branch-type"
            onChange={(event) => setField("type", event.target.value as BranchType)}
            value={value.type}
          >
            <option value={BranchType.main}>Principal</option>
            <option value={BranchType.store}>Tienda</option>
            <option value={BranchType.warehouse}>Bodega</option>
          </Select>
        </FormField>

        <FormField id="branch-status" label="Estado">
          <Select
            disabled={busy}
            id="branch-status"
            onChange={(event) => setField("status", event.target.value as BranchStatus)}
            value={value.status}
          >
            {Object.values(BranchStatus).map((status) => (
              <option key={status} value={status}>
                {statusesConfig[status]?.label ?? status}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <FormField id="branch-address" label="Dirección">
        <Input
          disabled={busy}
          id="branch-address"
          maxLength={ADMIN_FIELD_LIMITS.branch.address}
          onChange={(event) => setField("address", event.target.value)}
          value={value.address ?? ""}
        />
      </FormField>

      <div className="grid gap-4 rounded-xl bg-slate-50/70 p-4 sm:grid-cols-2">
        <FormField id="branch-phone" label="Teléfono">
          <Input
            autoComplete="tel"
            disabled={busy}
            id="branch-phone"
            maxLength={ADMIN_FIELD_LIMITS.branch.phone}
            onChange={(event) => setField("phone", formatGuatemalaPhoneInput(event.target.value))}
            placeholder="0000-0000"
            type="tel"
            value={value.phone ?? ""}
          />
        </FormField>

        <FormField error={errors.email} id="branch-email" label="Correo electrónico">
          <Input
            autoComplete="email"
            disabled={busy}
            id="branch-email"
            maxLength={ADMIN_FIELD_LIMITS.branch.email}
            onChange={(event) => setField("email", event.target.value)}
            type="email"
            value={value.email ?? ""}
          />
        </FormField>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:justify-end">
        <Button disabled={busy} onClick={onCancel} type="button" variant="secondary">
          Cancelar
        </Button>
        <Button disabled={busy} type="submit">
          {busy ? "Guardando..." : branch ? "Guardar cambios" : "Crear sucursal"}
        </Button>
      </div>
    </form>
  );
}

function validateBranchFields(value: BranchInputDto): BranchFieldErrors {
  const errors: BranchFieldErrors = {};
  if (!value.code.trim()) errors.code = "Ingrese el código de la sucursal.";
  if (!value.name.trim()) errors.name = "Ingrese el nombre de la sucursal.";
  if (value.email?.trim() && !EMAIL_PATTERN.test(value.email.trim())) {
    errors.email = "Ingrese un correo electrónico válido.";
  }
  return errors;
}

function toBranchInput(branch?: BranchDto): BranchInputDto {
  if (branch) {
    return {
      code: branch.code,
      name: branch.name,
      type: branch.type,
      address: branch.address,
      phone: branch.phone,
      email: branch.email,
      status: branch.status,
    };
  }

  return {
    code: "",
    name: "",
    type: BranchType.store,
    address: "",
    phone: "",
    email: "",
    status: BranchStatus.active,
  };
}
