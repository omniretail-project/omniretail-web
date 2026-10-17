"use client";

import { useState, type FormEvent } from "react";
import { statusesConfig } from "@/config/statuses";
import { SupplierStatus } from "@/core/enums";
import type {
  SupplierDto,
  SupplierInputDto,
} from "@/modules/administration/application/dto/SupplierDto";
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

const statusOptions = Object.values(SupplierStatus);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type SupplierFieldErrors = Partial<Record<"name" | "email" | "phone", string>>;

interface SupplierFormProps {
  supplier?: SupplierDto;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (value: SupplierInputDto) => Promise<void>;
}

export function SupplierForm({ supplier, busy, onCancel, onSubmit }: SupplierFormProps) {
  const [value, setValue] = useState<SupplierInputDto>(() => toSupplierInput(supplier));
  const [errors, setErrors] = useState<SupplierFieldErrors>({});
  const [submitError, setSubmitError] = useState<string>();

  function setField<Key extends keyof SupplierInputDto>(
    key: Key,
    fieldValue: SupplierInputDto[Key],
  ) {
    const nextValue = { ...value, [key]: fieldValue } as SupplierInputDto;
    setValue(nextValue);
    setErrors((currentErrors) => {
      const field = key as keyof SupplierFieldErrors;
      if (!currentErrors[field]) return currentErrors;
      return { ...currentErrors, [field]: validateSupplierFields(nextValue)[field] };
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateSupplierFields(value);
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    setSubmitError(undefined);
    try {
      await onSubmit(value);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "No se pudo guardar el proveedor.");
    }
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      {submitError ? <InlineAlert title={submitError} tone="danger" /> : null}
      <div className="grid gap-4 rounded-xl bg-slate-50/70 p-4 sm:grid-cols-2">
        <FormField error={errors.name} id="supplier-name" label="Nombre">
          <Input
            disabled={busy}
            id="supplier-name"
            maxLength={ADMIN_FIELD_LIMITS.supplier.name}
            onChange={(event) => setField("name", event.target.value)}
            required
            value={value.name}
          />
        </FormField>

        <FormField id="supplier-legal-name" label="Razón social">
          <Input
            disabled={busy}
            id="supplier-legal-name"
            maxLength={ADMIN_FIELD_LIMITS.supplier.legalName}
            onChange={(event) => setField("legalName", event.target.value)}
            value={value.legalName ?? ""}
          />
        </FormField>

        <FormField id="supplier-tax-id" label="Identificación tributaria">
          <Input
            disabled={busy}
            id="supplier-tax-id"
            maxLength={ADMIN_FIELD_LIMITS.supplier.taxId}
            onChange={(event) => setField("taxId", event.target.value)}
            value={value.taxId ?? ""}
          />
        </FormField>

        <FormField error={errors.email} id="supplier-email" label="Correo electrónico">
          <Input
            disabled={busy}
            id="supplier-email"
            maxLength={ADMIN_FIELD_LIMITS.supplier.email}
            onChange={(event) => setField("email", event.target.value)}
            type="email"
            value={value.email ?? ""}
          />
        </FormField>

        <FormField error={errors.phone} id="supplier-phone" label="Teléfono">
          <Input
            disabled={busy}
            id="supplier-phone"
            maxLength={ADMIN_FIELD_LIMITS.supplier.phone}
            onChange={(event) => setField("phone", formatGuatemalaPhoneInput(event.target.value))}
            placeholder="0000-0000"
            type="tel"
            value={value.phone ?? ""}
          />
        </FormField>

        <FormField id="supplier-status" label="Estado">
          <Select
            disabled={busy}
            id="supplier-status"
            onChange={(event) => setField("status", event.target.value as SupplierStatus)}
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

      <FormField id="supplier-address" label="Dirección">
        <textarea
          className="min-h-20 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          id="supplier-address"
          maxLength={ADMIN_FIELD_LIMITS.supplier.address}
          onChange={(event) => setField("address", event.target.value)}
          value={value.address ?? ""}
        />
      </FormField>

      <FormField id="supplier-notes" label="Notas">
        <textarea
          className="min-h-20 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={busy}
          id="supplier-notes"
          maxLength={ADMIN_FIELD_LIMITS.supplier.notes}
          onChange={(event) => setField("notes", event.target.value)}
          value={value.notes ?? ""}
        />
      </FormField>

      <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:justify-end">
        <Button disabled={busy} onClick={onCancel} type="button" variant="secondary">
          Cancelar
        </Button>
        <Button disabled={busy} type="submit">
          {busy ? "Guardando..." : supplier ? "Guardar cambios" : "Crear proveedor"}
        </Button>
      </div>
    </form>
  );
}

function validateSupplierFields(value: SupplierInputDto): SupplierFieldErrors {
  const errors: SupplierFieldErrors = {};
  if (!value.name.trim()) errors.name = "Ingrese el nombre del proveedor.";
  if (value.email?.trim() && !EMAIL_PATTERN.test(value.email.trim())) {
    errors.email = "Ingrese un correo electrónico válido.";
  }
  if (value.phone?.trim() && !isValidGuatemalaPhone(value.phone)) {
    errors.phone = "El teléfono del proveedor debe tener 8 dígitos.";
  }
  return errors;
}

function toSupplierInput(supplier?: SupplierDto): SupplierInputDto {
  if (supplier) {
    return {
      name: supplier.name,
      legalName: supplier.legalName,
      taxId: supplier.taxId,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      notes: supplier.notes,
      status: supplier.status,
    };
  }

  return {
    name: "",
    legalName: "",
    taxId: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
    status: SupplierStatus.active,
  };
}
