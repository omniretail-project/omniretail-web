"use client";

import { getDemoInformationRequestUrl, getSalesContactUrl } from "@/config/demo-mode";
import { SaasCapabilityKey, SaasLimitKey } from "@/core/enums";
import { SUBSCRIPTION_ADDONS } from "@/core/subscription/catalog";
import { useTenantSubscription } from "@/modules/administration/hooks/useTenantSubscription";
import { AccessDeniedState } from "@/shared/components/AccessDeniedState";
import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { PageHeader } from "@/shared/components/PageHeader";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { formatDate } from "@/shared/utils/formatDate";

type SubscriptionDetails = NonNullable<ReturnType<typeof useTenantSubscription>["details"]>;

export const PLAN_CHANGE_NOTE =
  "Los módulos habilitados corresponden a la configuración de tu empresa. Para solicitar cambios, contacta con el equipo MARJYM.";

const CAPABILITY_LABELS: Record<SaasCapabilityKey, string> = {
  [SaasCapabilityKey.inventory]: "Inventario",
  [SaasCapabilityKey.purchasing]: "Compras",
  [SaasCapabilityKey.receiving]: "Recepción de mercadería",
  [SaasCapabilityKey.pos]: "Punto de venta",
  [SaasCapabilityKey.ecommerce]: "E-commerce",
  [SaasCapabilityKey.delivery]: "Entregas y despachos",
  [SaasCapabilityKey.advancedReports]: "Reportes avanzados",
  [SaasCapabilityKey.traceabilityLots]: "Trazabilidad por lote",
  [SaasCapabilityKey.traceabilityExpiration]: "Control de vencimiento",
  [SaasCapabilityKey.traceabilitySerials]: "Números de serie",
  [SaasCapabilityKey.catalogKits]: "Kits y combinaciones",
};

const USAGE_LABELS: Array<{ key: SaasLimitKey; label: string }> = [
  { key: SaasLimitKey.maxEmployees, label: "Usuarios" },
  { key: SaasLimitKey.maxBranches, label: "Sucursales" },
];

function UsageTile({
  label,
  usage,
}: Readonly<{ label: string; usage: SubscriptionDetails["usage"][number] | undefined }>) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <span className="block text-xs text-[var(--color-text-muted)]">{label}</span>
      <strong className="mt-1 block tabular-nums text-[var(--color-title)]">
        {usage ? usage.current : "No disponible"}
        {usage ? (
          <span className="ml-1 text-xs font-medium text-[var(--color-text-muted)]">
            {usage.limit === null ? "(sin límite definido)" : `de ${usage.limit}`}
          </span>
        ) : null}
      </strong>
    </div>
  );
}

function StateBadge({ active, label }: Readonly<{ active: boolean; label: string }>) {
  return (
    <span
      className={
        "inline-flex whitespace-nowrap rounded-md px-2 py-1 text-xs font-semibold " +
        (active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700")
      }
    >
      {label}
    </span>
  );
}

export function PlanSubscriptionPage() {
  const { canRead, details, error, loading, reload } = useTenantSubscription();
  // Solo se ofrece un enlace si el despliegue configura un canal comercial; nunca se inventa uno.
  const contactUrl = getDemoInformationRequestUrl() || getSalesContactUrl();

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <PageHeader
        title="Mi plan y módulos"
        description="Consulta el plan de tu empresa y los módulos que tiene habilitados."
      />

      {!loading && !canRead ? <AccessDeniedState /> : null}

      {error ? (
        <InlineAlert
          className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          title={error}
          tone="danger"
        >
          <Button type="button" variant="secondary" onClick={() => void reload()}>
            Reintentar
          </Button>
        </InlineAlert>
      ) : null}

      {loading ? (
        <div
          aria-live="polite"
          className="flex min-h-48 items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-sm font-medium text-[var(--color-text-muted)] shadow-sm"
        >
          <span
            aria-hidden="true"
            className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-structure)]"
          />
          Cargando plan y módulos...
        </div>
      ) : null}

      {details && canRead ? (
        <>
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Plan
                </p>
                <h2 className="mt-1 text-2xl font-bold text-[var(--color-title)]">
                  {details.plan.name}
                </h2>
                {details.plan.description ? (
                  <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                    {details.plan.description}
                  </p>
                ) : null}
                <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                  Activo desde {formatDate(details.subscription.startedAt)}
                </p>
              </div>
              <StatusBadge status={details.subscription.status} />
            </div>

            <div className="mt-5 grid gap-3 border-t border-[var(--color-border)] pt-4 text-sm sm:grid-cols-2">
              {USAGE_LABELS.map(({ key, label }) => (
                <UsageTile
                  key={key}
                  label={label}
                  usage={details.usage.find((item) => item.key === key)}
                />
              ))}
            </div>
          </section>

          <section
            aria-labelledby="plan-modules-title"
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm"
          >
            <h2 id="plan-modules-title" className="text-lg font-bold text-[var(--color-title)]">
              Módulos incluidos
            </h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {details.capabilities.map((capability) => (
                <li
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm"
                  key={capability.key}
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-[var(--color-title)]">
                      {CAPABILITY_LABELS[capability.key] ?? capability.key}
                    </span>
                    {capability.included && capability.operationalStatus ? (
                      <span className="block text-xs text-[var(--color-text-muted)]">
                        {capability.operationalStatus}
                      </span>
                    ) : null}
                  </span>
                  <StateBadge
                    active={capability.included}
                    label={capability.included ? "Incluido" : "No incluido"}
                  />
                </li>
              ))}
            </ul>
          </section>

          <section
            aria-labelledby="plan-addons-title"
            className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm"
          >
            <h2 id="plan-addons-title" className="text-lg font-bold text-[var(--color-title)]">
              Complementos
            </h2>
            <ul className="mt-3 grid gap-3 md:grid-cols-2">
              {SUBSCRIPTION_ADDONS.map((addon) => {
                const active = details.addonCodes.includes(addon.code);
                return (
                  <li
                    className="flex items-start justify-between gap-4 rounded-lg border border-[var(--color-border)] p-4"
                    key={addon.code}
                  >
                    <div className="min-w-0">
                      <h3 className="font-semibold text-[var(--color-title)]">{addon.name}</h3>
                      <p className="mt-1 text-sm leading-5 text-[var(--color-text-muted)]">
                        {addon.description}
                      </p>
                    </div>
                    <StateBadge active={active} label={active ? "Activo" : "No activo"} />
                  </li>
                );
              })}
            </ul>
          </section>

          <InlineAlert title={PLAN_CHANGE_NOTE} tone="info">
            {contactUrl ? (
              <a
                className="mt-2 inline-block text-sm font-semibold underline"
                href={contactUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                Contactar al equipo MARJYM
              </a>
            ) : null}
          </InlineAlert>
        </>
      ) : null}
    </div>
  );
}
