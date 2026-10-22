"use client";

import { useState } from "react";
import { CheckoutModal } from "@/modules/pos/components/CheckoutModal";
import { PendingSaleBanner } from "@/modules/pos/components/PendingSaleBanner";
import { PosTraceabilitySelector } from "@/modules/pos/components/PosTraceabilitySelector";
import { PosSalesHistoryModal } from "@/modules/pos/components/PosSalesHistoryModal";
import { ProductSearch } from "@/modules/pos/components/ProductSearch";
import { QuickProductList } from "@/modules/pos/components/QuickProductList";
import { SaleTicket } from "@/modules/pos/components/SaleTicket";
import { usePosTerminal } from "@/modules/pos/hooks/usePosTerminal";
import { Button } from "@/shared/components/Button";
import { PageHeader } from "@/shared/components/PageHeader";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { formatCurrency } from "@/shared/utils/formatCurrency";

export function PosTerminalPage() {
  const terminal = usePosTerminal();
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-4">
      <PageHeader
        actions={
          <Button type="button" variant="secondary" onClick={() => setHistoryOpen(true)}>
            Historial de ventas
          </Button>
        }
        description="Registra ventas desde la sucursal activa."
        title="Terminal de Cobro"
      />

      {terminal.pendingConfirmation ? (
        <PendingSaleBanner
          createdAt={terminal.pendingConfirmation.createdAt}
          error={terminal.confirmationError}
          itemCount={terminal.pendingConfirmation.itemCount}
          loading={terminal.confirmationLoading}
          onDiscard={terminal.discardPendingConfirmation}
          onRetry={terminal.retryPendingConfirmation}
          total={terminal.pendingConfirmation.total}
        />
      ) : null}

      {terminal.confirmationResult ? (
        <div
          className="rounded-xl border border-[var(--color-success)] bg-white p-4 shadow-sm"
          role="status"
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status="Venta confirmada" tone="success" />
            <p className="font-bold text-[var(--color-title)]">
              Venta {terminal.confirmationResult.sale.number}
            </p>
          </div>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            Total{" "}
            {formatCurrency(
              terminal.confirmationResult.sale.total,
              terminal.confirmationResult.payments[0]?.currency,
            )}
            {terminal.confirmationResult.idempotent
              ? " · Esta venta ya había sido confirmada."
              : " · Confirmación completada correctamente."}
          </p>
        </div>
      ) : null}

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(23rem,27rem)] 2xl:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="min-w-0 rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:p-5">
          <div className="rounded-lg border border-[var(--color-border)] bg-white p-3 shadow-sm sm:flex sm:items-end sm:justify-between sm:gap-4">
            <div>
              <h2 className="text-lg font-bold text-[var(--color-title)]">Productos disponibles</h2>
              <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
                Selecciona productos para agregarlos al ticket actual.
              </p>
            </div>
            <div className="mt-3 w-full sm:mt-0 sm:max-w-md">
              <ProductSearch value={terminal.search} onChange={terminal.setSearch} />
            </div>
          </div>

          <div className="mt-4">
            <QuickProductList
              error={terminal.error}
              hasProducts={terminal.products.length > 0}
              loading={terminal.loading}
              products={terminal.filteredProducts}
              onAdd={terminal.addProduct}
            />
          </div>
        </div>

        <SaleTicket
          canCheckout={terminal.canOpenCheckout}
          discountTotal={terminal.discountTotal}
          error={terminal.ticketError}
          items={terminal.ticketItems}
          subtotal={terminal.subtotal}
          total={terminal.total}
          onCheckout={terminal.openCheckout}
          onDecrease={terminal.decreaseQuantity}
          onIncrease={terminal.increaseQuantity}
          onQuantityChange={terminal.setQuantity}
          onRemove={terminal.removeItem}
        />
      </section>

      <CheckoutModal
        appliedAmount={terminal.checkoutAppliedAmount}
        availablePaymentModes={terminal.availablePaymentModes}
        bankAccounts={terminal.bankAccounts}
        bankAccountsError={terminal.bankAccountsError}
        bankAccountsLoading={terminal.bankAccountsLoading}
        cashShiftError={terminal.cashShiftError}
        cashShiftLoading={terminal.cashShiftLoading}
        cashShiftRegisterCode={terminal.cashShift?.registerCode ?? null}
        checkout={terminal.checkout}
        confirmationError={terminal.confirmationError}
        confirmationLoading={terminal.confirmationLoading}
        currentBranchName={terminal.currentBranchName}
        differenceAmount={terminal.checkoutDifferenceAmount}
        discountTotal={terminal.discountTotal}
        errors={terminal.checkoutErrors}
        hasCurrentBranchAccess={terminal.hasCurrentBranchAccess}
        hasOpenCashShift={terminal.hasOpenCashShift}
        hasOperationalBlock={terminal.checkoutHasOperationalBlock}
        hasPosSalesPermission={terminal.hasPosSalesPermission}
        hasKitItems={terminal.ticketItems.some((item) => item.isKit)}
        hasUnsupportedTraceability={terminal.hasUnsupportedTraceability}
        message={terminal.checkoutMessage}
        open={terminal.checkoutOpen}
        paymentMethodsError={terminal.paymentMethodsError}
        paymentMethodsLoading={terminal.paymentMethodsLoading}
        readyToConfirm={terminal.checkoutReadyToConfirm}
        chargeTotal={terminal.chargeTotal}
        shippingError={terminal.shippingError}
        shippingLoading={terminal.shippingLoading}
        shippingTotal={terminal.shippingTotal}
        subtotal={terminal.subtotal}
        ticketItems={terminal.ticketItems}
        total={terminal.total}
        validated={terminal.checkoutValidated}
        onCheckoutChange={terminal.updateCheckout}
        onClose={terminal.closeCheckout}
        onConfirm={terminal.confirmSale}
        onDocumentTypeChange={terminal.setDocumentType}
        onInvoiceDataChange={terminal.updateInvoiceData}
        onDeliveryAddressChange={terminal.updateDeliveryAddress}
        onStorePickupContactChange={terminal.updateStorePickupContact}
        onPaymentModeChange={terminal.setPaymentMode}
        onProcessCardPayment={terminal.processCardPayment}
        onSelectTraceability={(productId) => {
          const item = terminal.ticketItems.find((candidate) => candidate.productId === productId);
          const product = terminal.products.find((candidate) => candidate.productId === productId);
          if (item && product) terminal.prepareTraceabilitySelection(product, item.quantity);
        }}
        onReset={terminal.resetCheckout}
        onValidate={terminal.validateCheckout}
      />
      <PosSalesHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <PosTraceabilitySelector
        initialSelections={terminal.traceabilityRequest?.initialSelections}
        open={Boolean(terminal.traceabilityRequest)}
        product={
          terminal.traceabilityRequest
            ? {
                productId: terminal.traceabilityRequest.product.productId,
                name: terminal.traceabilityRequest.product.name,
                sku: terminal.traceabilityRequest.product.sku,
                requiredBaseQuantity: terminal.traceabilityRequest.requiredBaseQuantity,
                requiresLot: terminal.traceabilityRequest.product.requiresLot,
                requiresSerial: terminal.traceabilityRequest.product.requiresSerial,
                requiresExpiration: terminal.traceabilityRequest.product.requiresExpiration,
              }
            : null
        }
        onCancel={terminal.cancelTraceabilitySelection}
        onConfirm={terminal.confirmTraceabilitySelection}
      />
    </div>
  );
}
