"use client";

import { useState } from "react";
import type { PosCashShiftDto } from "@/modules/pos/application/dto/PosCashShiftDto";
import { CashMovementList } from "@/modules/pos/components/CashMovementList";
import { CashMovementModal } from "@/modules/pos/components/CashMovementModal";
import { CashShiftClosingModal } from "@/modules/pos/components/CashShiftClosingModal";
import { CashShiftOpeningForm } from "@/modules/pos/components/CashShiftOpeningForm";
import { CashShiftSummary } from "@/modules/pos/components/CashShiftSummary";
import { usePosCashShift } from "@/modules/pos/hooks/usePosCashShift";
import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { PageHeader } from "@/shared/components/PageHeader";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { formatCurrency } from "@/shared/utils/formatCurrency";

export function PosCashShiftPage() {
  const cash = usePosCashShift();
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [closingModalOpen, setClosingModalOpen] = useState(false);

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-4">
      <PageHeader
        description="Administra la apertura, los movimientos y el arqueo de la caja activa."
        title="Apertura y Arqueo de Caja"
      />

      {cash.error ? (
        <InlineAlert description={cash.error} title="No se pudo completar la operación" />
      ) : null}
      {cash.successMessage ? (
        <InlineAlert
          description={cash.successMessage}
          title="Operación completada"
          tone="success"
        />
      ) : null}
      {!cash.hasBranchAccess && !cash.loading ? (
        <InlineAlert
          description="Selecciona una sucursal permitida para consultar u operar caja."
          title="Sucursal no disponible"
          tone="warning"
        />
      ) : null}

      {cash.lastClosedShift ? <ClosedCashShiftResult cashShift={cash.lastClosedShift} /> : null}

      {cash.loading ? (
        <section className="rounded-xl border border-[var(--color-border)] bg-white p-5 text-sm text-[var(--color-text-muted)] shadow-sm">
          Consultando el turno de caja...
        </section>
      ) : null}

      {!cash.loading && !cash.cashShift && cash.hasBranchAccess ? (
        <div className="min-w-0 [&>section]:overflow-hidden [&>section]:bg-white [&>section>div:first-child]:border-b-0 [&>section>div:first-child]:bg-[var(--color-structure)] [&>section>div:first-child]:px-4 [&>section>div:first-child]:py-3 [&>section>div:first-child_h2]:text-white [&>section>div:first-child_p]:text-white/80 [&>section>form]:p-4 sm:[&>section>div:first-child]:px-5 sm:[&>section>form]:p-5">
          <CashShiftOpeningForm
            branchName={cash.currentBranchName}
            canOpen={cash.canOpen}
            loading={cash.mutationLoading}
            onOpen={cash.openCashShift}
          />
        </div>
      ) : null}

      {!cash.loading && cash.cashShift && cash.summary ? (
        <>
          <CashShiftSummary
            branchName={cash.currentBranchName}
            cashierName={cash.currentUserName}
            cashShift={cash.cashShift}
            summary={cash.summary}
          />

          <section className="space-y-3 rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-bold text-[var(--color-title)]">Movimientos</h2>
                <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
                  Ventas en efectivo e ingresos o egresos manuales del turno.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 sm:shrink-0">
                <Button
                  disabled={!cash.canRegisterMovement || cash.mutationLoading}
                  onClick={() => {
                    cash.clearFeedback();
                    setMovementModalOpen(true);
                  }}
                  type="button"
                  variant="secondary"
                >
                  Nuevo movimiento
                </Button>
                <Button
                  disabled={!cash.canClose || cash.mutationLoading}
                  onClick={() => {
                    cash.clearFeedback();
                    setClosingModalOpen(true);
                  }}
                  type="button"
                  variant="danger"
                >
                  Iniciar arqueo
                </Button>
              </div>
            </div>

            {!cash.canRegisterMovement || !cash.canClose ? (
              <p className="text-xs text-[var(--color-text-muted)]">
                Las acciones no autorizadas permanecen deshabilitadas según tu rol.
              </p>
            ) : null}

            <CashMovementList movements={cash.movements} />
          </section>
        </>
      ) : null}

      <CashMovementModal
        error={cash.error}
        loading={cash.mutationLoading}
        open={movementModalOpen}
        onClose={() => setMovementModalOpen(false)}
        onSubmit={cash.registerMovement}
      />
      <CashShiftClosingModal
        error={cash.error}
        loading={cash.mutationLoading}
        open={closingModalOpen}
        onClose={() => setClosingModalOpen(false)}
        onConfirm={cash.closeCashShift}
      />
    </div>
  );
}

function ClosedCashShiftResult({ cashShift }: { cashShift: PosCashShiftDto }) {
  const difference = cashShift.difference ?? 0;
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] pb-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--color-title)]">
            Resultado del último arqueo
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Caja {cashShift.registerCode}
          </p>
        </div>
        <StatusBadge
          status={difference === 0 ? "Caja cuadrada" : "Caja con diferencia"}
          tone={difference === 0 ? "success" : "warning"}
        />
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <ResultValue label="Efectivo esperado" value={cashShift.expectedAmount ?? 0} />
        <ResultValue label="Efectivo contado" value={cashShift.countedAmount ?? 0} />
        <ResultValue
          emphasis
          label={difference < 0 ? "Faltante" : difference > 0 ? "Sobrante" : "Diferencia"}
          value={Math.abs(difference)}
        />
      </dl>
    </section>
  );
}

function ResultValue({
  emphasis = false,
  label,
  value,
}: {
  emphasis?: boolean;
  label: string;
  value: number;
}) {
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        emphasis
          ? "border-[var(--color-structure)]/35 bg-[var(--color-app-background)]"
          : "border-[var(--color-border)] bg-white"
      }`}
    >
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </dt>
      <dd className={`mt-1 font-bold text-[var(--color-title)] ${emphasis ? "text-lg" : ""}`}>
        {formatCurrency(value)}
      </dd>
    </div>
  );
}
