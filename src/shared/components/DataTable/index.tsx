import type { ReactNode } from "react";
import { cn } from "@/shared/utils/cn";
export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
}
export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
  headerClassName?: string;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
}
export function DataTable<T>({
  columns,
  data,
  rowKey,
  emptyMessage = "Sin registros",
  headerClassName,
  onRowClick,
  onRowDoubleClick,
}: DataTableProps<T>) {
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-white">
      <table className="w-full border-collapse text-left text-sm">
        <thead className={cn("bg-[var(--color-app-background)] text-[var(--color-title)]", headerClassName)}>
          <tr>
            {columns.map((column) => (
              <th className={cn("px-4 py-3 font-semibold", column.className)} key={column.key}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td
                className="px-4 py-8 text-center text-[var(--color-text-muted)]"
                colSpan={columns.length}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row) => (
              <tr
                className={cn(
                  "border-t border-[var(--color-border)]",
                  onRowClick && "cursor-pointer hover:bg-[var(--color-app-background)]/70",
                )}
                key={rowKey(row)}
                onClick={() => onRowClick?.(row)}
                onDoubleClick={() => onRowDoubleClick?.(row)}
              >
                {columns.map((column) => (
                  <td className={cn("px-4 py-3", column.className)} key={column.key}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
