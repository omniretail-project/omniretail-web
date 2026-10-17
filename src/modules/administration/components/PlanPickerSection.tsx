"use client";

import { SaasCapabilityKey } from "@/core/enums";
import type { SelectablePlanDto } from "@/modules/administration/application/dto/SubscriptionDto";
import { Button } from "@/shared/components/Button";
import { StatusBadge } from "@/shared/components/StatusBadge";

export const CAPABILITY_LABELS: Record<SaasCapabilityKey, string> = {
  [SaasCapabilityKey.inventory]: "Inventario",
  [SaasCapabilityKey.purchasing]: "Compras",
  [SaasCapabilityKey.receiving]: "Recepción",
  [SaasCapabilityKey.pos]: "Punto de venta",
  [SaasCapabilityKey.ecommerce]: "E-commerce",
  [SaasCapabilityKey.delivery]: "Entregas",
  [SaasCapabilityKey.advancedReports]: "Reportes avanzados",
  [SaasCapabilityKey.traceabilityLots]: "Trazabilidad por lotes",
  [SaasCapabilityKey.traceabilityExpiration]: "Trazabilidad por vencimiento",
  [SaasCapabilityKey.traceabilitySerials]: "Trazabilidad por número de serie",
  [SaasCapabilityKey.catalogKits]: "Kits de productos",
};

interface PlanPickerSectionProps {
  availablePlans: SelectablePlanDto[];
  currentPlanId: string;
  canManage: boolean;
  busy: boolean;
  onSelect: (plan: SelectablePlanDto) => void;
}

/**
 * Puramente presentacional -- no guarda estado propio. `onSelect` abre el `ConfirmDialog` en
 * `PlanSubscriptionPage`, nunca muta nada acá. `!canManage` deshabilita (no oculta, mismo
 * criterio que los checkboxes de permisos de `RoleForm`) las acciones; `currentPlanId` deshabilita
 * la acción de ese plan puntual porque ya está activo.
 */
export function PlanPickerSection({
  availablePlans,
  currentPlanId,
  canManage,
  busy,
  onSelect,
}: PlanPickerSectionProps) {
  const currentPlan = availablePlans.find((plan) => plan.id === currentPlanId);
  const currentCapabilities = new Set(currentPlan?.capabilities ?? []);

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <h3 className="text-base font-semibold text-[var(--color-title)]">Planes disponibles</h3>
      {!canManage ? (
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          Cambiar el plan requiere el permiso{" "}
          <span className="font-medium text-[var(--color-text)]">admin.plans.manage</span>. Pedí
          acceso a un administrador.
        </p>
      ) : null}
      <ul className="mt-4 grid gap-4 sm:grid-cols-2">
        {availablePlans.map((plan) => {
          const isCurrent = plan.id === currentPlanId;
          const gained = plan.capabilities.filter((key) => !currentCapabilities.has(key));
          const lost = [...currentCapabilities].filter((key) => !plan.capabilities.includes(key));

          return (
            <li
              className="flex flex-col gap-3 rounded-lg border border-[var(--color-border)] p-4"
              key={plan.id}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-[var(--color-title)]">{plan.name}</h4>
                {isCurrent ? <StatusBadge status="Plan actual" tone="info" /> : null}
              </div>
              {plan.description ? (
                <p className="text-sm text-[var(--color-text-muted)]">{plan.description}</p>
              ) : null}
              {gained.length > 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Agrega:{" "}
                  {gained.map((key) => CAPABILITY_LABELS[key]).join(", ")}
                </p>
              ) : null}
              {lost.length > 0 ? (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Quita: {lost.map((key) => CAPABILITY_LABELS[key]).join(", ")}
                </p>
              ) : null}
              <Button
                disabled={!canManage || busy || isCurrent}
                onClick={() => onSelect(plan)}
                type="button"
                variant={isCurrent ? "secondary" : "primary"}
              >
                {isCurrent ? "Plan actual" : "Seleccionar"}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
