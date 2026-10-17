import { cn } from "@/shared/utils/cn";

export interface KPICardProps {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  loading?: boolean;
}

const toneClassNames: Record<NonNullable<KPICardProps["tone"]>, string> = {
  neutral: "border-l-[var(--color-structure)]",
  success: "border-l-[var(--color-success)]",
  warning: "border-l-[var(--color-warning)]",
  danger: "border-l-[var(--color-danger)]",
};

const valueClassNames: Record<NonNullable<KPICardProps["tone"]>, string> = {
  neutral: "text-[var(--color-title)]",
  success: "text-[var(--color-success)]",
  warning: "text-[var(--color-warning)]",
  danger: "text-[var(--color-danger)]",
};

export function KPICard({ hint, label, loading = false, tone = "neutral", value }: KPICardProps) {
  return (
    <article
      aria-busy={loading}
      className={cn(
        "rounded-xl border border-l-4 border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm",
        toneClassNames[tone],
      )}
    >
      <p className="text-sm font-medium text-[var(--color-text-muted)]">{label}</p>
      {loading ? (
        <div aria-label={`Cargando ${label}`} className="mt-3 animate-pulse space-y-2">
          <div className="h-8 w-2/3 rounded bg-[var(--color-app-background)]" />
          {hint ? <div className="h-4 w-1/2 rounded bg-[var(--color-app-background)]" /> : null}
        </div>
      ) : (
        <>
          <p className={cn("mt-2 text-2xl font-bold", valueClassNames[tone])}>{value}</p>
          {hint ? <p className="mt-1 text-sm text-[var(--color-text-muted)]">{hint}</p> : null}
        </>
      )}
    </article>
  );
}
