"use client";

import { useEffect, useState } from "react";
import type { Address } from "@/core/entities";
import { useAddresses } from "@/modules/customer/hooks/useAddresses";
import type { AddressFormDto } from "@/modules/customer/application/dto/AddressFormDto";
import {
  hasAddressValidationErrors,
  validateAddressForm,
  type AddressValidationErrors,
} from "@/modules/customer/validation/address.validation";
import {
  GUATEMALA_DEPARTMENTS,
  GUATEMALA_MUNICIPALITIES,
  type GuatemalaDepartment,
} from "@/config/guatemala-locations";
import { Button } from "@/shared/components/Button";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { FormField } from "@/shared/components/FormField";
import { MapPinIcon } from "@/shared/components/icons";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { PageHeader } from "@/shared/components/PageHeader";
import { Select } from "@/shared/components/Select";
import { useToast } from "@/shared/components/Toast";
import {
  DELIVERY_ADDRESS_LIMITS,
  sanitizeDeliveryAddress,
  sanitizeRecipientName,
} from "@/config/delivery-address-policy";

const EMPTY_FORM: AddressFormDto = {
  label: "",
  recipientName: "",
  line1: "",
  line2: "",
  city: "",
  stateOrDepartment: "",
  postalCode: "",
  references: "",
};

function toFormDto(address: Address): AddressFormDto {
  return {
    label: address.label,
    recipientName: address.recipientName,
    line1: address.line1,
    line2: address.line2 ?? "",
    city: address.city,
    stateOrDepartment: address.stateOrDepartment ?? "",
    postalCode: address.postalCode ?? "",
    references: address.references ?? "",
  };
}

type EditorState = { mode: "create" } | { mode: "edit"; address: Address } | null;

