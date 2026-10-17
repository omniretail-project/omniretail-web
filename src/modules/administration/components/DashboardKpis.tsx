"use client";

import Link from "next/link";
import { useState } from "react";

import type { DashboardSummaryDto } from "@/modules/administration/application/dto/DashboardDto";
import { KPICard } from "@/shared/components/KPICard";
import { formatCurrency } from "@/shared/utils/formatCurrency";

interface DashboardKpisProps {
  loading: boolean;
  summary: DashboardSummaryDto | null;
}

const pendingOrderStatuses: Array<
  [keyof DashboardSummaryDto["pendingOrdersByStatus"], string]
> = [
  ["confirmed", "Confirmados"],
  ["preparing", "En preparación"],
  ["picking", "En picking"],
  ["packing", "En empaque"],
  ["ready_for_dispatch", "Listos para despacho"],
];

export function DashboardKpis({ loading, summary }: DashboardKpisProps) {
  const [showStockDetails, setShowStockDetails] = useState(false);
  const [showPendingDetails, setShowPendingDetails] = useState(false);
  const stockAlerts = summary ? summary.stockAlerts.outOfStock + summary.stockAlerts.lowStock : 0;
  const stockTone = summary?.stockAlerts.outOfStock
    ? "danger"
    : summary?.stockAlerts.lowStock
      ? "warning"
      : "neutral";
  const pendingBreakdown = pendingOrderStatuses
    .map(([status, label]) => ({
      count: summary?.pendingOrdersByStatus[status] ?? 0,
      label,
    }))
    .filter(({ count }) => count > 0);
  const branchStockAlerts = (summary?.stockAlertsByBranch ?? []).filter(
    ({ total }) => total > 0,
  );
  const largestBranchStockTotal = Math.max(
    0,
    ...branchStockAlerts.map(({ total }) => total),
  );
  const outOfStockCount = summary?.stockAlerts.outOfStock ?? 0;
  const lowStockCount = summary?.stockAlerts.lowStock ?? 0;
  const outOfStockPercentage = stockAlerts > 0
    ? (outOfStockCount / stockAlerts) * 100
    : 0;
  const pendingBranchBreakdown = (summary?.pendingOrdersByBranch ?? []).filter(
    ({ count }) => count > 0,
  );
  const largestPendingStatusCount = Math.max(
    0,
    ...pendingBreakdown.map(({ count }) => count),
  );
  const largestPendingBranchCount = Math.max(
    0,
    ...pendingBranchBreakdown.map(({ count }) => count),
  );

  return (
    <div className="space-y-3">
      <section
        aria-label="Indicadores ejecutivos"
        className="grid items-stretch gap-3 sm:grid-cols-2 xl:grid-cols-4 [&>article]:h-full"
      >
      <KPICard
        hint={`${summary?.salesToday.count ?? 0} ${(summary?.salesToday.count ?? 0) === 1 ? "venta" : "ventas"}`}
          label="Ventas hoy"
          loading={loading}
          tone="success"
          value={formatCurrency(summary?.salesToday.amount ?? 0)}
        />
      <KPICard
        hint={`${summary?.salesMonth.count ?? 0} ${(summary?.salesMonth.count ?? 0) === 1 ? "venta" : "ventas"}`}
          label="Ventas del mes"
          loading={loading}
          tone="success"
          value={formatCurrency(summary?.salesMonth.amount ?? 0)}
        />
        <button
          aria-controls="dashboard-stock-alert-details"
          aria-expanded={showStockDetails}
          className={`h-full rounded-xl border border-l-4 border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)] motion-reduce:transform-none motion-reduce:transition-none ${
            stockTone === "danger"
              ? "border-l-[var(--color-danger)]"
              : stockTone === "warning"
                ? "border-l-[var(--color-warning)]"
                : "border-l-[var(--color-structure)]"
          }`}
          disabled={loading}
          onClick={() => {
            setShowStockDetails((current) => !current);
            setShowPendingDetails(false);
          }}
          type="button"
        >
          <p className="text-sm font-medium text-[var(--color-text-muted)]">
            Alertas de stock
          </p>
          {loading ? (
            <div className="mt-3 h-12 animate-pulse rounded-lg bg-[var(--color-app-background)]" />
          ) : (
            <>
              <p
                className={`mt-2 text-2xl font-bold ${
                  stockTone === "danger"
                    ? "text-[var(--color-danger)]"
                    : stockTone === "warning"
                      ? "text-[var(--color-warning)]"
                      : "text-[var(--color-title)]"
                }`}
              >
                {stockAlerts}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {summary?.stockAlerts.outOfStock ?? 0} sin stock ·{" "}
                {summary?.stockAlerts.lowStock ?? 0} bajo
              </p>
            </>
          )}
        </button>
        <button
          aria-controls="dashboard-pending-order-details"
          aria-expanded={showPendingDetails}
          aria-busy={loading}
          className={`h-full rounded-xl border border-l-4 border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)] motion-reduce:transform-none motion-reduce:transition-none ${
            summary?.pendingOrders
              ? "border-l-[var(--color-warning)]"
              : "border-l-[var(--color-structure)]"
          }`}
          disabled={loading}
          onClick={() => {
            setShowPendingDetails((current) => !current);
            setShowStockDetails(false);
          }}
          type="button"
        >
          <p className="text-sm font-medium text-[var(--color-text-muted)]">
            Pedidos pendientes
          </p>
          {loading ? (
            <div className="mt-3 h-12 animate-pulse rounded-lg bg-[var(--color-app-background)]" />
          ) : (
            <>
              <p
                className={`mt-2 text-2xl font-bold ${
                  summary?.pendingOrders
                    ? "text-[var(--color-warning)]"
                    : "text-[var(--color-title)]"
                }`}
              >
                {summary?.pendingOrders ?? 0}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                Pedidos que esperan atención logística
              </p>
            </>
          )}
        </button>
      </section>

      {showStockDetails ? (
        <section
          aria-labelledby="dashboard-stock-alert-details-title"
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm"
          id="dashboard-stock-alert-details"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2
                className="text-base font-bold text-[var(--color-title)]"
                id="dashboard-stock-alert-details-title"
              >
                Alertas de stock
              </h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                {stockAlerts} productos/registros requieren atención
              </p>
            </div>
            <Link
              className="w-fit rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text)] transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)] motion-reduce:transition-none"
              href="/inventario/alertas"
            >
              Ver inventario y alertas
            </Link>
          </div>

          {stockAlerts === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-[var(--color-border)] bg-slate-50 px-4 py-5 text-sm text-[var(--color-text-muted)]">
              No hay alertas de stock activas.
            </p>
          ) : (
            <div className="mt-4 grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
              <div className="flex items-center gap-4 rounded-lg bg-slate-50 p-4 lg:flex-col lg:justify-center">
                <div
                  aria-label={`${stockAlerts} alertas: ${outOfStockCount} sin stock y ${lowStockCount} con stock bajo`}
                  className="relative grid h-28 w-28 shrink-0 place-items-center rounded-full"
                  role="img"
                  style={{
                    background:
                      stockAlerts > 0
                        ? `conic-gradient(var(--color-danger) 0 ${outOfStockPercentage}%, var(--color-warning) ${outOfStockPercentage}% 100%)`
                        : "var(--color-app-background)",
                  }}
                >
                  <div className="grid h-20 w-20 place-items-center rounded-full bg-[var(--color-surface)] text-center shadow-sm">
                    <span>
                      <strong className="block text-2xl font-bold tabular-nums text-[var(--color-title)]">
                        {stockAlerts}
                      </strong>
                      <span className="block text-[10px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                        alertas
                      </span>
                    </span>
                  </div>
                </div>
                <dl className="min-w-0 flex-1 space-y-2 text-sm lg:w-full">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 text-[var(--color-text-muted)]">
                      <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-danger)]" />
                      Sin stock
                    </dt>
                    <dd className="font-bold tabular-nums text-[var(--color-danger)]">
                      {outOfStockCount}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="flex items-center gap-2 text-[var(--color-text-muted)]">
                      <span className="h-2.5 w-2.5 rounded-full bg-[var(--color-warning)]" />
                      Stock bajo
                    </dt>
                    <dd className="font-bold tabular-nums text-[var(--color-warning)]">
                      {lowStockCount}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="space-y-4">
                {branchStockAlerts.map((branch) => {
                  const totalWidth = largestBranchStockTotal > 0
                    ? (branch.total / largestBranchStockTotal) * 100
                    : 0;
                  const outOfStockWidth = branch.total > 0
                    ? (branch.outOfStock / branch.total) * 100
                    : 0;
                  const lowStockWidth = branch.total > 0
                    ? (branch.lowStock / branch.total) * 100
                    : 0;

                  return (
                    <div key={branch.branchId}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <h3 className="text-sm font-semibold text-[var(--color-title)]">
                          {branch.branchName}
                        </h3>
                        <span className="text-xs font-semibold tabular-nums text-[var(--color-text-muted)]">
                          {branch.total} alertas
                        </span>
                      </div>
                      <div
                        aria-label={`${branch.branchName}: ${branch.outOfStock} sin stock y ${branch.lowStock} con stock bajo`}
                        className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"
                        role="img"
                      >
                        <div className="flex h-full overflow-hidden rounded-full" style={{ width: `${totalWidth}%` }}>
                          <div
                            className="h-full bg-[var(--color-danger)]"
                            style={{ width: `${outOfStockWidth}%` }}
                          />
                          <div
                            className="h-full bg-[var(--color-warning)]"
                            style={{ width: `${lowStockWidth}%` }}
                          />
                        </div>
                      </div>
                      <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <div className="flex gap-1.5">
                          <dt className="text-[var(--color-text-muted)]">Sin stock</dt>
                          <dd className="font-semibold tabular-nums text-[var(--color-danger)]">
                            {branch.outOfStock}
                          </dd>
                        </div>
                        <div className="flex gap-1.5">
                          <dt className="text-[var(--color-text-muted)]">Stock bajo</dt>
                          <dd className="font-semibold tabular-nums text-[var(--color-warning)]">
                            {branch.lowStock}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      ) : null}

      {showPendingDetails ? (
        <section
          aria-labelledby="dashboard-pending-order-details-title"
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm"
          id="dashboard-pending-order-details"
        >
          <div>
            <h2
              className="text-base font-bold text-[var(--color-title)]"
              id="dashboard-pending-order-details-title"
            >
              Pedidos pendientes
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {summary?.pendingOrders ?? 0} pedidos requieren atención logística
            </p>
          </div>

          {(summary?.pendingOrders ?? 0) === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-[var(--color-border)] bg-slate-50 px-4 py-5 text-sm text-[var(--color-text-muted)]">
              No hay pedidos pendientes de atención logística.
            </p>
          ) : (
            <div className="mt-4 grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-title)]">
                  Pedidos por estado
                </h3>
                <div className="mt-3 space-y-3">
                  {pendingBreakdown.map(({ count, label }) => {
                    const width = largestPendingStatusCount > 0
                      ? (count / largestPendingStatusCount) * 100
                      : 0;

                    return (
                      <div key={label}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--color-text)]">{label}</span>
                          <span className="min-w-8 text-right font-bold tabular-nums text-[var(--color-title)]">{count}</span>
                        </div>
                        <div
                          aria-label={`${label}: ${count} pedidos`}
                          className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"
                          role="img"
                        >
                          <div
                            className="h-full rounded-full bg-amber-500"
                            style={{ width: `${width}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-[var(--color-title)]">
                  Pedidos por sucursal
                </h3>
                {pendingBranchBreakdown.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {pendingBranchBreakdown.map((branch) => {
                      const width = largestPendingBranchCount > 0
                        ? (branch.count / largestPendingBranchCount) * 100
                        : 0;

                      return (
                        <div key={branch.branchName}>
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-[var(--color-text)]">
                              {branch.branchName}
                            </span>
                            <span className="min-w-8 text-right font-bold tabular-nums text-[var(--color-title)]">
                              {branch.count}
                            </span>
                          </div>
                          <div
                            aria-label={`${branch.branchName}: ${branch.count} pedidos`}
                            className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100"
                            role="img"
                          >
                            <div
                              className="h-full rounded-full bg-blue-600"
                              style={{ width: `${width}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-3 rounded-lg bg-slate-50 px-3 py-4 text-sm text-[var(--color-text-muted)]">
                    No hay pedidos pendientes asociados a sucursales disponibles.
                  </p>
                )}
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
