import type { ReactNode } from "react";
import type { BankAccountType } from "@/core/entities";
import type {
  CardTerminalOutcome,
  CardTerminalResultDto,
  CheckoutBankAccountDto,
  CheckoutDto,
  CheckoutInvoiceDataDto,
  CheckoutPaymentMode,
} from "@/modules/pos/application/dto/CheckoutDto";
import type { CheckoutValidationErrors } from "@/modules/pos/validation/checkout.validation";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { Input } from "@/shared/components/Input";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { KIT_DEFERRED_MESSAGE, isKitDeferredSale } from "@/modules/pos/validation/kitDelivery";
import { Modal } from "@/shared/components/Modal";
import { Select } from "@/shared/components/Select";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { formatCurrency } from "@/shared/utils/formatCurrency";
import { DeliveryMethod, TransportMode } from "@/core/enums";

const accountTypeLabels: Record<BankAccountType, string> = {
  monetary: "Monetaria",
  savings: "Ahorro",
};

interface CheckoutModalProps {
  open: boolean;
  checkout: CheckoutDto;
  errors: CheckoutValidationErrors;
  subtotal: number;
  discountTotal: number;
  total: number;
  appliedAmount: number;
  differenceAmount: number;
  bankAccounts: CheckoutBankAccountDto[];
  bankAccountsLoading: boolean;
  bankAccountsError: string | null;
  availablePaymentModes: CheckoutPaymentMode[];
  paymentMethodsLoading: boolean;
  paymentMethodsError: string | null;
  cashShiftLoading: boolean;
  cashShiftError: string | null;
  cashShiftRegisterCode: string | null;
  currentBranchName: string | null;
  hasOpenCashShift: boolean;
  hasPosSalesPermission: boolean;
  hasCurrentBranchAccess: boolean;
  hasUnsupportedTraceability: boolean;
  /** El ticket incluye kits: solo admiten entrega inmediata. */
  hasKitItems?: boolean;
  validated: boolean;
  readyToConfirm: boolean;
  hasOperationalBlock: boolean;
  message: string | null;
  confirmationLoading: boolean;
  confirmationError: string | null;
  onClose: () => void;
  onReset: () => void;
  onDocumentTypeChange: (documentType: CheckoutDto["documentType"]) => void;
  onPaymentModeChange: (paymentMode: CheckoutPaymentMode) => void;
  onCheckoutChange: (patch: Partial<Omit<CheckoutDto, "cardTerminalResult">>) => void;
  onProcessCardPayment: (outcome: CardTerminalOutcome) => void;
  onInvoiceDataChange: (patch: Partial<CheckoutInvoiceDataDto>) => void;
  onDeliveryAddressChange: (patch: Partial<NonNullable<CheckoutDto["deliveryAddress"]>>) => void;
  onStorePickupContactChange: (patch: Partial<NonNullable<CheckoutDto["storePickupContact"]>>) => void;
  onValidate: () => void;
  onConfirm: () => void;
}

