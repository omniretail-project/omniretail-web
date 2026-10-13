"use client";

import { useEffect, useState } from "react";
import type { CustomerPaymentMethod } from "@/core/entities";
import { usePaymentMethods } from "@/modules/customer/hooks/usePaymentMethods";
import type { PaymentMethodFormDto } from "@/modules/customer/application/dto/PaymentMethodFormDto";
import {
  hasPaymentMethodValidationErrors,
  validatePaymentMethodForm,
  type PaymentMethodFormMode,
  type PaymentMethodValidationErrors,
} from "@/modules/customer/validation/paymentMethod.validation";
import {
  detectStorefrontCardBrand,
  getStorefrontCardSecurityCodeLength,
  validateStorefrontCardNumber,
} from "@/config/card-brands";
import {
  formatCardExpiration,
  formatCardNumber,
  getCardExpirationError,
} from "@/config/card-input-policy";
import { DELIVERY_ADDRESS_LIMITS, sanitizeRecipientName } from "@/config/delivery-address-policy";
import { GUATEMALA_BANKS } from "@/config/guatemala-banks";
import { Button } from "@/shared/components/Button";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { FormField } from "@/shared/components/FormField";
import { CreditCardIcon } from "@/shared/components/icons";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { PageHeader } from "@/shared/components/PageHeader";
import { Select } from "@/shared/components/Select";
import { useToast } from "@/shared/components/Toast";

const EMPTY_FORM: PaymentMethodFormDto = {
  cardNumber: "",
  cardholderName: "",
  expiration: "",
  cvv: "",
  issuingBank: "",
};

function toFormDto(method: CustomerPaymentMethod): PaymentMethodFormDto {
  return {
    ...EMPTY_FORM,
    cardholderName: method.cardholderName ?? "",
    expiration: `${String(method.expirationMonth).padStart(2, "0")}/${String(method.expirationYear % 100).padStart(2, "0")}`,
    issuingBank: method.issuingBank,
  };
}

type EditorState = { mode: "create" } | { mode: "edit"; method: CustomerPaymentMethod } | null;

