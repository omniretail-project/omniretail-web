import { useState } from "react";
import { DeliveryMethod, PickingIncidentStatus, PickingPriority, PickingStatus } from "@/core/enums";
import type {
  PickingDetailDto,
  PickingDetailLineDto,
} from "@/modules/logistics/application/dto/PickingReadModelDto";
import type { PickingPhysicalSelectionResult } from "@/modules/logistics/application/pickingPhysicalSelection";
import { PickingIncidentPanel } from "@/modules/logistics/components/PickingIncidentPanel";
import { PickingLineList } from "@/modules/logistics/components/PickingLineList";
import type { PickingIncidentFormValues } from "@/modules/logistics/validation/picking.validation";
import { validateReleaseReason } from "@/modules/logistics/validation/picking.validation";
import { Button } from "@/shared/components/Button";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { FormField } from "@/shared/components/FormField";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { Modal } from "@/shared/components/Modal";
import { StatusBadge } from "@/shared/components/StatusBadge";

interface PickingWorkspaceProps {
  canComplete: boolean;
  canStart: boolean;
  commandsReadOnly: boolean;
  currentUserId: string | null;
  detail: PickingDetailDto | null;
  error: string | null;
  loading: boolean;
  selected: boolean;
  onAssign: () => Promise<boolean>;
  onComplete: () => Promise<boolean>;
  onRegisterIncident: (values: PickingIncidentFormValues) => Promise<boolean>;
  onRelease: (reason: string) => Promise<boolean>;
  onResolveIncident: (incidentId: string) => Promise<boolean>;
  onUpdateLine: (
    line: PickingDetailLineDto,
    targetQuantity: number,
    physicalSelection: PickingPhysicalSelectionResult,
  ) => Promise<boolean>;
  submitting: boolean;
}

const deliveryLabels: Record<DeliveryMethod | "transfer", string> = {
  transfer: "Traslado entre sucursales",
  [DeliveryMethod.immediate]: "Entrega inmediata",
  [DeliveryMethod.store_pickup]: "Retiro en tienda",
  [DeliveryMethod.home_delivery]: "Envío a domicilio",
};

const statusLabels: Record<PickingStatus, string> = {
  [PickingStatus.pending]: "Pendiente",
  [PickingStatus.assigned]: "Asignado",
  [PickingStatus.in_progress]: "En progreso",
  [PickingStatus.completed]: "Completado",
  [PickingStatus.cancelled]: "Cancelado",
};

const priorityLabels: Record<PickingPriority, string> = {
  [PickingPriority.low]: "Baja",
  [PickingPriority.normal]: "Normal",
  [PickingPriority.high]: "Alta",
  [PickingPriority.urgent]: "Urgente",
};

