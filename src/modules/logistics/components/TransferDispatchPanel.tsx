"use client";

import { useTransferDispatch } from "@/modules/logistics/hooks/useTransferDispatch";
import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { useToast } from "@/shared/components/Toast";

export function TransferDispatchPanel() {
  const dispatch = useTransferDispatch();
  const { showToast } = useToast();
  if (!dispatch.canRead) return null;
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-3.5 shadow-sm sm:p-4">
      <h2 className="text-lg font-bold text-[var(--color-title)]">Traslados listos para salida</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        La salida física se registra al confirmar el despacho; la sucursal destino recibirá después.
      </p>
      {dispatch.error ? <InlineAlert description={dispatch.error} title="Traslado no disponible" /> : null}
      {dispatch.loading ? <p className="mt-3 text-sm">Consultando traslados...</p> : null}
      {!dispatch.loading && dispatch.items.length === 0 ? (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-[var(--color-text-muted)]">No hay traslados listos para despacho.</p>
      ) : null}
      <div className="mt-3 space-y-2">
        {dispatch.items.map((item) => (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5 shadow-sm" key={item.transferId}>
            <div>
              <p className="font-semibold text-[var(--color-title)]">{item.reference}</p>
              <p className="text-sm text-[var(--color-text-muted)]">
                Destino: {item.destinationName} · {item.itemCount} producto(s) · {item.packageCount} bulto(s)
              </p>
            </div>
            <Button
              disabled={!dispatch.canConfirm || dispatch.busyId !== null}
              onClick={async () => {
                if (await dispatch.confirm(item.transferId)) {
                  showToast({ title: `${item.reference} en tránsito`, tone: "success" });
                }
              }}
              type="button"
            >
              {dispatch.busyId === item.transferId ? "Confirmando..." : "Confirmar salida"}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
