"use client";

import { DeliveryMethod } from "@/core/enums";
import { PackingOrderSelector } from "@/modules/logistics/components/PackingOrderSelector";
import { PackingWorkspace } from "@/modules/logistics/components/PackingWorkspace";
import { TransferDispatchPanel } from "@/modules/logistics/components/TransferDispatchPanel";
import { DispatchReadPanel } from "@/modules/logistics/components/DispatchReadPanel";
import { useLogisticsPacking } from "@/modules/logistics/hooks/useLogisticsPacking";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { PageHeader } from "@/shared/components/PageHeader";
import { useToast } from "@/shared/components/Toast";

export function LogisticsPackingDispatchPage() {
  const packing = useLogisticsPacking();
  const repositories = useRepositories();
  const { showToast } = useToast();

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <PageHeader
        description={`Prepara pedidos de la sucursal ${packing.currentBranchName}.`}
        title="Mesa de empaque"
      />

      {!packing.hasBranchAccess && !packing.loading ? <InlineAlert description="Selecciona una sucursal autorizada para consultar la mesa de empaque." title="Sucursal no disponible" tone="warning" /> : null}
      {packing.hasBranchAccess && !packing.canRead && !packing.loading ? <InlineAlert description="Tu rol no posee logistics.packing.read." title="Acceso no autorizado" tone="warning" /> : null}
      {packing.queueError ? <InlineAlert description={packing.queueError} title="No se pudo cargar la mesa de empaque" /> : null}
      {packing.loading ? <section className="rounded-xl border border-[var(--color-border)] bg-white p-5 text-sm text-[var(--color-text-muted)] shadow-sm">Consultando pedidos preparados...</section> : null}

      {!packing.loading && packing.hasBranchAccess && packing.canRead ? (
        <>
          <section className="rounded-xl border border-[var(--color-border)] bg-white p-3.5 shadow-sm sm:p-4">
            <div className="mb-3">
              <h2 className="text-lg font-bold text-[var(--color-title)]">Pedido para preparar</h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">Solo pedidos en preparación de la sucursal activa.</p>
            </div>
            <PackingOrderSelector
              disabled={packing.submitting}
              items={packing.queue}
              onClear={packing.clearSelection}
              onSearchChange={packing.setSearch}
              onSelect={(packingId) => void packing.selectPacking(packingId)}
              search={packing.search}
              selectedPackingId={packing.selectedPackingId}
            />
          </section>

          <PackingWorkspace
            apiPacking={packing.apiPacking}
            canFinalize={packing.canFinalize}
            canPrepare={packing.canPrepare}
            completion={packing.completion}
            handoverAvailable={packing.handoverAvailable}
            detail={packing.detail}
            error={packing.workspaceError}
            loading={packing.detailLoading}
            onConfirmStorePickupDelivery={async () => {
              const delivered = await packing.confirmStorePickupDelivery();
              if (delivered) showToast({ title: "Entrega confirmada", description: "El pedido fue entregado al cliente.", tone: "success" });
              return delivered;
            }}
            onFinalize={async () => {
              const finalized = await packing.finalize();
              if (finalized) {
                const storePickup = packing.detail?.deliveryMethod === DeliveryMethod.store_pickup;
                const transfer = packing.detail?.deliveryMethod === "transfer";
                showToast({
                  title: "Preparación finalizada",
                  description: transfer ? "El traslado quedó listo para confirmar su salida." :
                    storePickup ? "El pedido quedó listo para retiro." : "El pedido quedó listo para despacho.",
                  tone: "success",
                });
              }
              return finalized;
            }}
            onGenerateLabel={async () => {
              const generated = await packing.generateLabel();
              if (generated) showToast({ title: "Etiqueta generada", description: "La vista previa utiliza los datos vigentes del pedido.", tone: "success" });
              return generated;
            }}
            onRegisterLabelPrint={async () => {
              const registered = await packing.registerLabelPrint();
              if (registered) showToast({ title: "Impresión registrada", description: "La etiqueta puede reimprimirse de forma segura.", tone: "success" });
              return registered;
            }}
            onSave={async (values) => {
              const saved = await packing.savePreparation(values);
              if (saved) showToast({ title: "Preparación guardada", description: "El checklist y los datos de empaque quedaron actualizados.", tone: "success" });
              return saved;
            }}
            selected={packing.selectedPackingId !== null}
            submitting={packing.submitting}
          />
        </>
      ) : null}
      {repositories.dispatchReadDataSource === "api" ? <DispatchReadPanel /> : <TransferDispatchPanel />}
    </div>
  );
}