export function MetodosPagoPage() {
  const { paymentMethods, loading, busy, error, create, update, remove, setDefault } =
    usePaymentMethods();
  const { showToast } = useToast();
  const [editor, setEditor] = useState<EditorState>(null);
  const [form, setForm] = useState<PaymentMethodFormDto>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<PaymentMethodValidationErrors>({});
  const [removeTarget, setRemoveTarget] = useState<CustomerPaymentMethod | null>(null);

  useEffect(() => {
    if (!editor) return;
    window.queueMicrotask(() => {
      setForm(editor.mode === "edit" ? toFormDto(editor.method) : EMPTY_FORM);
      setFieldErrors({});
    });
  }, [editor]);

  const mode: PaymentMethodFormMode = editor?.mode === "edit" ? "edit" : "create";
  const cardDigits = form.cardNumber.replace(/\D/g, "");
  const cardBrand = detectStorefrontCardBrand(cardDigits);
  const expectedSecurityCodeLength = getStorefrontCardSecurityCodeLength(cardBrand);
  const liveCardNumberError = validateStorefrontCardNumber(cardDigits) ?? undefined;
  const liveExpirationError =
    form.expiration.length === 5 ? (getCardExpirationError(form.expiration) ?? undefined) : undefined;

  /** El numero completo y el CVV nunca quedan en el estado al cerrar el formulario. */
  function closeEditor() {
    setForm(EMPTY_FORM);
    setEditor(null);
  }

  async function handleSubmit() {
    const errors = validatePaymentMethodForm(form, mode);
    setFieldErrors(errors);
    if (hasPaymentMethodValidationErrors(errors)) return;

    const submitted = form;
    // Igual que el checkout: el numero y el CVV salen del estado en cuanto se
    // envian, se guarde o no la tarjeta.
    setForm((current) => ({ ...current, cardNumber: "", cvv: "" }));
    try {
      if (editor?.mode === "edit") {
        await update(editor.method.id, submitted);
        showToast({ title: "Método de pago actualizado", tone: "success" });
      } else {
        await create(submitted);
        showToast({ title: "Método de pago agregado", tone: "success" });
      }
      closeEditor();
    } catch (caughtError) {
      showToast({
        title: "No se pudo guardar el método de pago",
        description: caughtError instanceof Error ? caughtError.message : "Inténtelo nuevamente.",
        tone: "danger",
      });
    }
  }

  function updatePaymentMethod(patch: Partial<PaymentMethodFormDto>) {
    const nextForm = { ...form, ...patch };
    setForm(nextForm);
    setFieldErrors((current) => {
      const affectedFields = Object.keys(patch) as Array<keyof PaymentMethodValidationErrors>;
      // El largo del CVV depende de la marca del numero.
      if (patch.cardNumber !== undefined) affectedFields.push("cvv");
      if (!affectedFields.some((field) => current[field])) return current;
      const validation = validatePaymentMethodForm(nextForm, mode);
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
      showToast({ title: "Método de pago eliminado", tone: "success" });
      setRemoveTarget(null);
    } catch (caughtError) {
      showToast({
        title: "No se pudo eliminar el método de pago",
        description: caughtError instanceof Error ? caughtError.message : "Inténtelo nuevamente.",
        tone: "danger",
      });
    }
  }

  async function handleSetDefault(method: CustomerPaymentMethod) {
    try {
      await setDefault(method.id);
      showToast({ title: "Método de pago predeterminado actualizado", tone: "success" });
    } catch (caughtError) {
      showToast({
        title: "No se pudo actualizar el método de pago predeterminado",
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
            Nueva tarjeta
          </Button>
        }
        description="Tarjetas guardadas para agilizar las compras. Nunca se guarda el número completo ni el código de seguridad."
        title="Métodos de pago"
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
          Cargando métodos de pago...
        </div>
      ) : paymentMethods.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-structure)]">
            <CreditCardIcon className="h-5 w-5" />
          </span>
          <h2 className="mt-3 font-bold text-[var(--color-text)]">Aún no tiene métodos de pago guardados</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Agregue una tarjeta para agilizar sus próximas compras.
          </p>
          <Button className="mt-5" onClick={() => setEditor({ mode: "create" })} type="button">
            Nueva tarjeta
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {paymentMethods.map((method) => (
            <article
              className="flex h-full flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm"
              key={method.id}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)]/10 text-[var(--color-structure)]"
                  >
                    <CreditCardIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                      {method.brand}
                    </p>
                    <h2 className="truncate font-mono text-xl font-bold tracking-wide text-[var(--color-text)]">
                      •••• {method.last4}
                    </h2>
                  </div>
                </div>
                {method.isDefault ? (
                  <span className="shrink-0 rounded-md bg-[var(--color-success)]/10 px-2 py-1 text-xs font-semibold text-[var(--color-success)]">
                    Predeterminada
                  </span>
                ) : null}
              </div>
              {method.cardholderName ? (
                <p className="mt-2 text-sm text-[var(--color-text)]">{method.cardholderName}</p>
              ) : null}
              <p className="text-sm text-[var(--color-text-muted)]">{method.issuingBank}</p>
              <p className="text-sm text-[var(--color-text-muted)]">
                Vence {String(method.expirationMonth).padStart(2, "0")}/{method.expirationYear}
              </p>

              <div className="mt-auto flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
                <Button
                  onClick={() => setEditor({ mode: "edit", method })}
                  type="button"
                  variant="secondary"
                >
                  Editar
                </Button>
                {!method.isDefault ? (
                  <Button
                    disabled={busy}
                    onClick={() => void handleSetDefault(method)}
                    type="button"
                    variant="secondary"
                  >
                    Usar como predeterminada
                  </Button>
                ) : null}
                <Button onClick={() => setRemoveTarget(method)} type="button" variant="danger">
                  Eliminar
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        onClose={closeEditor}
        open={Boolean(editor)}
        title={editor?.mode === "edit" ? "Editar tarjeta" : "Nueva tarjeta"}
      >
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          {editor?.mode === "edit" ? (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2">
              <CreditCardIcon className="h-4 w-4 text-[var(--color-structure)]" />
              <span className="text-sm font-semibold text-[var(--color-text)]">
                {editor.method.brand} •••• {editor.method.last4}
              </span>
            </div>
          ) : (
            <FormField
              error={fieldErrors.cardNumber ?? liveCardNumberError}
              hint={cardBrand ?? undefined}
              id="payment-card-number"
              label="Número de tarjeta"
            >
              <Input
                autoComplete="cc-number"
                disabled={busy}
                id="payment-card-number"
                inputMode="numeric"
                maxLength={23}
                onChange={(event) => {
                  const cardNumber = formatCardNumber(event.target.value);
                  const nextBrand = detectStorefrontCardBrand(cardNumber.replace(/\D/g, ""));
                  updatePaymentMethod({
                    cardNumber,
                    cvv: form.cvv.slice(0, getStorefrontCardSecurityCodeLength(nextBrand)),
                  });
                }}
                placeholder="4242 4242 4242 4242"
                value={form.cardNumber}
              />
            </FormField>
          )}

          <FormField
            error={fieldErrors.cardholderName}
            hint={editor?.mode === "edit" ? "Opcional" : undefined}
            id="payment-cardholder"
            label="Nombre del titular"
          >
            <Input
              autoComplete="cc-name"
              disabled={busy}
              id="payment-cardholder"
              maxLength={DELIVERY_ADDRESS_LIMITS.recipientName}
              onChange={(event) =>
                updatePaymentMethod({ cardholderName: sanitizeRecipientName(event.target.value) })
              }
              value={form.cardholderName}
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              error={fieldErrors.expiration ?? liveExpirationError}
              id="payment-expiration"
              label="Fecha de vencimiento"
            >
              <Input
                autoComplete="cc-exp"
                disabled={busy}
                id="payment-expiration"
                inputMode="numeric"
                maxLength={5}
                onChange={(event) =>
                  updatePaymentMethod({ expiration: formatCardExpiration(event.target.value) })
                }
                placeholder="MM/AA"
                value={form.expiration}
              />
            </FormField>

            {editor?.mode === "edit" ? null : (
              <FormField error={fieldErrors.cvv} id="payment-cvv" label="Código de seguridad (CVV)">
                <Input
                  autoComplete="cc-csc"
                  disabled={busy}
                  id="payment-cvv"
                  inputMode="numeric"
                  maxLength={expectedSecurityCodeLength}
                  onChange={(event) =>
                    updatePaymentMethod({
                      cvv: event.target.value.replace(/\D/g, "").slice(0, expectedSecurityCodeLength),
                    })
                  }
                  placeholder={expectedSecurityCodeLength === 4 ? "••••" : "•••"}
                  type="password"
                  value={form.cvv}
                />
              </FormField>
            )}
          </div>

          <FormField error={fieldErrors.issuingBank} id="payment-bank" label="Banco emisor">
            <Select
              disabled={busy || editor?.mode === "edit"}
              id="payment-bank"
              onChange={(event) => updatePaymentMethod({ issuingBank: event.target.value })}
              value={form.issuingBank}
            >
              <option value="">Selecciona un banco</option>
              {GUATEMALA_BANKS.map((bank) => (
                <option key={bank} value={bank}>
                  {bank}
                </option>
              ))}
            </Select>
          </FormField>

          <div className="flex justify-end gap-2">
            <Button onClick={closeEditor} type="button" variant="secondary">
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
        message={`Se eliminará la tarjeta ${removeTarget?.brand ?? ""} terminada en ${removeTarget?.last4 ?? ""}. Esta acción no se puede deshacer.`}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => void handleRemove()}
        open={Boolean(removeTarget)}
        title="Eliminar método de pago"
      />
    </div>
  );
}
