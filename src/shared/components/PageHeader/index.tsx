import type { ReactNode } from "react";
export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex min-w-0 flex-col gap-3 border-b border-[var(--color-border)] pb-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-bold text-[var(--color-title)]">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2 md:justify-end">{actions}</div> : null}
    </header>
  );
}
