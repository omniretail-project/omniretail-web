import { statusesConfig } from "@/config/statuses";

const stages = [
  { key: "confirmed", label: "Confirmado", detail: "Pago aprobado", icon: "✓" },
  { key: "preparing", label: "Preparando", detail: "En bodega", icon: "□" },
  { key: "sent", label: "Enviado", detail: "En transporte", icon: "↗" },
] as const;

type ProgressStage = (typeof stages)[number]["key"];

function resolveStage(status: string): ProgressStage | undefined {
  return statusesConfig[status]?.storefrontOrderProgress;
}

export function StorefrontOrderProgress({ status }: { status: string }) {
  const currentStage = resolveStage(status);
  const currentIndex = currentStage ? stages.findIndex((stage) => stage.key === currentStage) : -1;

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-slate-50 p-5 sm:p-7">
      <div className="grid grid-cols-3">
        {stages.map((stage, index) => {
          const completed = currentIndex > index;
          const active = currentIndex === index;
          const reached = currentIndex >= index;
          return (
            <div className="relative flex flex-col items-center text-center" key={stage.key}>
              {index > 0 ? (
                <span
                  className={`absolute right-1/2 top-5 h-1 w-full -translate-y-1/2 ${reached ? "bg-[var(--color-success)]" : "bg-[var(--color-border)]"}`}
                />
              ) : null}
              <span
                className={`relative z-10 grid h-10 w-10 place-items-center rounded-full border-2 text-lg font-black ${completed ? "border-[var(--color-success)] bg-[var(--color-success)] text-white" : active ? "border-[var(--color-primary-hover)] bg-[var(--color-primary)] text-[var(--color-topbar)] ring-4 ring-[var(--color-primary)]/20" : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]"}`}
              >
                {stage.icon}
              </span>
              <p
                className={`mt-3 text-sm font-black ${completed ? "text-[var(--color-success)]" : active ? "text-[var(--color-title)]" : "text-[var(--color-text-muted)]"}`}
              >
                {stage.label}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{stage.detail}</p>
            </div>
          );
        })}
      </div>
      {!currentStage ? (
        <p className="mt-5 text-center text-sm font-semibold text-[var(--color-text-muted)]">
          {statusesConfig[status]?.label ?? status}
        </p>
      ) : null}
    </section>
  );
}
