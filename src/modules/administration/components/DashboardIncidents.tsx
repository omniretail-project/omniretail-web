"use client";

import { useState } from "react";

import type {
  DashboardIncidentAnalyticsDto,
  DashboardIncidentDto,
} from "@/modules/administration/application/dto/DashboardDto";
import { formatDate } from "@/shared/utils/formatDate";

interface DashboardIncidentsProps {
  analytics: DashboardIncidentAnalyticsDto;
  incidents: DashboardIncidentDto[];
  loading: boolean;
}

export function DashboardIncidents({
  analytics,
  incidents,
  loading,
}: DashboardIncidentsProps) {
  const [showDetails, setShowDetails] = useState(false);
  const largestTypeCount = Math.max(0, ...analytics.byType.map(({ count }) => count));
  const largestSupplierCount = Math.max(
    0,
    ...analytics.bySupplier.map(({ count }) => count),
  );

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
      <button
        aria-controls="dashboard-receiving-incidents-details"
        aria-expanded={showDetails}
        className="flex w-full flex-col gap-3 p-4 text-left transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)] motion-reduce:transition-none sm:flex-row sm:items-center sm:justify-between"
        disabled={loading}
        onClick={() => setShowDetails((current) => !current)}
        type="button"
      >
        <span>
          <span className="block text-lg font-bold text-[var(--color-title)]">
            Incidencias de recepción
          </span>
          <span className="mt-1 block text-sm text-[var(--color-text-muted)]">
            {showDetails
              ? "Ocultar análisis e incidencias recientes"
              : "Expandir para consultar el análisis y las incidencias recientes"}
          </span>
        </span>
        {loading ? (
          <span className="h-10 w-24 animate-pulse rounded-lg bg-[var(--color-app-background)]" />
        ) : (
          <span className="shrink-0 text-left sm:text-right">
            <span className="block text-2xl font-bold text-[var(--color-title)]">
              {analytics.totalCurrentMonth}
            </span>
            <span className="block text-xs text-[var(--color-text-muted)]">
              este mes
            </span>
          </span>
        )}
      </button>

      {showDetails ? (
        <div
          className="border-t border-[var(--color-border)] p-4"
          id="dashboard-receiving-incidents-details"
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-lg bg-slate-50/70 p-3">
              <h3 className="text-sm font-semibold text-[var(--color-title)]">
                Incidencias por tipo
              </h3>
              {analytics.byType.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {analytics.byType.map((item) => {
                    const width = largestTypeCount > 0
                      ? (item.count / largestTypeCount) * 100
                      : 0;

                    return (
                      <div key={item.typeName}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--color-text)]">{item.typeName}</span>
                          <span className="min-w-8 text-right font-bold tabular-nums text-[var(--color-title)]">
                            {item.count}
                          </span>
                        </div>
                        <div
                          aria-label={`${item.typeName}: ${item.count} incidencias`}
                          className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200/80"
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
                  No hay incidencias registradas por tipo este mes.
                </p>
              )}
            </div>

            <div className="rounded-lg bg-slate-50/70 p-3">
              <h3 className="text-sm font-semibold text-[var(--color-title)]">
                Incidencias por proveedor
              </h3>
              {analytics.bySupplier.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {analytics.bySupplier.map((item) => {
                    const width = largestSupplierCount > 0
                      ? (item.count / largestSupplierCount) * 100
                      : 0;

                    return (
                      <div key={item.supplierName}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-[var(--color-text)]">
                            {item.supplierName}
                          </span>
                          <span className="min-w-8 text-right font-bold tabular-nums text-[var(--color-title)]">
                            {item.count}
                          </span>
                        </div>
                        <div
                          aria-label={`${item.supplierName}: ${item.count} incidencias`}
                          className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200/80"
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
                  No hay incidencias de órdenes de compra asociadas a proveedores este mes.
                </p>
              )}
            </div>
          </div>

          <div className="mt-5 border-t border-[var(--color-border)] pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--color-title)]">
                Incidencias recientes
              </h3>
              <span className="text-xs tabular-nums text-[var(--color-text-muted)]">
                Últimas {incidents.length} del mes
              </span>
            </div>
            {incidents.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-[var(--color-border)] bg-slate-50 px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">
                No hay incidencias de recepción recientes este mes.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--color-border)]">
                {incidents.map((incident, index) => (
                  <li
                    className="py-3 first:pt-0 last:pb-0"
                    key={`${incident.createdAt}-${incident.description}-${index}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="w-fit rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-[var(--color-text-muted)]">
                        {incident.typeName ?? "—"}
                      </p>
                      <time
                        className="text-xs text-[var(--color-text-muted)]"
                        dateTime={incident.createdAt}
                      >
                        {formatDate(incident.createdAt)}
                      </time>
                    </div>
                    <p className="mt-2 break-words text-sm font-semibold text-[var(--color-text)]">
                      {incident.description}
                    </p>
                    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                      {incident.purchaseOrderNumber ? (
                        <div className="flex gap-1">
                          <dt>Orden de compra:</dt>
                          <dd className="font-medium text-[var(--color-text)]">
                            {incident.purchaseOrderNumber}
                          </dd>
                        </div>
                      ) : null}
                      {incident.transferNumber ? (
                        <div className="flex gap-1">
                          <dt>Transferencia:</dt>
                          <dd className="font-medium text-[var(--color-text)]">
                            {incident.transferNumber}
                          </dd>
                        </div>
                      ) : null}
                      {incident.receiptNumber ? (
                        <div className="flex gap-1">
                          <dt>Recepción:</dt>
                          <dd className="font-medium text-[var(--color-text)]">
                            {incident.receiptNumber}
                          </dd>
                        </div>
                      ) : null}
                      {incident.supplierName ? (
                        <div className="flex gap-1">
                          <dt>Proveedor:</dt>
                          <dd className="font-medium text-[var(--color-text)]">
                            {incident.supplierName}
                          </dd>
                        </div>
                      ) : null}
                      {incident.originBranchName ? (
                        <div className="flex gap-1">
                          <dt>Origen:</dt>
                          <dd className="font-medium text-[var(--color-text)]">
                            {incident.originBranchName}
                          </dd>
                        </div>
                      ) : null}
                      {incident.branchName ? (
                        <div className="flex gap-1">
                          <dt>Sucursal:</dt>
                          <dd className="font-medium text-[var(--color-text)]">
                            {incident.branchName}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
