import type { ReactNode } from "react";
import type { StatusTone } from "@/config/statuses";
import { cn } from "@/shared/utils/cn";

export interface InlineAlertProps {
  tone?: StatusTone;
  title: string;
  description?: string;
  /** Espacio opcional para contenido futuro (p.ej. countdown de bloqueo en PR6/PR7). */
  children?: ReactNode;
  className?: string;
}

const toneClassNames: Record<StatusTone, string> = {
  neutral: "border-[var(--color-border)] bg-white text-[var(--color-text)]",
  info: "border-[var(--color-structure)]/30 bg-[var(--color-structure)]/10 text-[var(--color-title)]",
  success:
    "border-[var(--color-success)]/30 bg-[var(--color-success)]/10 text-[var(--color-success)]",
  warning:
    "border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
  danger: "border-[var(--color-danger)]/30 bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
};

/**
 * Mensaje inline que permanece visible hasta que el padre lo retire —
 * a diferencia de Toast (autodesvanece, flota en esquina). Pensado para
 * errores de formulario a nivel general (credenciales invalidas, cuenta
 * bloqueada), no para reemplazar el error por campo de FormField.
 * Reusa StatusTone (el mismo vocabulario de Toast/StatusBadge) para no
 * introducir una paleta semantica paralela.
 */
export function InlineAlert({
  tone = "danger",
  title,
  description,
  children,
  className,
}: InlineAlertProps) {
  return (
    <div
      className={cn("rounded-md border px-4 py-3 text-sm", toneClassNames[tone], className)}
      role={tone === "danger" ? "alert" : undefined}
    >
      <p className="font-semibold">{title}</p>
      {description ? <p className="mt-1 text-[var(--color-text-muted)]">{description}</p> : null}
      {children ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}
