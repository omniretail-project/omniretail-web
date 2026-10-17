import { cn } from "@/shared/utils/cn";

export interface TableSkeletonProps {
  columnsCount?: number;
  rowCount?: number;
  label?: string;
  className?: string;
}

export function TableSkeleton({
  columnsCount = 4,
  rowCount = 5,
  label = "Cargando datos",
  className,
}: TableSkeletonProps) {
  const columns = Array.from({ length: columnsCount }, (_, index) => index);
  const rows = Array.from({ length: rowCount }, (_, index) => index);

  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className={cn(
        "overflow-x-auto rounded-md border border-[var(--color-border)] bg-white",
        className,
      )}
    >
      <span className="sr-only">{label}</span>
      <table aria-hidden="true" className="w-full border-collapse text-left text-sm">
        <thead className="bg-[var(--color-app-background)]">
          <tr>
            {columns.map((column) => (
              <th className="px-4 py-3" key={column}>
                <div className="h-4 w-24 animate-pulse rounded bg-[var(--color-border)]" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr className="border-t border-[var(--color-border)]" key={row}>
              {columns.map((column) => (
                <td className="px-4 py-3" key={column}>
                  <div
                    className={cn(
                      "h-4 animate-pulse rounded bg-[var(--color-app-background)]",
                      column === 0 ? "w-3/4" : "w-1/2",
                    )}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
