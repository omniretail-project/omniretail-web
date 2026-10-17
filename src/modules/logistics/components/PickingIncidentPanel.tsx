import { useState } from "react";
import { PickingIncidentStatus, PickingIncidentType } from "@/core/enums";
import type {
  PickingDetailLineDto,
  PickingIncidentDto,
} from "@/modules/logistics/application/dto/PickingReadModelDto";
import {
  type PickingIncidentFormValues,
  validatePickingIncident,
} from "@/modules/logistics/validation/picking.validation";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { Input } from "@/shared/components/Input";
import { Select } from "@/shared/components/Select";
import { StatusBadge } from "@/shared/components/StatusBadge";

interface PickingIncidentPanelProps {
  canManage: boolean;
  disabled: boolean;
  incidents: PickingIncidentDto[];
  lines: PickingDetailLineDto[];
  onRegister: (values: PickingIncidentFormValues) => Promise<boolean>;
  onResolve: (incidentId: string) => Promise<boolean>;
}

const incidentTypeLabels: Record<PickingIncidentType, string> = {
  [PickingIncidentType.missing]: "Producto faltante",
  [PickingIncidentType.damaged]: "Producto dañado",
  [PickingIncidentType.quantity_difference]: "Diferencia de cantidad",
  [PickingIncidentType.location_empty]: "Ubicación vacía",
  [PickingIncidentType.invalid_lot_serial]: "Lote o serie no válido",
};

const initialValues: PickingIncidentFormValues = {
  pickingLineId: "",
  type: PickingIncidentType.missing,
  quantityAffected: "",
  comment: "",
};

export function PickingIncidentPanel({
  canManage,
  disabled,
  incidents,
  lines,
  onRegister,
  onResolve,
}: PickingIncidentPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof PickingIncidentFormValues, string>>>({});
  const openIncidentCount = incidents.filter(
    (incident) => incident.status === PickingIncidentStatus.open,
  ).length;

  const submit = async () => {
    const result = validatePickingIncident(values);
    setErrors(result.errors);
    if (!result.valid) return;
    const saved = await onRegister(values);
    if (!saved) return;
    setValues(initialValues);
    setErrors({});
  };

  const updateValues = (patch: Partial<PickingIncidentFormValues>) => {
    const nextValues = { ...values, ...patch };
    setValues(nextValues);
    setErrors((current) => {
      const validation = validatePickingIncident(nextValues);
      const nextErrors = { ...current };
      for (const field of Object.keys(patch) as Array<keyof PickingIncidentFormValues>) {
        if (!current[field]) continue;
        if (validation.errors[field]) nextErrors[field] = validation.errors[field];
        else delete nextErrors[field];
      }
      return nextErrors;
    });
  };

  return (
    <section className="space-y-3 rounded-xl border border-t-4 border-[var(--color-border)] border-t-[var(--color-structure)] bg-white p-3.5 shadow-sm">
      <button
        aria-controls="picking-incidents-content"
        aria-expanded={expanded}
        className="flex w-full items-start justify-between gap-3 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-[var(--color-title)]">Incidencias</span>
            {incidents.length > 0 ? (
              <span className="text-xs font-medium text-[var(--color-text-muted)]">
                {incidents.length} {incidents.length === 1 ? "registrada" : "registradas"}
              </span>
            ) : null}
            {openIncidentCount > 0 ? (
              <StatusBadge
                status={`${openIncidentCount} ${openIncidentCount === 1 ? "abierta" : "abiertas"}`}
                tone="warning"
              />
            ) : null}
          </span>
          <span className="mt-0.5 block text-sm text-[var(--color-text-muted)]">
            Una incidencia abierta impide completar el picking.
          </span>
        </span>
        <span aria-hidden="true" className="mt-0.5 text-lg text-[var(--color-structure)]">
          {expanded ? "−" : "+"}
        </span>
      </button>

      {expanded ? (
        <div className="space-y-3" id="picking-incidents-content">
      {incidents.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-[var(--color-text-muted)]">
          No hay incidencias registradas.
        </p>
      ) : (
        <div className="space-y-2">
          {incidents.map((incident) => {
            const line = lines.find((item) => item.pickingLineId === incident.pickingLineId);
            return (
              <article className="rounded-lg border border-[var(--color-border)] px-3 py-2.5" key={incident.id}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-[var(--color-title)]">{incidentTypeLabels[incident.type]}</p>
                      <StatusBadge status={incident.status} />
                    </div>
                    <p className="mt-1 text-sm">{incident.comment}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {line ? `${line.sku} · ${line.name}` : "Incidencia general"}
                      {incident.quantityAffected ? ` · Cantidad: ${incident.quantityAffected}` : ""}
                    </p>
                  </div>
                  {canManage && incident.status === PickingIncidentStatus.open ? (
                    <Button disabled={disabled} onClick={() => void onResolve(incident.id)} type="button" variant="secondary">
                      Resolver
                    </Button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {canManage ? (
        <div className="space-y-2.5 border-t border-[var(--color-border)] pt-3">
          <h4 className="font-semibold text-[var(--color-title)]">Registrar incidencia</h4>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <FormField id="picking-incident-line" label="Producto">
              <Select
                disabled={disabled}
                id="picking-incident-line"
                onChange={(event) => updateValues({ pickingLineId: event.target.value })}
                value={values.pickingLineId}
              >
                <option value="">Incidencia general</option>
                {lines.map((line) => <option key={line.pickingLineId} value={line.pickingLineId}>{line.sku} · {line.name}</option>)}
              </Select>
            </FormField>
            <FormField id="picking-incident-type" label="Tipo">
              <Select
                disabled={disabled}
                id="picking-incident-type"
                onChange={(event) => updateValues({ type: event.target.value as PickingIncidentType })}
                value={values.type}
              >
                {Object.values(PickingIncidentType).map((type) => <option key={type} value={type}>{incidentTypeLabels[type]}</option>)}
              </Select>
            </FormField>
            <FormField error={errors.quantityAffected} id="picking-incident-quantity" label="Cantidad afectada (opcional)">
              <Input
                disabled={disabled}
                id="picking-incident-quantity"
                min={1}
                onChange={(event) => updateValues({ quantityAffected: event.target.value })}
                step={1}
                type="number"
                value={values.quantityAffected}
              />
            </FormField>
            <div className="sm:col-span-2">
              <FormField error={errors.comment} id="picking-incident-comment" label="Comentario *">
                <textarea
                  className="min-h-20 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={disabled}
                  id="picking-incident-comment"
                  maxLength={500}
                  onChange={(event) => updateValues({ comment: event.target.value })}
                  value={values.comment}
                />
              </FormField>
            </div>
          </div>
          <div className="flex justify-end">
            <Button disabled={disabled} onClick={() => void submit()} type="button" variant="secondary">
              Registrar incidencia
            </Button>
          </div>
        </div>
      ) : null}
        </div>
      ) : null}
    </section>
  );
}
