import type { KeyboardEvent } from "react";
import type { PosSaleHistoryRowDto } from "@/modules/pos/application/dto/PosSaleHistoryDto";
import { StatusBadge } from "@/shared/components/StatusBadge";
import { cn } from "@/shared/utils/cn";
import { formatCurrency } from "@/shared/utils/formatCurrency";
import { formatDate } from "@/shared/utils/formatDate";

interface PosSalesHistoryTableProps {
  sales: PosSaleHistoryRowDto[];
  selectedSaleId?: string;
  onOpenProducts: (sale: PosSaleHistoryRowDto) => void;
  onSelect: (saleId: string) => void;
}

export function PosSalesHistoryTable({
  sales,
  selectedSaleId,
  onOpenProducts,
  onSelect,
}: PosSalesHistoryTableProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>, sale: PosSaleHistoryRowDto) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onSelect(sale.saleId);
  }

  return (
    <div className="max-h-[52dvh] max-w-full overflow-auto rounded-xl border border-[var(--color-border)] bg-white shadow-sm">
      <table className="w-full min-w-[760px] table-fixed border-collapse text-left text-xs">
        <colgroup>
          <col className="w-[14%]" />
          <col className="w-[13%]" />
          <col className="w-[17%]" />
          <col className="w-[17%]" />
          <col className="w-[10%]" />
          <col className="w-[13%]" />
          <col className="w-[16%]" />
        </colgroup>
        <thead className="sticky top-0 z-10 bg-[var(--color-structure)] text-white">
          <tr>
            {[
              "Documento",
              "Fecha",
              "Cliente",
              "Entrega",
              "Total",
              "Estado de venta",
              "Estado operativo",
            ].map((header) => (
              <th
                className="break-words px-3 py-2.5 font-semibold leading-tight text-white"
                key={header}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sales.length === 0 ? (
            <tr>
              <td className="px-4 py-10 text-center text-[var(--color-text-muted)]" colSpan={7}>
                No hay ventas para los filtros actuales.
              </td>
            </tr>
          ) : (
            sales.map((sale) => {
              const selected = sale.saleId === selectedSaleId;
              return (
                <tr
                  aria-selected={selected}
                  className={cn(
                    "cursor-pointer border-t border-[var(--color-border)] outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary)]",
                    selected && "bg-[var(--color-primary)]/10 shadow-[inset_3px_0_0_var(--color-primary)]",
                  )}
                  key={sale.saleId}
                  tabIndex={0}
                  onClick={() => onSelect(sale.saleId)}
                  onDoubleClick={() => onOpenProducts(sale)}
                  onKeyDown={(event) => handleKeyDown(event, sale)}
                >
                  <td className="break-words px-3 py-3 font-semibold text-[var(--color-title)]">
                    {sale.documentNumber}
                  </td>
                  <td className="break-words px-3 py-3 leading-tight">
                    {formatDate(sale.createdAt)}
                  </td>
                  <td className="break-words px-3 py-3 leading-tight">
                    {sale.customerDisplayName}
                  </td>
                  <td className="break-words px-3 py-3 leading-tight">
                    {sale.deliveryMethodLabel}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold">
                    {formatCurrency(sale.total)}
                  </td>
                  <td className="break-words px-3 py-3 leading-tight [&>span]:whitespace-normal [&>span]:text-center [&>span]:leading-tight">
                    <StatusBadge status={sale.saleStatusLabel} tone={sale.saleStatusTone} />
                  </td>
                  <td className="break-words px-3 py-3 leading-tight [&>span]:whitespace-normal [&>span]:text-center [&>span]:leading-tight">
                    {sale.sourceOrderId ? (
                      <StatusBadge
                        status={sale.operationalStatusLabel}
                        tone={sale.operationalStatusTone}
                      />
                    ) : (
                      <span aria-label="No aplica" className="text-[var(--color-text-muted)]">
                        —
                      </span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
