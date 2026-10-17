import { statusesConfig, type StatusTone } from "@/config/statuses";
import { cn } from "@/shared/utils/cn";
const toneClasses: Record<StatusTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  info: "bg-blue-100 text-blue-800",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
};
export interface StatusBadgeProps {
  status: string;
  tone?: StatusTone;
}
export function StatusBadge({ status, tone }: StatusBadgeProps) {
  const definition = statusesConfig[status];
  const resolvedTone = tone ?? definition?.tone ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-2 py-1 text-xs font-semibold",
        toneClasses[resolvedTone],
      )}
    >
      {definition?.label ?? status}
    </span>
  );
}
