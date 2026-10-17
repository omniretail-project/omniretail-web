"use client";

import { cn } from "@/shared/utils/cn";

export interface TabItem {
  value: string;
  label: string;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * Tabs generico, controlado, sin logica de negocio. Regla 5.11: tab activa
 * con texto azul + linea inferior; evitar marcos negros de foco permanente
 * (se usa focus-visible, no un outline por defecto).
 */
export function Tabs({ items, value, onChange, className }: TabsProps) {
  return (
    <div
      className={cn("flex gap-6 border-b border-[var(--color-border)]", className)}
      role="tablist"
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            aria-selected={active}
            className={cn(
              "-mb-px border-b-2 px-1 pb-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
              active
                ? "border-[var(--color-primary)] text-[var(--color-title)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
            key={item.value}
            onClick={() => onChange(item.value)}
            role="tab"
            type="button"
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
