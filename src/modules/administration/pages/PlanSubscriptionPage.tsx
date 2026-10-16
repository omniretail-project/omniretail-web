"use client";

import { useState } from "react";
import { isPublicDemo } from "@/config/demo-mode";
import {
  BASE_MONTHLY_QUETZALES,
  SUBSCRIPTION_ADDONS,
  subscriptionTotalQuetzales,
} from "@/core/subscription/catalog";
import { useTenantSubscription } from "@/modules/administration/hooks/useTenantSubscription";
import { AccessDeniedState } from "@/shared/components/AccessDeniedState";
import { Button } from "@/shared/components/Button";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { PageHeader } from "@/shared/components/PageHeader";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { useToast } from "@/shared/components/Toast";
import { formatDate } from "@/shared/utils/formatDate";

const money = (amount: number) => "Q" + amount.toFixed(2);

type Addon = (typeof SUBSCRIPTION_ADDONS)[number];
type SubscriptionDetails = NonNullable<ReturnType<typeof useTenantSubscription>["details"]>;

const usageCurrent = (usage: SubscriptionDetails["usage"], key: string) =>
  usage.find((item) => item.key === key)?.current ?? 0;

function AddonCard({
  addon,
  enabled,
  disabled,
  onToggle,
}: Readonly<{
  addon: Addon;
  enabled: boolean;
  disabled: boolean;
  onToggle: (code: string) => void;
}>) {
  return (
    <article
      className={
        "flex items-center justify-between gap-4 rounded-xl border bg-[var(--color-surface)] p-4 shadow-sm " +
        (enabled ? "border-blue-300" : "border-[var(--color-border)]")
      }
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="font-semibold text-[var(--color-title)]">{addon.name}</h3>
          <strong className="whitespace-nowrap text-sm tabular-nums text-[var(--color-title)]">
            +{money(addon.monthlyQuetzales)}/mes
          </strong>
        </div>
        <p className="mt-1 text-sm leading-5 text-[var(--color-text-muted)]">{addon.description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={"Activar " + addon.name}
        disabled={disabled}
        onClick={() => onToggle(addon.code)}
        className={
          "relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)] disabled:opacity-50 " +
          (enabled ? "bg-blue-600" : "bg-slate-300")
        }
      >
        <span
          className={
            "absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform " +
            (enabled ? "translate-x-5" : "")
          }
        />
      </button>
    </article>
  );
}

// Nota bajo el catalogo: la demo es solo lectura; fuera de la demo, falta el permiso de gestion.
function ManageNote({ demo, canManage }: Readonly<{ demo: boolean; canManage: boolean }>) {
  let message: string | null = null;
  if (demo) {
    message = "En la demo la suscripción es de solo lectura. Disponible en la versión contratada.";
  } else if (!canManage) {
    message = "Se requiere admin.plans.manage para modificar la suscripción.";
  }
  if (!message) return null;
  return <p className="mt-3 text-sm text-[var(--color-text-muted)]">{message}</p>;
}

function BillingHistory({ invoices }: Readonly<{ invoices: SubscriptionDetails["invoices"] }>) {
  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <h2 className="text-lg font-bold text-[var(--color-title)]">Historial de facturación</h2>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        Estos registros no son facturas fiscales ni comprobantes de pago.
      </p>
      {invoices.length === 0 ? (
        <p className="mt-4 rounded-lg bg-slate-50 px-4 py-5 text-sm text-[var(--color-text-muted)]">
          Aún no hay ciclos registrados.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--color-border)]">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="py-3 text-sm">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-slate-50">
                  <span>Ciclo desde {formatDate(invoice.cycleStart)}</span>
                  <strong className="tabular-nums text-[var(--color-title)]">
                    {money(invoice.totalQuetzales)}
                  </strong>
                </summary>
                <ul className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 text-[var(--color-text-muted)]">
                  <li className="flex justify-between gap-3">
                    <span>MARJYM Base</span>
                    <span className="tabular-nums">{money(invoice.baseQuetzales)}</span>
                  </li>
                  {invoice.addonLines.map((line) => (
                    <li key={line.code} className="flex justify-between gap-3">
                      <span>{line.name}</span>
                      <span className="tabular-nums">{money(line.amountQuetzales)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PlanSubscriptionPage() {
  const {
    busy,
    canManage: canManageSubscription,
    canRead,
    details,
    error,
    loading,
    reload,
    updateAddons,
  } = useTenantSubscription();
  // En la demo publica el plan es de solo lectura: contratar o cambiar modulos se hace en la version real.
  const demo = isPublicDemo();
  const canManage = canManageSubscription && !demo;
  const { showToast } = useToast();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [confirming, setConfirming] = useState(false);

  const selected = draft ?? details?.addonCodes ?? [];
  const saved = details?.addonCodes ?? [];
  const dirty = [...selected].sort().join("|") !== [...saved].sort().join("|");
  const disablingEcommerce =
    saved.includes("ecommerce_delivery") && !selected.includes("ecommerce_delivery");
  const toggle = (code: string) =>
    setDraft((current) => {
      const values = current ?? saved;
      return values.includes(code)
        ? values.filter((item) => item !== code)
        : [...values, code];
    });

  async function save() {
    try {
      await updateAddons(selected);
      setDraft(null);
      setConfirming(false);
      showToast({
        title: "Suscripción actualizada",
        description:
          "Los accesos ya reflejan la selección. El nuevo total se aplicará al siguiente ciclo.",
        tone: "success",
      });
    } catch (caughtError) {
      setConfirming(false);
      showToast({
        title: "No se pudo actualizar",
        description:
          caughtError instanceof Error ? caughtError.message : "Inténtelo de nuevo.",
        tone: "danger",
      });
    }
  }

  const projectedTotal = subscriptionTotalQuetzales(selected);
  const confirmationMessage = disablingEcommerce
    ? "Al desactivar E-commerce + Entregas se bloquearán nuevas compras en la tienda online. Los pedidos existentes podrán continuar su preparación, despacho y seguimiento. El total proyectado de " +
      money(projectedTotal) +
      "/mes se aplicará en el próximo ciclo, sin cobro inmediato."
    : "El acceso a los módulos cambiará de inmediato. El total proyectado de " +
      money(projectedTotal) +
      "/mes se aplicará en el próximo ciclo, sin cobro inmediato.";

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <PageHeader
        title="Plan y suscripción"
        description="Configure los módulos del negocio y consulte la facturación."
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
          Cargando suscripción...
        </div>
      ) : null}

      {details && canRead ? (
        <>
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Plan actual
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <h2 className="text-2xl font-bold text-[var(--color-title)]">MARJYM Base</h2>
                  <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                    Incluido y obligatorio
                  </span>
                </div>
                <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                  Activo desde {formatDate(details.subscription.startedAt)} · Próxima renovación{" "}
                  {formatDate(details.nextRenewalAt)}
                </p>
              </div>
              <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                <StatusBadge status={details.subscription.status} />
                <p className="text-xl font-bold tabular-nums text-[var(--color-title)]">
                  {money(BASE_MONTHLY_QUETZALES)}
                  <span className="text-sm font-medium text-[var(--color-text-muted)]">/mes</span>
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 border-t border-[var(--color-border)] pt-4 text-sm sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                <span className="block text-xs text-[var(--color-text-muted)]">Usuarios</span>
                <strong className="mt-1 block tabular-nums text-[var(--color-title)]">
                  {usageCurrent(details.usage, "maxEmployees")}
                </strong>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                <span className="block text-xs text-[var(--color-text-muted)]">Sucursales</span>
                <strong className="mt-1 block tabular-nums text-[var(--color-title)]">
                  {usageCurrent(details.usage, "maxBranches")}
                </strong>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2.5">
                <span className="block text-xs text-[var(--color-text-muted)]">Punto de venta</span>
                <strong className="mt-1 block text-[var(--color-title)]">
                  Incluido, sin cupo comercial de cajas
                </strong>
              </div>
            </div>
          </section>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
            <section aria-labelledby="subscription-catalog-title">
              <div>
                <h2
                  id="subscription-catalog-title"
                  className="text-lg font-bold text-[var(--color-title)]"
                >
                  Módulos de la suscripción
                </h2>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  El plan base siempre está incluido. Active únicamente los módulos opcionales que
                  necesite.
                </p>
              </div>

              <div className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-[var(--color-title)]">MARJYM Base</h3>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-[var(--color-text-muted)]">
                        Obligatorio
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-[var(--color-text-muted)]">
                      Catálogo, inventario, proveedores y compras, recepción y punto de venta.
                    </p>
                  </div>
                  <strong className="whitespace-nowrap tabular-nums text-[var(--color-title)]">
                    {money(BASE_MONTHLY_QUETZALES)}/mes
                  </strong>
                </div>
              </div>

              <div className="mt-3 grid gap-3">
                {SUBSCRIPTION_ADDONS.map((addon) => (
                  <AddonCard
                    key={addon.code}
                    addon={addon}
                    enabled={selected.includes(addon.code)}
                    disabled={!canManage || busy}
                    onToggle={toggle}
                  />
                ))}
              </div>

              <ManageNote demo={demo} canManage={canManage} />
            </section>

            <section
              aria-labelledby="subscription-summary-title"
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm lg:sticky lg:top-4"
            >
              <h2
                id="subscription-summary-title"
                className="text-lg font-bold text-[var(--color-title)]"
              >
                Resumen mensual proyectado
              </h2>
              <p className="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">
                Se aplicará al próximo ciclo, sin prorrateos ni cobros inmediatos.
              </p>
              <ul className="mt-4 divide-y divide-[var(--color-border)] text-sm">
                <li className="flex justify-between gap-3 py-3">
                  <span>MARJYM Base</span>
                  <strong className="tabular-nums">{money(BASE_MONTHLY_QUETZALES)}</strong>
                </li>
                {SUBSCRIPTION_ADDONS.filter((addon) => selected.includes(addon.code)).map(
                  (addon) => (
                    <li key={addon.code} className="flex justify-between gap-3 py-3">
                      <span>{addon.name}</span>
                      <strong className="tabular-nums">{money(addon.monthlyQuetzales)}</strong>
                    </li>
                  ),
                )}
              </ul>
              <div className="flex items-baseline justify-between gap-3 border-t border-[var(--color-border)] py-4">
                <span className="font-semibold text-[var(--color-title)]">Total mensual</span>
                <span className="text-xl font-bold tabular-nums text-[var(--color-title)]">
                  {money(projectedTotal)}
                </span>
              </div>
              <Button
                className="w-full"
                type="button"
                disabled={!canManage || !dirty || busy}
                onClick={() => setConfirming(true)}
              >
                Actualizar suscripción
              </Button>
              {dirty ? (
                <p className="mt-2 text-center text-xs text-[var(--color-text-muted)]">
                  Hay cambios sin guardar.
                </p>
              ) : null}
            </section>
          </div>

          <BillingHistory invoices={details.invoices} />
        </>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="Actualizar suscripción"
        message={confirmationMessage}
        confirmLabel="Guardar cambios"
        cancelLabel="Cancelar"
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