export function DireccionesPage() {
  const { addresses, loading, busy, error, create, update, remove, setDefault } = useAddresses();
  const { showToast } = useToast();
  const [editor, setEditor] = useState<EditorState>(null);
  const [form, setForm] = useState<AddressFormDto>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<AddressValidationErrors>({});
  const [removeTarget, setRemoveTarget] = useState<Address | null>(null);

  useEffect(() => {
    if (!editor) return;
    window.queueMicrotask(() => {
      setForm(editor.mode === "edit" ? toFormDto(editor.address) : EMPTY_FORM);
      setFieldErrors({});
    });
  }, [editor]);

  async function handleSubmit() {
    const errors = validateAddressForm(form);
    setFieldErrors(errors);
    if (hasAddressValidationErrors(errors)) return;

    try {
      if (editor?.mode === "edit") {
        await update(editor.address.id, form);
        showToast({ title: "Dirección actualizada", tone: "success" });
      } else {
        await create(form);
        showToast({ title: "Dirección agregada", tone: "success" });
      }
      setEditor(null);
    } catch (caughtError) {
      showToast({
        title: "No se pudo guardar la dirección",
        description: caughtError instanceof Error ? caughtError.message : "Inténtelo nuevamente.",
        tone: "danger",
      });
    }
  }

  function updateAddress(patch: Partial<AddressFormDto>) {
    const nextForm = { ...form, ...patch };
    setForm(nextForm);
    setFieldErrors((current) => {
      const affectedFields = Object.keys(patch) as Array<keyof AddressValidationErrors>;
      if (patch.stateOrDepartment !== undefined) affectedFields.push("city");
      if (!affectedFields.some((field) => current[field])) return current;
      const validation = validateAddressForm(nextForm);
      const nextErrors = { ...current };
      for (const field of affectedFields) {
        if (!current[field]) continue;
        nextErrors[field] = validation[field];
      }
      return nextErrors;
    });
  }

  async function handleRemove() {
    if (!removeTarget) return;
    try {
      await remove(removeTarget.id);
      showToast({ title: "Dirección eliminada", tone: "success" });
      setRemoveTarget(null);
    } catch (caughtError) {
      showToast({
        title: "No se pudo eliminar la dirección",
        description: caughtError instanceof Error ? caughtError.message : "Inténtelo nuevamente.",
        tone: "danger",
      });
    }
  }

  async function handleSetDefault(address: Address) {
    try {
      await setDefault(address.id);
      showToast({ title: "Dirección predeterminada actualizada", tone: "success" });
    } catch (caughtError) {
      showToast({
        title: "No se pudo actualizar la dirección predeterminada",
        description: caughtError instanceof Error ? caughtError.message : "Inténtelo nuevamente.",
        tone: "danger",
      });
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl space-y-5">
      <PageHeader
        actions={
          <Button onClick={() => setEditor({ mode: "create" })} type="button">
            Nueva dirección
          </Button>
        }
        description="Direcciones reutilizables para próximas compras."
        title="Direcciones"
      />

      {error ? (
        <div
          className="rounded-lg border border-[var(--color-danger)] bg-[var(--color-surface)] px-4 py-3 text-sm font-medium text-[var(--color-danger)]"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div
          aria-live="polite"
          className="flex min-h-40 items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm font-medium text-[var(--color-text-muted)] shadow-sm"
        >
          <span
            aria-hidden="true"
            className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-structure)]"
          />
          Cargando direcciones...
        </div>
      ) : addresses.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-structure)]">
            <MapPinIcon className="h-5 w-5" />
          </span>
          <h2 className="mt-3 font-bold text-[var(--color-text)]">Aún no tiene direcciones guardadas</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Agregue una dirección para reutilizarla en próximas compras.
          </p>
          <Button className="mt-5" onClick={() => setEditor({ mode: "create" })} type="button">
            Nueva dirección
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {addresses.map((address) => (
            <article
              className="flex h-full flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm"
              key={address.id}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-structure)]"
                  >
                    <MapPinIcon className="h-4 w-4" />
                  </span>
                  <h2 className="truncate text-lg font-bold text-[var(--color-text)]">{address.label}</h2>
                </div>
                {address.isDefault ? (
                  <span className="shrink-0 rounded-md bg-[var(--color-success)]/10 px-2 py-1 text-xs font-semibold text-[var(--color-success)]">
                    Predeterminada
                  </span>
                ) : null}
              </div>
              <p className="mt-3 break-words text-sm font-semibold text-[var(--color-text)] [overflow-wrap:anywhere]">{address.recipientName}</p>
              <p className="break-words text-sm text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
                {address.line1}
                {address.line2 ? `, ${address.line2}` : ""}
              </p>
              <p className="text-sm text-[var(--color-text-muted)]">
                {[address.city, address.stateOrDepartment, address.country]
                  .filter(Boolean)
                  .join(", ")}
              </p>

              <div className="mt-auto flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
                <Button
                  onClick={() => setEditor({ mode: "edit", address })}
                  type="button"
                  variant="secondary"
                >
                  Editar
                </Button>
                {!address.isDefault ? (
                  <Button
                    disabled={busy}
                    onClick={() => void handleSetDefault(address)}
                    type="button"
                    variant="secondary"
                  >
                    Usar como predeterminada
                  </Button>
                ) : null}
                <Button onClick={() => setRemoveTarget(address)} type="button" variant="danger">
                  Eliminar
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        onClose={() => setEditor(null)}
        open={Boolean(editor)}
        title={editor?.mode === "edit" ? "Editar dirección" : "Nueva dirección"}
      >
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <FormField error={fieldErrors.label} id="address-label" label="Nombre de la dirección">
            <Input
              disabled={busy}
              id="address-label"
              maxLength={DELIVERY_ADDRESS_LIMITS.label}
              onChange={(event) => updateAddress({ label: event.target.value.slice(0, DELIVERY_ADDRESS_LIMITS.label) })}
              placeholder="Casa, Oficina..."
              value={form.label}
            />
          </FormField>

          <FormField error={fieldErrors.recipientName} id="address-recipient" label="Destinatario">
            <Input
              disabled={busy}
              id="address-recipient"
              maxLength={DELIVERY_ADDRESS_LIMITS.recipientName}
              onChange={(event) => updateAddress({ recipientName: sanitizeRecipientName(event.target.value) })}
              value={form.recipientName}
            />
          </FormField>

          <FormField error={fieldErrors.line1} id="address-line1" label="Dirección">
            <Input
              disabled={busy}
              id="address-line1"
              maxLength={DELIVERY_ADDRESS_LIMITS.line1}
              onChange={(event) => updateAddress({ line1: sanitizeDeliveryAddress(event.target.value, "line1") })}
              value={form.line1}
            />
          </FormField>

          <FormField error={fieldErrors.line2} hint="Opcional" id="address-line2" label="Referencia / línea 2">
            <Input
              disabled={busy}
              id="address-line2"
              maxLength={DELIVERY_ADDRESS_LIMITS.line2}
              onChange={(event) => updateAddress({ line2: sanitizeDeliveryAddress(event.target.value, "line2") })}
              value={form.line2}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              error={fieldErrors.stateOrDepartment}
              id="address-state"
              label="Departamento / estado"
            >
              <Select
                disabled={busy}
                id="address-state"
                onChange={(event) => {
                  const nextDepartment = event.target.value;
                  // Cambiar de departamento invalida el municipio elegido
                  // antes -- Municipio siempre se resetea junto con el
                  // departamento para que nunca queden desincronizados.
                  updateAddress({ stateOrDepartment: nextDepartment, city: "" });
                }}
                value={form.stateOrDepartment}
              >
                <option value="">Selecciona un departamento</option>
                {GUATEMALA_DEPARTMENTS.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField error={fieldErrors.city} id="address-city" label="Municipio">
              <Select
                disabled={busy || !form.stateOrDepartment}
                id="address-city"
                onChange={(event) => updateAddress({ city: event.target.value })}
                value={form.city}
              >
                <option value="">
                  {form.stateOrDepartment ? "Selecciona un municipio" : "Elige primero un departamento"}
                </option>
                {(GUATEMALA_MUNICIPALITIES[form.stateOrDepartment as GuatemalaDepartment] ?? []).map(
                  (municipality) => (
                    <option key={municipality} value={municipality}>
                      {municipality}
                    </option>
                  ),
                )}
              </Select>
            </FormField>
          </div>

          <FormField
            error={fieldErrors.postalCode}
            hint="Opcional"
            id="address-postal"
            label="Código postal"
          >
            <Input
              disabled={busy}
              id="address-postal"
              inputMode="numeric"
              maxLength={10}
              onChange={(event) =>
                updateAddress({ postalCode: event.target.value.replace(/\D/g, "").slice(0, 10) })
              }
              placeholder="01001"
              value={form.postalCode}
            />
          </FormField>

          <FormField error={fieldErrors.references} hint="Opcional" id="address-references" label="Referencias adicionales">
            <Input
              disabled={busy}
              id="address-references"
              maxLength={DELIVERY_ADDRESS_LIMITS.references}
              onChange={(event) => updateAddress({ references: sanitizeDeliveryAddress(event.target.value, "references") })}
              value={form.references}
            />
          </FormField>

          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditor(null)} type="button" variant="secondary">
              Cancelar
            </Button>
            <Button disabled={busy} type="submit">
              {busy ? "Guardando..." : "Guardar"}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        confirmLabel="Eliminar"
        message={`Se eliminará la dirección "${removeTarget?.label ?? ""}". Esta acción no se puede deshacer.`}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => void handleRemove()}
        open={Boolean(removeTarget)}
        title="Eliminar dirección"
      />
    </div>
  );
}
