import type { ReturnSaleLookupDto } from "@/modules/pos/application/dto/ReturnSaleLookupDto";
import type { SaleReversalMode } from "@/modules/pos/hooks/usePosReturns";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { formatCurrency } from "@/shared/utils/formatCurrency";

interface SaleReversalModalProps {
  mode: SaleReversalMode | null;
  lookup: ReturnSaleLookupDto | null;
  reason: string;
  quantities: Record<string, string>;
  reasonError?: string;
  lineErrors: Record<string, string>;
  isValid: boolean;
  processing: boolean;
  error: string | null;
  onReasonChange: (value: string) => void;
  onQuantityChange: (saleItemId: string, value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export function SaleReversalModal({
  mode,
  lookup,
  reason,
  quantities,
  reasonError,
  lineErrors,
  isValid,
  processing,
  error,
  onReasonChange,
  onQuantityChange,
  onClose,
  onSubmit,
}: SaleReversalModalProps) {
  if (!lookup || !mode) return null;
  const isVoid = mode === "void";

  return (
    <Modal
      open
      size="lg"
      title={isVoid ? "Confirmar anulación total" : "Procesar devolución parcial"}
      subtitle={`Documento ${lookup.sale.documentNumber}`}
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-3 sm:flex-row sm:justify-end">
          <Button disabled={processing} type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!isValid || processing}
            type="button"
            variant={isVoid ? "danger" : "primary"}
            onClick={onSubmit}
          >
            {processing ? "Procesando..." : isVoid ? "Anular venta" : "Emitir nota de crédito"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error ? (
          <InlineAlert
            description={`${error} La información de la venta fue consultada nuevamente.`}
            title="No se pudo completar la operación"
          />
        ) : null}

        {isVoid ? (
          <InlineAlert
            description="Esta acción anulará la venta completa. Confirma el motivo antes de continuar."
            title="Revisa antes de continuar"
            tone="warning"
          />
        ) : (
          <div className="space-y-3">
            <div>
              <h3 className="font-bold text-[var(--color-title)]">Cantidades a devolver</h3>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Selecciona al menos una cantidad. El importe definitivo lo calculará el sistema.
              </p>
            </div>
            {lookup.returnableItems.map((item) => (
              <div
                className="grid gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-app-background)] p-3 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-start"
                key={item.saleItemId}
              >
                <div>
                  <p className="font-semibold text-[var(--color-title)]">{item.name}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Vendida: {item.soldQuantity} · Ya devuelta: {item.returnedQuantity} ·
                    Retornable: {item.returnableQuantity}
                  </p>
                </div>
                <FormField
                  id={`return-quantity-${item.saleItemId}`}
                  label="Cantidad"
                  error={lineErrors[item.saleItemId]}
                >
                  <Input
                    disabled={processing}
                    id={`return-quantity-${item.saleItemId}`}
                    inputMode="decimal"
                    max={item.returnableQuantity}
                    min="0"
                    step="any"
                    type="number"
                    value={quantities[item.saleItemId] ?? ""}
                    onChange={(event) => onQuantityChange(item.saleItemId, event.target.value)}
                  />
                </FormField>
              </div>
            ))}
          </div>
        )}

        <FormField
          id="sale-reversal-reason"
          label="Motivo o justificación"
          error={reasonError}
          hint="Este texto quedará asociado a la operación procesada."
        >
          <textarea
            className="min-h-24 w-full resize-y rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={processing}
            id="sale-reversal-reason"
            maxLength={500}
            placeholder="Describe el motivo de la operación"
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
          />
        </FormField>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-app-background)] p-3.5">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-[var(--color-text-muted)]">
              {isVoid ? "Total original de la venta" : "Reembolso estimado"}
            </span>
            <strong className="text-[var(--color-title)]">
              {isVoid ? formatCurrency(lookup.sale.total) : "Se calculará al confirmar"}
            </strong>
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            El reembolso se calculará al confirmar y se aplicará sobre los métodos de pago
            originales.
          </p>
        </div>
      </div>
    </Modal>
  );
}
