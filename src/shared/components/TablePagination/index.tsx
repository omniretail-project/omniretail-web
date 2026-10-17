import { Button } from "@/shared/components/Button";
import { Select } from "@/shared/components/Select";

export const TABLE_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
export type TablePageSize = (typeof TABLE_PAGE_SIZE_OPTIONS)[number];

interface TablePaginationProps {
  ariaLabel: string;
  itemLabel: string;
  page: number;
  pageSize: TablePageSize;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: TablePageSize) => void;
}

export function TablePagination({
  ariaLabel,
  itemLabel,
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: TablePaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const firstVisible = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastVisible = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--color-border)] px-4 py-3 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <p className="text-sm text-[var(--color-text-muted)]">
          Mostrando {firstVisible}-{lastVisible} de {totalItems} {itemLabel}
        </p>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          Filas
          <Select
            aria-label="Filas por pagina"
            className="h-9 w-20 rounded-md px-2"
            onChange={(event) => onPageSizeChange(Number(event.target.value) as TablePageSize)}
            value={pageSize}
          >
            {TABLE_PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <nav
        aria-label={ariaLabel}
        className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-start"
      >
        <Button
          aria-label="Pagina anterior"
          className="min-h-9 px-3 py-1.5"
          disabled={currentPage === 1 || totalItems === 0}
          onClick={() => onPageChange(currentPage - 1)}
          type="button"
          variant="secondary"
        >
          {"<"}
        </Button>
        <span className="min-w-12 text-center text-sm font-semibold text-[var(--color-text)]">
          {currentPage} / {totalPages}
        </span>
        <Button
          aria-label="Pagina siguiente"
          className="min-h-9 px-3 py-1.5"
          disabled={currentPage === totalPages || totalItems === 0}
          onClick={() => onPageChange(currentPage + 1)}
          type="button"
          variant="secondary"
        >
          {">"}
        </Button>
      </nav>
    </div>
  );
}
