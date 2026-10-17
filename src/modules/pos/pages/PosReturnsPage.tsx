"use client";

import { ReturnSaleDetails } from "@/modules/pos/components/ReturnSaleDetails";
import { ReturnSaleSearch } from "@/modules/pos/components/ReturnSaleSearch";
import { SaleReversalModal } from "@/modules/pos/components/SaleReversalModal";
import { SaleReversalResult } from "@/modules/pos/components/SaleReversalResult";
import { usePosReturns } from "@/modules/pos/hooks/usePosReturns";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { PageHeader } from "@/shared/components/PageHeader";

export function PosReturnsPage() {
  const returns = usePosReturns();

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <PageHeader
        description="Consulta ventas y procesa anulaciones o devoluciones desde la sucursal activa."
        title="Anulaciones y Devoluciones"
      />

      {returns.accessBlocked ? (
        <InlineAlert
          description="Necesitas permiso de consulta y acceso a una sucursal activa para utilizar esta pantalla."
          title="Acceso bloqueado"
          tone="warning"
        />
      ) : null}
      {returns.lookupError ? (
        <InlineAlert description={returns.lookupError} title="No se pudo consultar el documento" />
      ) : null}
      {returns.operationNotice ? (
        <InlineAlert
          description={returns.operationNotice}
          title="La operación dejó de estar disponible"
          tone="warning"
        />
      ) : null}
      {returns.notFound ? (
        <InlineAlert
          description="Verifica el número. Por seguridad, solo se consultan documentos de la sucursal activa."
          title="Documento no encontrado"
          tone="info"
        />
      ) : null}

      <ReturnSaleSearch
        disabled={returns.contextLoading || returns.accessBlocked}
        loading={returns.isSearching}
        value={returns.documentNumber}
        onChange={returns.setDocumentNumber}
        onSearch={returns.search}
      />

      {returns.contextLoading ? (
        <section className="rounded-xl border border-[var(--color-border)] bg-white p-5 text-sm text-[var(--color-text-muted)] shadow-sm">
          Preparando la sesión y la sucursal activa...
        </section>
      ) : null}

      {!returns.contextLoading &&
      !returns.accessBlocked &&
      !returns.lookup &&
      !returns.isSearching &&
      !returns.notFound &&
      !returns.lookupError ? (
        <section className="rounded-xl border border-dashed border-[var(--color-border)] bg-white px-5 py-7 text-center shadow-sm">
          <h2 className="font-bold text-[var(--color-title)]">Busca una venta para comenzar</h2>
          <p className="mx-auto mt-1 max-w-xl text-sm text-[var(--color-text-muted)]">
            Las operaciones disponibles se determinarán a partir del documento y el contexto actual.
          </p>
        </section>
      ) : null}

      {returns.result ? <SaleReversalResult result={returns.result} /> : null}

      {returns.lookup ? (
        <ReturnSaleDetails
          canProcessReturn={returns.canProcessReturn}
          canVoid={returns.canVoid}
          lookup={returns.lookup}
          onBeginOperation={returns.beginOperation}
        />
      ) : null}

      <SaleReversalModal
        error={returns.operationError}
        isValid={returns.formIsValid}
        lineErrors={returns.lineErrors}
        lookup={returns.lookup}
        mode={returns.mode}
        processing={returns.processing}
        quantities={returns.quantities}
        reason={returns.reason}
        reasonError={returns.reasonError}
        onClose={returns.closeOperation}
        onQuantityChange={returns.setLineQuantity}
        onReasonChange={returns.setReason}
        onSubmit={returns.submitOperation}
      />
    </div>
  );
}
