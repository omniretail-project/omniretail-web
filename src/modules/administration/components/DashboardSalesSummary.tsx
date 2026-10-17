import type {
  DashboardDailySaleDto,
  DashboardSalesByBranchDto,
} from "@/modules/administration/application/dto/DashboardDto";
import { formatCurrency } from "@/shared/utils/formatCurrency";

interface SalesTotal {
  amount: number;
  count: number;
}

interface DashboardSalesSummaryProps {
  dailySalesMonth: DashboardDailySaleDto[];
  loading: boolean;
  salesByBranch: DashboardSalesByBranchDto[];
  salesToday: SalesTotal;
  salesMonth: SalesTotal;
}

export function DashboardSalesSummary({
  dailySalesMonth,
  loading,
  salesByBranch,
  salesToday,
  salesMonth,
}: DashboardSalesSummaryProps) {
  const salesDays = dailySalesMonth.filter(({ amount, count }) => amount > 0 || count > 0);
  const bestSalesDay = salesDays.reduce<DashboardDailySaleDto | null>(
    (best, day) => (!best || day.amount > best.amount ? day : best),
    null,
  );
  const averagePerSalesDay = salesDays.length > 0
    ? salesMonth.amount / salesDays.length
    : 0;
  const largestBranchAmount = Math.max(0, ...salesByBranch.map(({ amount }) => amount));
  const largestDailyAmount = Math.max(0, ...salesDays.map(({ amount }) => amount));
  const hasBranchSales = salesByBranch.some(({ amount, count }) => amount > 0 || count > 0);

  return (
    <section className="min-w-0 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
      <div>
        <h2 className="text-lg font-bold text-[var(--color-title)]">Resumen de ventas</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Actividad comercial del mes actual en todas las sucursales.
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <article className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Hoy
          </p>
          {loading ? (
            <div className="mt-2 h-12 animate-pulse rounded-md bg-[var(--color-app-background)]" />
          ) : (
            <>
              <p className="mt-2 text-xl font-bold text-[var(--color-success)]">
                {formatCurrency(salesToday.amount)}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {salesToday.count} {salesToday.count === 1 ? "venta" : "ventas"}
              </p>
            </>
          )}
        </article>
        <article className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Este mes
          </p>
          {loading ? (
            <div className="mt-2 h-12 animate-pulse rounded-md bg-[var(--color-app-background)]" />
          ) : (
            <>
              <p className="mt-2 text-xl font-bold text-[var(--color-success)]">
                {formatCurrency(salesMonth.amount)}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {salesMonth.count} {salesMonth.count === 1 ? "venta" : "ventas"}
              </p>
            </>
          )}
        </article>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <article className="rounded-lg bg-blue-50/70 px-3 py-2.5">
          <p className="text-xs font-medium text-[var(--color-text-muted)]">
            Días con ventas
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-blue-700">
            {loading ? "—" : salesDays.length}
          </p>
        </article>
        <article className="rounded-lg bg-blue-50/70 px-3 py-2.5">
          <p className="text-xs font-medium text-[var(--color-text-muted)]">
            Mejor día del mes
          </p>
          {loading ? (
            <p className="mt-1 text-lg font-bold text-blue-700">—</p>
          ) : bestSalesDay ? (
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
              <p className="text-lg font-bold tabular-nums text-blue-700">
                Día {Number(bestSalesDay.date.slice(-2))}
              </p>
              <p className="text-xs font-semibold tabular-nums text-[var(--color-text-muted)]">
                {formatCurrency(bestSalesDay.amount)}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-sm font-semibold text-[var(--color-text-muted)]">
              Sin ventas
            </p>
          )}
        </article>
        <article className="rounded-lg bg-emerald-50/70 px-3 py-2.5">
          <p className="text-xs font-medium text-[var(--color-text-muted)]">
            Promedio por día con ventas
          </p>
          <p className="mt-1 text-lg font-bold tabular-nums text-[var(--color-success)]">
            {loading ? "—" : formatCurrency(averagePerSalesDay)}
          </p>
        </article>
      </div>

      <div className="mt-5 border-t border-[var(--color-border)] pt-4">
        <h3 className="text-sm font-semibold text-[var(--color-title)]">Ventas por sucursal</h3>
        {loading ? (
          <div className="mt-3 space-y-3">
            {[0, 1, 2].map((item) => (
              <div
                className="h-12 animate-pulse rounded-lg bg-[var(--color-app-background)]"
                key={item}
              />
            ))}
          </div>
        ) : hasBranchSales ? (
          <div className="mt-3 space-y-3">
            {salesByBranch.map((branch) => {
              const width = largestBranchAmount > 0
                ? (branch.amount / largestBranchAmount) * 100
                : 0;

              return (
                <div key={branch.branchName}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                    <span className="font-medium text-[var(--color-text)]">
                      {branch.branchName}
                    </span>
                    <span className="text-right text-xs tabular-nums text-[var(--color-text-muted)]">
                      <strong className="font-semibold text-[var(--color-title)]">
                        {formatCurrency(branch.amount)}
                      </strong>{" "}
                      · {branch.count} {branch.count === 1 ? "venta" : "ventas"}
                    </span>
                  </div>
                  <div
                    aria-label={`${branch.branchName}: ${formatCurrency(branch.amount)}, ${branch.count} ventas`}
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
            No se registraron ventas por sucursal durante este mes.
          </p>
        )}
      </div>

      <div className="mt-5 border-t border-[var(--color-border)] pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--color-title)]">Ventas diarias</h3>
          <p className="text-xs text-[var(--color-text-muted)]">Mes actual hasta hoy</p>
        </div>
        {loading ? (
          <div className="mt-3 h-52 animate-pulse rounded-lg bg-[var(--color-app-background)]" />
        ) : salesDays.length === 0 ? (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-4 text-sm text-[var(--color-text-muted)]">
            No se registraron ventas durante este mes.
          </p>
        ) : (
          <>
            <div className="mt-3 min-w-0 pb-1 pt-2">
              <div
                className="relative"
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-5 top-0 flex flex-col justify-between"
                >
                  {[0, 1, 2, 3].map((line) => (
                    <span className="border-t border-slate-200/80" key={line} />
                  ))}
                </div>
                <div
                  className="relative grid h-52 items-end gap-1"
                  style={{
                    gridTemplateColumns: `repeat(${salesDays.length}, minmax(0, 1fr))`,
                  }}
                >
                  {salesDays.map((day, index) => {
                    const dayNumber = Number(day.date.slice(-2));
                    const height = largestDailyAmount > 0
                      ? (day.amount / largestDailyAmount) * 100
                      : 0;
                    const labelStep = salesDays.length > 12
                      ? Math.ceil(salesDays.length / 8)
                      : 1;
                    const showLabel =
                      index === 0 ||
                      index % labelStep === 0 ||
                      index === salesDays.length - 1;
                    const description = `Día ${dayNumber}: ${formatCurrency(day.amount)}, ${day.count} ${day.count === 1 ? "venta" : "ventas"}`;

                    return (
                      <div
                        aria-label={description}
                        className="group relative flex h-full min-w-0 flex-col justify-end rounded-md focus-visible:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
                        key={day.date}
                        role="img"
                        tabIndex={0}
                        title={description}
                      >
                        <span className="pointer-events-none absolute bottom-7 left-1/2 z-10 hidden w-max max-w-40 -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-center text-[10px] font-medium leading-4 text-white shadow-md group-hover:block group-focus-visible:block">
                          Día {dayNumber} · {formatCurrency(day.amount)} · {day.count}{" "}
                          {day.count === 1 ? "venta" : "ventas"}
                        </span>
                        <div className="flex min-h-0 flex-1 items-end px-px sm:px-0.5">
                          <div
                            className={`w-full rounded-t-md ${day.amount > 0 ? "bg-blue-600 group-hover:bg-blue-700 group-focus-visible:bg-blue-700" : "h-px bg-slate-300"}`}
                            style={day.amount > 0 ? { height: `${Math.max(height, 2)}%` } : undefined}
                          />
                        </div>
                        <span className="mt-1 h-4 text-center text-[10px] font-medium leading-4 text-[var(--color-text-muted)]">
                          {showLabel ? dayNumber : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Cada barra representa un día con ventas. Consulte una barra para ver su fecha,
              monto y cantidad de ventas.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
