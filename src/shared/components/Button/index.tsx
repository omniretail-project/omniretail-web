import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/shared/utils/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  href?: string;
  rel?: string;
  target?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

const baseClassName =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-5 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)] disabled:cursor-not-allowed disabled:opacity-60";

const variantClassNames: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "border-[var(--color-primary)] bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)]",
  secondary:
    "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-title)] hover:bg-[var(--color-app-background)]",
  danger: "border-[var(--color-danger)] bg-[var(--color-danger)] text-white hover:brightness-95",
  ghost:
    "border-transparent bg-transparent text-[var(--color-title)] hover:bg-[var(--color-app-background)]",
};

export function Button({
  children,
  href,
  rel,
  target,
  className,
  variant = "primary",
  ...props
}: ButtonProps) {
  const classes = cn(baseClassName, variantClassNames[variant], className);

  if (href) {
    return (
      <Link className={classes} href={href} rel={rel} target={target}>
        {children}
      </Link>
    );
  }

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}
