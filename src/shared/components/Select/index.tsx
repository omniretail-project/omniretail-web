import type { SelectHTMLAttributes } from "react";
import { cn } from "@/shared/utils/cn";
export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm font-medium text-[var(--color-text)] outline-none transition hover:border-[var(--color-structure)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
