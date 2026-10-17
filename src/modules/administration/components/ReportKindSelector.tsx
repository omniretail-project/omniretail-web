import type { ReportKind } from "@/modules/administration/application/dto/ReportDto";
import { Select } from "@/shared/components/Select";

interface ReportKindSelectorProps {
  kind: ReportKind;
  onChange: (kind: ReportKind) => void;
}

export function ReportKindSelector({ kind, onChange }: ReportKindSelectorProps) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="block text-sm font-semibold text-[var(--color-text)]">Tipo de reporte</span>
      <Select onChange={(event) => onChange(event.target.value as ReportKind)} value={kind}>
        <option value="sales">Ventas</option>
        <option value="purchases">Compras</option>
        <option value="movements">Movimientos</option>
        <option value="payments">Pagos</option>
      </Select>
    </label>
  );
}
