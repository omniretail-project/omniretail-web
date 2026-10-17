"use client";

import { PickingQueue } from "@/modules/logistics/components/PickingQueueTable";
import { PickingWorkspace } from "@/modules/logistics/components/PickingWorkspaceModal";
import { useLogisticsPicking } from "@/modules/logistics/hooks/useLogisticsPicking";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { PageHeader } from "@/shared/components/PageHeader";
import { useToast } from "@/shared/components/Toast";

export function LogisticsPickingPage() {
  const picking = useLogisticsPicking();
  const { showToast } = useToast();

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <PageHeader
        description={`Prepara pedidos de la sucursal ${picking.currentBranchName}.`}
        title="Mesa de Picking"
      />

      {!picking.hasBranchAccess && !picking.loading ? <InlineAlert description="Selecciona una sucursal autorizada para consultar la mesa de Picking." title="Sucursal no disponible" tone="warning" /> : null}
      {picking.hasBranchAccess && !picking.canRead && !picking.loading ? <InlineAlert description="Tu rol no posee logistics.picking.read." title="Acceso no autorizado" tone="warning" /> : null}
      {picking.queueError ? <InlineAlert description={picking.queueError} title="No se pudo cargar Picking" /> : null}
      {picking.loading ? <section className="rounded-xl border border-[var(--color-border)] bg-white p-5 text-sm text-[var(--color-text-muted)] shadow-sm">Consultando pedidos pendientes...</section> : null}

      {!picking.loading && picking.hasBranchAccess && picking.canRead ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[21rem_minmax(0,1fr)] lg:items-start xl:grid-cols-[22rem_minmax(0,1fr)]">
          <PickingQueue
            currentUserId={picking.currentUserId}
            disabled={picking.submitting}
            items={picking.queue}
            onSearchChange={picking.setSearch}
            onSelect={(item) => void picking.openPicking(item)}
            search={picking.search}
            selectedPickingOrderId={picking.selectedPickingOrderId}
          />
          <PickingWorkspace
            canComplete={picking.canComplete}
            canStart={picking.canStart}
            commandsReadOnly={picking.commandsReadOnly}
            currentUserId={picking.currentUserId}
            detail={picking.detail}
            error={picking.workspaceError}
            key={picking.selectedPickingOrderId ?? "empty-workspace"}
            loading={picking.detailLoading}
            onAssign={async () => {
              const result = await picking.assign();
              if (result) showToast({ title: "Picking asignado", description: "Ya puedes registrar el progreso del pedido.", tone: "success" });
              return result;
            }}
            onComplete={async () => {
              const result = await picking.complete();
              if (result) showToast({ title: "Picking completado", description: "El pedido avanzó a empaque.", tone: "success" });
              return result;
            }}
            onRegisterIncident={async (values) => {
              const result = await picking.registerIncident(values);
              if (result) showToast({ title: "Incidencia registrada", description: "La incidencia quedó asociada al picking.", tone: "success" });
              return result;
            }}
            onRelease={async (reason) => {
              const result = await picking.release(reason);
              if (result) showToast({ title: "Picking liberado", description: "El progreso realizado se conserva.", tone: "success" });
              return result;
            }}
            onResolveIncident={async (incidentId) => {
              const result = await picking.resolveIncident(incidentId);
              if (result) showToast({ title: "Incidencia resuelta", tone: "success" });
              return result;
            }}
            onUpdateLine={async (line, targetQuantity, physicalSelection) => {
              const result = await picking.updateLine(line, targetQuantity, physicalSelection);
              if (result) showToast({ title: "Progreso actualizado", description: `${line.name}: ${targetQuantity} de ${line.requiredQuantity}.`, tone: "success" });
              return result;
            }}
            selected={picking.workspaceOpen}
            submitting={picking.submitting}
          />
        </div>
      ) : null}
    </div>
  );
}
