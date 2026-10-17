import type { ReactNode } from "react";

interface BusinessConfigSectionProps {
  children: ReactNode;
  description: string;
  title: string;
}

export function BusinessConfigSection({
  children,
  description,
  title,
}: BusinessConfigSectionProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm">
      <header className="border-b border-[var(--color-border)] px-5 py-4">
        <h2 className="text-lg font-bold text-[var(--color-title)]">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">
          {description}
        </p>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}
