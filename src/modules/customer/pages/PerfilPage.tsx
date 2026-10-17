"use client";

import { useEffect, useState } from "react";
import { useCustomerProfile } from "@/modules/customer/hooks/useCustomerProfile";
import type { ProfileFormDto } from "@/modules/customer/application/dto/ProfileFormDto";
import {
  hasProfileValidationErrors,
  validateProfileForm,
  type ProfileValidationErrors,
} from "@/modules/customer/validation/profile.validation";
import { TEXT_FIELD_POLICY } from "@/config/text-field-policy";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { Input } from "@/shared/components/Input";
import { PageHeader } from "@/shared/components/PageHeader";
import { useToast } from "@/shared/components/Toast";

export function PerfilPage() {
  const { customer, email, loading, saving, error, update } = useCustomerProfile();
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ProfileValidationErrors>({});
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!customer) return;
    window.queueMicrotask(() => {
      setName(customer.name);
      setPhone(customer.phone ?? "");
    });
  }, [customer]);

  async function handleSubmit() {
    const dto: ProfileFormDto = { name, phone };
    const errors = validateProfileForm(dto);
    setFieldErrors(errors);
    if (hasProfileValidationErrors(errors)) return;

    try {
      await update(dto);
      showToast({ title: "Datos personales actualizados", tone: "success" });
      setIsEditing(false);
    } catch (caughtError) {
      showToast({
        title: "No se pudieron guardar los datos",
        description: caughtError instanceof Error ? caughtError.message : "Inténtelo nuevamente.",
        tone: "danger",
      });
    }
  }

  function updateProfileField(field: keyof ProfileFormDto, nextValue: string) {
    const next = { name, phone, [field]: nextValue };
    if (field === "name") setName(nextValue);
    else setPhone(nextValue);
    setFieldErrors((current) => {
      if (!current[field]) return current;
      return { ...current, [field]: validateProfileForm(next)[field] };
    });
  }

  function handleCancel() {
    if (customer) {
      setName(customer.name);
      setPhone(customer.phone ?? "");
    }
    setFieldErrors({});
    setIsEditing(false);
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-5">
      <PageHeader
        description="Actualiza tu nombre y teléfono de contacto."
        title="Datos personales"
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
          Cargando perfil...
        </div>
      ) : (
        <div className="space-y-6">
          <form
            className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (isEditing) {
                void handleSubmit();
              } else {
                setIsEditing(true);
              }
            }}
          >
            <div className="border-b border-[var(--color-border)] pb-4">
              <h2 className="text-lg font-bold text-[var(--color-text)]">
                Información de contacto
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Revisa tus datos y habilita la edición cuando necesites actualizarlos.
              </p>
            </div>
            <FormField
              hint="El correo no se puede editar desde aquí."
              id="profile-email"
              label="Correo electrónico"
            >
              <Input
                className="bg-slate-100 text-[var(--color-text-muted)]"
                id="profile-email"
                readOnly
                value={email ?? ""}
              />
            </FormField>

            <FormField error={fieldErrors.name} id="profile-name" label="Nombre completo">
              <Input
                className={isEditing ? undefined : "bg-slate-50 text-[var(--color-text-muted)]"}
                disabled={saving}
                id="profile-name"
                maxLength={TEXT_FIELD_POLICY.NAME_MAX_LENGTH}
                onChange={(event) => updateProfileField("name", event.target.value)}
                readOnly={!isEditing}
                value={name}
              />
            </FormField>

            <FormField error={fieldErrors.phone} hint="Opcional" id="profile-phone" label="Teléfono">
              <Input
                className={isEditing ? undefined : "bg-slate-50 text-[var(--color-text-muted)]"}
                disabled={saving}
                id="profile-phone"
                inputMode="numeric"
                maxLength={8}
                onChange={(event) => updateProfileField("phone", event.target.value)}
                readOnly={!isEditing}
                type="tel"
                value={phone}
              />
            </FormField>

            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
              <Button className="w-full sm:w-auto" disabled={saving} type="submit">
                {isEditing ? (saving ? "Guardando..." : "Guardar cambios") : "Editar"}
              </Button>
              {isEditing && (
                <Button className="w-full sm:w-auto" disabled={saving} onClick={handleCancel} type="button" variant="secondary">
                  Cancelar
                </Button>
              )}
            </div>
          </form>

        </div>
      )}
    </div>
  );
}
