import type { InputHTMLAttributes } from "react";
import { cn } from "@/shared/utils/cn";
export type InputProps = InputHTMLAttributes<HTMLInputElement>;
export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}