export function CheckoutModal({
  open,
  checkout,
  errors,
  subtotal,
  discountTotal,
  total,
  appliedAmount,
  differenceAmount,
  bankAccounts,
  bankAccountsLoading,
  bankAccountsError,
  availablePaymentModes,
  paymentMethodsLoading,
  paymentMethodsError,
  cashShiftLoading,
  cashShiftError,
  cashShiftRegisterCode,
  currentBranchName,
  hasOpenCashShift,
  hasPosSalesPermission,
  hasCurrentBranchAccess,
  hasUnsupportedTraceability,
  hasKitItems = false,
  validated,
  readyToConfirm,
  hasOperationalBlock,
  message,
  confirmationLoading,
  confirmationError,
  onClose,
  onReset,
  onDocumentTypeChange,
  onPaymentModeChange,
  onCheckoutChange,
  onProcessCardPayment,
  onInvoiceDataChange,
  onDeliveryAddressChange,
  onStorePickupContactChange,
  onValidate,
  onConfirm,
}: CheckoutModalProps) {
  const kitDeferredBlocked = isKitDeferredSale(checkout.deliveryMethod, hasKitItems);
  const showCash =
    availablePaymentModes.includes("cash") &&
    (checkout.paymentMode === "cash" || checkout.paymentMode === "mixed");
  const showCard =
    availablePaymentModes.includes("card") &&
    (checkout.paymentMode === "card" || checkout.paymentMode === "mixed");
  const showTransfer =
    availablePaymentModes.includes("transfer") &&
    (checkout.paymentMode === "transfer" || checkout.paymentMode === "mixed");

  return (
    <Modal
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            className="w-full sm:w-auto"
            disabled={confirmationLoading}
            onClick={onReset}
            type="button"
            variant="ghost"
          >
            Restablecer
          </Button>
          <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
            <Button
              className="w-full"
              disabled={confirmationLoading}
              form="pos-checkout-form"
              type="submit"
              variant="secondary"
            >
              Preparar cobro
            </Button>
            <Button
              className="w-full sm:min-w-36"
              disabled={!readyToConfirm || confirmationLoading || kitDeferredBlocked}
              onClick={onConfirm}
              type="button"
            >
              {confirmationLoading ? "Procesando..." : "Confirmar venta"}
            </Button>
          </div>
        </div>
      }
      onClose={onClose}
      open={open}
      size="xl"
      maxWidth="76rem"
      density="compact"
      subtitle="Valida el documento y el pago antes de confirmar la venta."
      title="Cobrar venta"
    >
      <form
        className="space-y-4"
        id="pos-checkout-form"
        onSubmit={(event) => {
          event.preventDefault();
          onValidate();
        }}
      >
        <CheckoutSummary discountTotal={discountTotal} subtotal={subtotal} total={total} />

        <CashShiftStatusPanel
          branchName={currentBranchName}
          error={cashShiftError}
          hasBranchAccess={hasCurrentBranchAccess}
          hasOpenCashShift={hasOpenCashShift}
          hasSalesPermission={hasPosSalesPermission}
          loading={cashShiftLoading}
          registerCode={cashShiftRegisterCode}
        />

        {hasUnsupportedTraceability ? (
          <div className="rounded-lg border border-[var(--color-warning)] p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status="Bloqueo operativo" tone="warning" />
              <p className="text-sm font-semibold text-[var(--color-text)]">
                El ticket contiene productos que no pueden confirmarse desde esta terminal.
              </p>
            </div>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              El cobro puede validarse, pero la venta no puede confirmarse con los elementos incluidos en el ticket.
            </p>
          </div>
        ) : null}

        <div className="grid items-start gap-4 xl:grid-cols-2">
          <section className="space-y-3 rounded-lg border border-[var(--color-border)] bg-white p-3 shadow-sm sm:p-4">
            <h3 className="font-bold text-[var(--color-title)]">Documento</h3>
          <FormField id="checkout-document-type" label="Tipo de documento">
            <Select
              id="checkout-document-type"
              onChange={(event) =>
                onDocumentTypeChange(event.target.value as CheckoutDto["documentType"])
              }
              value={checkout.documentType}
            >
              <option value="ticket">Ticket</option>
              <option value="invoice">Factura</option>
            </Select>
          </FormField>

            {checkout.documentType === "invoice" ? (
              <div className="grid gap-3 md:grid-cols-2">
              <FormField id="checkout-tax-id" label="NIT *" error={errors.taxId}>
                <Input
                  id="checkout-tax-id"
                  maxLength={10}
                  onChange={(event) => onInvoiceDataChange({ taxId: event.target.value })}
                  value={checkout.invoiceData.taxId}
                />
              </FormField>
              <FormField
                id="checkout-legal-name"
                label="Nombre / Razón Social *"
                error={errors.legalName}
              >
                <Input
                  id="checkout-legal-name"
                  maxLength={160}
                  onChange={(event) => onInvoiceDataChange({ legalName: event.target.value })}
                  value={checkout.invoiceData.legalName}
                />
              </FormField>
              <div className="md:col-span-2">
                <FormField
                  id="checkout-fiscal-address"
                  label="Dirección Fiscal *"
                  error={errors.fiscalAddress}
                >
                  <Input
                    id="checkout-fiscal-address"
                    maxLength={240}
                    onChange={(event) => onInvoiceDataChange({ fiscalAddress: event.target.value })}
                    value={checkout.invoiceData.fiscalAddress}
                  />
                </FormField>
              </div>
              </div>
            ) : null}
          </section>

          <section className="space-y-3 rounded-lg border border-[var(--color-border)] bg-white p-3 shadow-sm sm:p-4">
            <h3 className="font-bold text-[var(--color-title)]">Entrega</h3>
          <FormField id="checkout-delivery-method" label="Modalidad">
            <Select
              id="checkout-delivery-method"
              onChange={(event) => {
                const deliveryMethod = event.target.value as CheckoutDto["deliveryMethod"];
                onCheckoutChange({
                  deliveryMethod,
                  transportMode:
                    deliveryMethod === DeliveryMethod.home_delivery
                      ? TransportMode.own_fleet
                      : deliveryMethod === DeliveryMethod.store_pickup
                        ? TransportMode.customer
                        : TransportMode.none,
                });
              }}
              value={checkout.deliveryMethod}
            >
              <option value={DeliveryMethod.immediate}>Entrega inmediata</option>
              <option disabled={hasKitItems} value={DeliveryMethod.store_pickup}>
                Retiro en tienda
              </option>
              <option disabled={hasKitItems} value={DeliveryMethod.home_delivery}>
                Entrega a domicilio
              </option>
            </Select>
          </FormField>
          {hasKitItems ? <InlineAlert tone="warning" title={KIT_DEFERRED_MESSAGE} /> : null}
          <InlineAlert tone="info" title={getDeliveryMethodMessage(checkout.deliveryMethod)} />
            {checkout.deliveryMethod === DeliveryMethod.home_delivery ? (
              <div className="grid gap-3 md:grid-cols-2">
              <FormField
                id="delivery-recipient"
                label="Nombre de contacto *"
                error={errors.recipientName}
              >
                <Input
                  id="delivery-recipient"
                  maxLength={160}
                  onChange={(event) =>
                    onDeliveryAddressChange({ recipientName: event.target.value })
                  }
                  value={checkout.deliveryAddress?.recipientName ?? ""}
                />
              </FormField>
              <FormField id="delivery-phone" label="Teléfono *" error={errors.recipientPhone}>
                <Input
                  id="delivery-phone"
                  inputMode="numeric"
                  onChange={(event) =>
                    onDeliveryAddressChange({ recipientPhone: event.target.value })
                  }
                  value={checkout.deliveryAddress?.recipientPhone ?? ""}
                />
              </FormField>
              <div className="space-y-3">
                <FormField
                  id="delivery-email"
                  label="Correo electrónico"
                  error={errors.notificationEmail}
                >
                  <Input
                    disabled={checkout.notificationContact.emailMode === "not_applicable"}
                    id="delivery-email"
                    maxLength={254}
                    onChange={(event) =>
                      onCheckoutChange({
                        notificationContact: {
                          emailMode: "send",
                          email: event.target.value,
                        },
                      })
                    }
                    type="email"
                    value={
                      checkout.notificationContact.emailMode === "send"
                        ? checkout.notificationContact.email
                        : ""
                    }
                  />
                </FormField>
                <label
                  className="flex cursor-pointer items-center gap-2 text-sm text-[var(--color-text)]"
                  htmlFor="delivery-email-not-applicable"
                >
                  <input
                    checked={checkout.notificationContact.emailMode === "not_applicable"}
                    className="h-4 w-4 accent-[var(--color-primary)]"
                    id="delivery-email-not-applicable"
                    onChange={(event) =>
                      onCheckoutChange({
                        notificationContact: event.target.checked
                          ? { emailMode: "not_applicable" }
                          : { emailMode: "send", email: "" },
                      })
                    }
                    type="checkbox"
                  />
                  No aplica correo
                </label>
              </div>
              <FormField id="delivery-city" label="Ciudad *" error={errors.deliveryCity}>
                <Input
                  id="delivery-city"
                  maxLength={120}
                  onChange={(event) => onDeliveryAddressChange({ city: event.target.value })}
                  value={checkout.deliveryAddress?.city ?? ""}
                />
              </FormField>
              <div className="md:col-span-2">
                <FormField
                  id="delivery-line1"
                  label="Dirección de entrega *"
                  error={errors.deliveryAddress}
                >
                  <Input
                    id="delivery-line1"
                    maxLength={240}
                    onChange={(event) => onDeliveryAddressChange({ line1: event.target.value })}
                    value={checkout.deliveryAddress?.line1 ?? ""}
                  />
                </FormField>
              </div>
              <div className="md:col-span-2">
                <FormField id="delivery-references" label="Referencia de dirección (opcional)">
                  <Input
                    id="delivery-references"
                    maxLength={240}
                    onChange={(event) =>
                      onDeliveryAddressChange({ references: event.target.value })
                    }
                    value={checkout.deliveryAddress?.references ?? ""}
                  />
                </FormField>
              </div>
              </div>
            ) : null}
            {checkout.deliveryMethod === DeliveryMethod.store_pickup ? (
              <div className="grid gap-3 md:grid-cols-2">
              <FormField
                id="pickup-recipient"
                label="Nombre de quien retira *"
                error={errors.recipientName}
              >
                <Input
                  id="pickup-recipient"
                  maxLength={160}
                  onChange={(event) =>
                    onStorePickupContactChange({ recipientName: event.target.value })
                  }
                  value={checkout.storePickupContact?.recipientName ?? ""}
                />
              </FormField>
              <FormField id="pickup-phone" label="Teléfono *" error={errors.recipientPhone}>
                <Input
                  id="pickup-phone"
                  inputMode="numeric"
                  maxLength={8}
                  onChange={(event) =>
                    onStorePickupContactChange({ recipientPhone: event.target.value })
                  }
                  value={checkout.storePickupContact?.recipientPhone ?? ""}
                />
              </FormField>
              </div>
            ) : null}
          </section>
        </div>

        <section className="space-y-3 rounded-lg border border-[var(--color-border)] bg-white p-3 shadow-sm sm:p-4">
          <h3 className="font-bold text-[var(--color-title)]">Método de pago</h3>
          <div className="w-full sm:max-w-sm">
            <FormField
              id="checkout-payment-mode"
              label="Modalidad"
              error={paymentMethodsError ?? undefined}
            >
              <Select
                disabled={paymentMethodsLoading || availablePaymentModes.length === 0}
                id="checkout-payment-mode"
                onChange={(event) => onPaymentModeChange(event.target.value as CheckoutPaymentMode)}
                value={checkout.paymentMode}
              >
                {!availablePaymentModes.includes(checkout.paymentMode) ? (
                  <option disabled value={checkout.paymentMode}>
                    {paymentMethodsLoading ? "Cargando métodos..." : "Método no disponible"}
                  </option>
                ) : null}
                {availablePaymentModes.map((paymentMode) => (
                  <option key={paymentMode} value={paymentMode}>
                    {getPaymentModeLabel(paymentMode)}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <div className="grid items-start gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))]">
            {showCash ? (
              <PaymentSection title="Efectivo">
                {checkout.paymentMode === "mixed" ? (
                  <MoneyField
                    error={errors.cashAmount}
                    id="checkout-cash-amount"
                    label="Monto aplicado"
                    value={checkout.cashAmount}
                    onChange={(cashAmount) => onCheckoutChange({ cashAmount })}
                  />
                ) : (
                  <ReadonlyAmount label="Monto aplicado" value={checkout.cashAmount} />
                )}
                <MoneyField
                  error={errors.cashReceived}
                  id="checkout-cash-received"
                  label="Monto recibido"
                  value={checkout.cashReceived}
                  onChange={(cashReceived) => onCheckoutChange({ cashReceived })}
                />
                <ReadonlyAmount
                  error={errors.changeAmount}
                  label="Cambio"
                  value={checkout.changeAmount}
                />
              </PaymentSection>
            ) : null}

            {showCard ? (
              <PaymentSection title="Tarjeta">
                <MoneyField
                  error={errors.cardAmount}
                  id="checkout-card-amount"
                  label="Monto"
                  value={checkout.cardAmount}
                  onChange={(cardAmount) => onCheckoutChange({ cardAmount })}
                />
                <CardTerminalPanel
                  amount={checkout.cardAmount}
                  error={errors.cardTerminal}
                  result={checkout.cardTerminalResult}
                  onProcess={onProcessCardPayment}
                />
              </PaymentSection>
            ) : null}

            {showTransfer ? (
              <PaymentSection title="Transferencia">
                <MoneyField
                  error={errors.transferAmount}
                  id="checkout-transfer-amount"
                  label="Monto"
                  value={checkout.transferAmount}
                  onChange={(transferAmount) => onCheckoutChange({ transferAmount })}
                />
                <FormField
                  id="checkout-bank-account"
                  label="Banco / cuenta"
                  error={
                    errors.bankAccountId ??
                    (checkout.transferAmount > 0 ? (bankAccountsError ?? undefined) : undefined)
                  }
                >
                  <Select
                    disabled={bankAccountsLoading || bankAccounts.length === 0}
                    id="checkout-bank-account"
                    onChange={(event) => onCheckoutChange({ bankAccountId: event.target.value })}
                    value={checkout.bankAccountId}
                  >
                    <option value="">
                      {bankAccountsLoading
                        ? "Cargando cuentas..."
                        : bankAccounts.length === 0
                          ? "Sin cuentas disponibles"
                          : "Seleccionar cuenta"}
                    </option>
                    {bankAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.bankName} · {accountTypeLabels[account.accountType]} ·{" "}
                        {account.holderName}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <SelectedBankAccountDetail
                  account={bankAccounts.find((item) => item.id === checkout.bankAccountId)}
                  key={checkout.bankAccountId || "none"}
                />
                <FormField
                  id="checkout-transfer-reference"
                  label="Referencia"
                  error={errors.transferReference}
                >
                  <Input
                    id="checkout-transfer-reference"
                    maxLength={100}
                    onChange={(event) =>
                      onCheckoutChange({ transferReference: event.target.value })
                    }
                    value={checkout.transferReference}
                  />
                </FormField>
                <div>
                  <label
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-[var(--color-border)] p-3 text-sm text-[var(--color-text)]"
                    htmlFor="checkout-transfer-verified"
                  >
                    <input
                      checked={checkout.transferExternallyVerified}
                      className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
                      id="checkout-transfer-verified"
                      onChange={(event) =>
                        onCheckoutChange({
                          transferExternallyVerified: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    <span>He verificado externamente que la transferencia fue recibida.</span>
                  </label>
                  {errors.transferExternallyVerified ? (
                    <p className="mt-1 text-xs font-medium text-[var(--color-danger)]">
                      {errors.transferExternallyVerified}
                    </p>
                  ) : null}
                </div>
              </PaymentSection>
            ) : null}
          </div>

          {checkout.paymentMode === "mixed" ? (
            <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
              <MixedPaymentSummaryAmount label="Total aplicado" value={appliedAmount} />
              <MixedPaymentSummaryAmount
                emphasis
                label={differenceAmount >= 0 ? "Restante" : "Exceso"}
                value={Math.abs(differenceAmount)}
              />
            </div>
          ) : null}

          {errors.paymentTotal ? (
            <InlineAlert title={errors.paymentTotal} tone="danger" />
          ) : null}
        </section>

        {validated && message ? (
          <div
            className={`rounded-lg border p-4 text-sm font-semibold ${
              hasOperationalBlock
                ? "border-[var(--color-warning)] text-[var(--color-warning)]"
                : "border-[var(--color-success)] text-[var(--color-success)]"
            }`}
          >
            {message}
            {!readyToConfirm && hasOperationalBlock ? (
              <span className="mt-1 block">Estado: no listo para confirmar.</span>
            ) : null}
          </div>
        ) : null}

        {confirmationError ? (
          <InlineAlert title={confirmationError} tone="danger" />
        ) : null}
      </form>
    </Modal>
  );
}

function getDeliveryMethodMessage(deliveryMethod: DeliveryMethod) {
  if (deliveryMethod === DeliveryMethod.immediate) {
    return "No requiere preparación en bodega.";
  }
  if (deliveryMethod === DeliveryMethod.store_pickup) {
    return "Se enviará una orden a bodega para preparar el pedido.";
  }
  return "Se enviará a bodega para preparación y posterior despacho.";
}

function CashShiftStatusPanel({
  branchName,
  error,
  hasBranchAccess,
  hasOpenCashShift,
  hasSalesPermission,
  loading,
  registerCode,
}: {
  branchName: string | null;
  error: string | null;
  hasBranchAccess: boolean;
  hasOpenCashShift: boolean;
  hasSalesPermission: boolean;
  loading: boolean;
  registerCode: string | null;
}) {
  if (loading) {
    return (
      <p className="rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
        Verificando turno de caja...
      </p>
    );
  }

  if (error) {
    return <InlineAlert title={error} tone="danger" />;
  }

  if (!hasBranchAccess) {
    return <InlineAlert title="No tiene acceso a la sucursal activa." tone="warning" />;
  }

  return (
    <div className="space-y-3">
      {hasOpenCashShift ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">
          <StatusBadge status="Caja abierta" tone="success" />
          <span>
            {[branchName, registerCode ? `Caja ${registerCode}` : null].filter(Boolean).join(" · ")}
          </span>
        </div>
      ) : (
        <p className="rounded-lg border border-[var(--color-warning)] p-4 text-sm font-semibold text-[var(--color-warning)]">
          No hay un turno de caja abierto para esta sucursal.
        </p>
      )}

      {!hasSalesPermission ? (
        <p className="rounded-lg border border-[var(--color-warning)] p-4 text-sm font-semibold text-[var(--color-warning)]">
          No tienes permiso para crear ventas POS.
        </p>
      ) : null}
    </div>
  );
}

function CheckoutSummary({
  subtotal,
  discountTotal,
  total,
}: {
  subtotal: number;
  discountTotal: number;
  total: number;
}) {
  return (
    <dl className="grid gap-3 rounded-lg bg-[var(--color-app-background)] p-3 sm:grid-cols-[1fr_1fr_1.25fr] sm:p-4">
      <SummaryAmount label="Subtotal" value={subtotal} />
      <SummaryAmount label="Descuentos" value={discountTotal} />
      <SummaryAmount label="Total" value={total} prominent />
    </dl>
  );
}

function SummaryAmount({
  label,
  value,
  prominent = false,
}: {
  label: string;
  value: number;
  prominent?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd
        className={
          prominent
            ? "mt-1 text-xl font-bold text-[var(--color-title)]"
            : "mt-1 font-semibold text-[var(--color-text)]"
        }
      >
        {formatCurrency(value)}
      </dd>
    </div>
  );
}

function PaymentSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-white p-3">
      <h4 className="font-semibold text-[var(--color-title)]">{title}</h4>
      {children}
    </div>
  );
}

function SelectedBankAccountDetail({ account }: { account?: CheckoutBankAccountDto }) {
  if (!account) return null;

  return (
    <div className="space-y-2 rounded-lg border border-[var(--color-border)] bg-slate-50 p-3 text-sm">
      <DetailRow label="Banco" value={account.bankName} />
      <DetailRow label="Tipo de cuenta" value={accountTypeLabels[account.accountType]} />
      <DetailRow label="Titular" value={account.holderName} />
      <DetailRow label="Cuenta" value={account.accountNumberMasked} mono />
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">
        {label}
      </span>
      <span
        className={`text-right font-semibold text-[var(--color-text)] ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function CardTerminalPanel({
  amount,
  error,
  result,
  onProcess,
}: {
  amount: number;
  error?: string;
  result: CardTerminalResultDto;
  onProcess: (outcome: CardTerminalOutcome) => void;
}) {
  const processing = result.status === "processing";
  const approved = result.status === "approved";
  const rejected = result.status === "rejected";
  const statusLabel = processing
    ? "Procesando"
    : approved
      ? "Pago aprobado"
      : rejected
        ? "Pago rechazado"
        : "Pendiente de procesamiento";
  const statusTone = approved ? "success" : rejected ? "danger" : processing ? "info" : "neutral";

  return (
    <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--color-text)]">Terminal externa</p>
        <StatusBadge status={statusLabel} tone={statusTone} />
      </div>

      {processing ? (
        <p className="text-sm text-[var(--color-text-muted)]">Procesando pago...</p>
      ) : null}
      {approved ? (
        <div className="space-y-1 text-sm text-[var(--color-text)]">
          <p className="font-semibold">✓ Pago aprobado</p>
          <p>{formatCurrency(result.authorizedAmount ?? 0)}</p>
          <p>Autorización: {result.reference}</p>
        </div>
      ) : null}
      {rejected ? (
        <p className="text-sm font-semibold text-[var(--color-danger)]">
          ✕ Pago rechazado por terminal.
        </p>
      ) : null}
      {!processing && !approved && !rejected ? (
        <p className="text-sm text-[var(--color-text-muted)]">Pendiente de procesamiento.</p>
      ) : null}

      {error ? <p className="text-xs font-medium text-[var(--color-danger)]">{error}</p> : null}

      <div className="flex flex-col gap-2">
        <Button
          disabled={processing || amount <= 0}
          onClick={() => onProcess("approved")}
          type="button"
          variant="secondary"
        >
          {approved ? "Procesar nuevamente" : rejected ? "Reintentar" : "Procesar con terminal"}
        </Button>
        <Button
          disabled={processing || amount <= 0}
          onClick={() => onProcess("rejected")}
          type="button"
          variant="ghost"
        >
          Registrar rechazo
        </Button>
      </div>

      <p className="text-xs text-[var(--color-text-muted)]">
        OmniRetail registra únicamente el resultado y la autorización de la terminal externa.
      </p>
    </div>
  );
}

function MoneyField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  error?: string;
  onChange: (value: number) => void;
}) {
  return (
    <FormField id={id} label={label} error={error}>
      <Input
        id={id}
        inputMode="decimal"
        min="0"
        onChange={(event) => onChange(readMoneyInput(event.target.value))}
        step="0.01"
        type="number"
        value={value || ""}
      />
    </FormField>
  );
}

function ReadonlyAmount({ label, value, error }: { label: string; value: number; error?: string }) {
  return (
    <div>
      <p className="text-sm font-semibold text-[var(--color-text)]">{label}</p>
      <p className="mt-1 rounded-md bg-slate-50 px-3 py-2 text-sm font-bold text-[var(--color-title)]">
        {formatCurrency(value)}
      </p>
      {error ? (
        <p className="mt-1 text-xs font-medium text-[var(--color-danger)]">{error}</p>
      ) : null}
    </div>
  );
}

function MixedPaymentSummaryAmount({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        emphasis
          ? "border-[var(--color-structure)] bg-[var(--color-app-background)]"
          : "border-[var(--color-border)] bg-white"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-1 text-xl font-bold text-[var(--color-title)]">
        {formatCurrency(value)}
      </p>
    </div>
  );
}

function readMoneyInput(value: string): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getPaymentModeLabel(paymentMode: CheckoutPaymentMode) {
  if (paymentMode === "cash") return "Efectivo";
  if (paymentMode === "card") return "Tarjeta";
  if (paymentMode === "transfer") return "Transferencia";
  return "Mixto";
}