export function PickingWorkspace(props: PickingWorkspaceProps) {
  const [completeConfirmationOpen, setCompleteConfirmationOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [releaseReason, setReleaseReason] = useState("");
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const detail = props.detail;
  const assignedToCurrentUser = Boolean(detail?.assignedUserId && detail.assignedUserId === props.currentUserId);
  const assignedToOther = Boolean(detail?.assignedUserId && detail.assignedUserId !== props.currentUserId);
  const hasOpenIncidents = Boolean(detail?.incidents.some((incident) => incident.status === PickingIncidentStatus.open));
  const allLinesComplete = Boolean(detail?.lines.length && detail.lines.every((line) => line.remainingQuantity === 0));
  const canFinish = assignedToCurrentUser && allLinesComplete && !hasOpenIncidents && props.canComplete;

  const release = async () => {
    const validationError = validateReleaseReason(releaseReason);
    setReleaseError(validationError);
    if (validationError) return;
    const saved = await props.onRelease(releaseReason.trim());
    if (!saved) return;
    setReleaseOpen(false);
    setReleaseReason("");
    setReleaseError(null);
  };

  const updateReleaseReason = (nextReason: string) => {
    setReleaseReason(nextReason);
    if (releaseError) setReleaseError(validateReleaseReason(nextReason));
  };

  return (
    <>
      <section className="min-w-0 rounded-xl border border-[var(--color-border)] bg-white shadow-sm">
        {!props.selected ? (
          <div className="flex min-h-64 items-center justify-center bg-white p-5 text-center sm:p-6">
            <div className="max-w-lg rounded-xl border border-dashed border-[var(--color-border)] bg-slate-50 px-6 py-6 sm:px-8">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-structure)] text-base font-bold text-white">1</div>
              <h2 className="mt-3 text-xl font-bold text-[var(--color-title)]">Selecciona un pedido</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-[var(--color-text-muted)]">
                Elige un pedido de la cola para revisar los productos, ubicaciones y cantidades a recolectar.
              </p>
              <p className="mt-4 text-xs font-medium text-[var(--color-text-muted)]">
                Selecciona · Toma el picking · Registra el progreso · Completa
              </p>
            </div>
          </div>
        ) : null}

        {props.selected && props.loading ? (
          <div className="flex min-h-[30rem] items-center justify-center p-6 text-sm text-[var(--color-text-muted)]">
            Cargando workspace de picking...
          </div>
        ) : null}

        {props.selected && !props.loading && props.error && !detail ? (
          <div className="p-5"><InlineAlert description={props.error} title="No se pudo cargar el picking" /></div>
        ) : null}

        {detail ? (
          <div>
            <header className="border-b border-t-4 border-[var(--color-border)] border-t-[var(--color-structure)] bg-white p-3.5 sm:p-4">
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Hoja de recolección</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold text-[var(--color-title)]">{detail.orderReference}</h2>
                    <StatusBadge status={statusLabels[detail.status]} tone={detail.status === PickingStatus.pending ? "warning" : "info"} />
                    <StatusBadge status={priorityLabels[detail.priority]} tone={detail.priority === PickingPriority.urgent ? "danger" : detail.priority === PickingPriority.high ? "warning" : "neutral"} />
                  </div>
                </div>
                <div className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5">
                  <div className="flex justify-between text-xs font-semibold text-[var(--color-title)]">
                    <span>Progreso general</span><span>{detail.progress.percentage}%</span>
                  </div>
                  <div aria-label={`Progreso ${detail.progress.percentage}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={detail.progress.percentage} className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--color-app-background)]" role="progressbar">
                    <div className="h-full rounded-full bg-[var(--color-primary)]" style={{ width: `${detail.progress.percentage}%` }} />
                  </div>
                  <p className="mt-1 text-right text-xs text-[var(--color-text-muted)]">
                    {detail.progress.pickedQuantity} de {detail.progress.requiredQuantity} unidades recolectadas
                  </p>
                </div>
              </div>

              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5"><dt className="text-xs font-medium text-[var(--color-text-muted)]">Documento</dt><dd className="mt-1 font-semibold text-[var(--color-title)]">{detail.orderReference}</dd></div>
                <div className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5"><dt className="text-xs font-medium text-[var(--color-text-muted)]">Cliente</dt><dd className="mt-1 font-semibold text-[var(--color-title)]">{detail.customerName}</dd></div>
                <div className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5"><dt className="text-xs font-medium text-[var(--color-text-muted)]">Entrega</dt><dd className="mt-1 font-semibold text-[var(--color-title)]">{deliveryLabels[detail.deliveryMethod]}</dd></div>
                <div className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5"><dt className="text-xs font-medium text-[var(--color-text-muted)]">Asignación</dt><dd className="mt-1 font-semibold text-[var(--color-title)]">{!detail.assignedUserId ? "Sin asignar" : assignedToCurrentUser ? "Asignado a ti" : "Otro operador"}</dd></div>
              </dl>
            </header>

            <div className="space-y-4 p-3.5 sm:p-4">
              {props.error ? <InlineAlert description={props.error} title="No se pudo completar la operación" /> : null}
              {!detail.assignedUserId && props.canStart ? (
                <InlineAlert description="Debes asignarte este picking antes de registrar progreso o incidencias." title="Picking sin asignar" tone="info">
                  <Button disabled={props.submitting} onClick={() => void props.onAssign()} type="button">Tomar picking</Button>
                </InlineAlert>
              ) : null}
              {assignedToOther ? <InlineAlert description="Otro operador tiene asignado este picking. Puedes consultar el detalle, pero no editarlo." title="Picking asignado" tone="warning" /> : null}
              {props.commandsReadOnly ? <InlineAlert description="Las acciones de Picking permanecen bloqueadas hasta integrar sus comandos con el backend." title="Modo de solo lectura" tone="info" /> : null}
              {!props.commandsReadOnly && !props.canStart ? <InlineAlert description="Tu rol no posee logistics.picking.start. El detalle está disponible únicamente para consulta." title="Acciones restringidas" tone="warning" /> : null}

              <PickingLineList
                disabled={props.submitting}
                editable={assignedToCurrentUser && props.canStart}
                incidents={detail.incidents}
                lines={detail.lines}
                onUpdate={props.onUpdateLine}
              />
              <PickingIncidentPanel canManage={assignedToCurrentUser && props.canStart} disabled={props.submitting} incidents={detail.incidents} lines={detail.lines} onRegister={props.onRegisterIncident} onResolve={props.onResolveIncident} />

              {detail.releases.length > 0 ? (
                <section className="rounded-xl border border-[var(--color-border)] bg-white p-3.5">
                  <h3 className="font-bold text-[var(--color-title)]">Historial de liberaciones</h3>
                  <div className="mt-2.5 space-y-2">
                    {detail.releases.map((item) => (
                      <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm" key={item.id}>
                        <p>{item.reason}</p>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{formatDateTime(item.releasedAt)}</p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {!allLinesComplete ? <InlineAlert description="Completa todas las cantidades requeridas antes de finalizar." title="Picking pendiente" tone="info" /> : null}
              {hasOpenIncidents ? <InlineAlert description="Resuelve todas las incidencias abiertas antes de finalizar." title="Incidencias pendientes" tone="warning" /> : null}
              {allLinesComplete && !hasOpenIncidents && !props.canComplete ? <InlineAlert description="Tu rol no posee logistics.picking.complete." title="No puedes completar este picking" tone="warning" /> : null}

              <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:justify-end">
                {assignedToCurrentUser && props.canStart ? (
                  <Button disabled={props.submitting} onClick={() => setReleaseOpen(true)} type="button" variant="secondary">Liberar picking</Button>
                ) : null}
                <Button disabled={props.submitting || !canFinish} onClick={() => setCompleteConfirmationOpen(true)} type="button">Completar picking</Button>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <Modal
        footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button disabled={props.submitting} onClick={() => setReleaseOpen(false)} type="button" variant="secondary">Cancelar</Button><Button disabled={props.submitting} onClick={() => void release()} type="button">Liberar</Button></div>}
        onClose={() => { if (!props.submitting) setReleaseOpen(false); }}
        open={releaseOpen}
        title="Liberar picking"
      >
        <FormField error={releaseError ?? undefined} hint="El progreso y su trazabilidad se conservarán." id="picking-release-reason" label="Motivo *">
          <Input disabled={props.submitting} id="picking-release-reason" maxLength={500} onChange={(event) => updateReleaseReason(event.target.value)} value={releaseReason} />
        </FormField>
      </Modal>

      <ConfirmDialog
        cancelLabel="Volver"
        confirmLabel={props.submitting ? "Completando..." : "Completar"}
        message="Se completará el picking y el pedido avanzará a empaque según su modalidad de entrega."
        onCancel={() => { if (!props.submitting) setCompleteConfirmationOpen(false); }}
        onConfirm={async () => {
          if (props.submitting) return;
          const completed = await props.onComplete();
          if (completed) setCompleteConfirmationOpen(false);
        }}
        open={completeConfirmationOpen}
        title="Completar picking"
      />
    </>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-GT", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
