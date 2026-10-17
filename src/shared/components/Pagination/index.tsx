import { Button } from "@/shared/components/Button";
export interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}
export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  return (
    <nav aria-label="Paginacion" className="flex items-center justify-between gap-3">
      <Button disabled={page <= 1} onClick={() => onPageChange(page - 1)} type="button">
        Anterior
      </Button>
      <span className="text-sm text-[var(--color-text-muted)]">
        Pagina {page} de {totalPages}
      </span>
      <Button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} type="button">
        Siguiente
      </Button>
    </nav>
  );
}
