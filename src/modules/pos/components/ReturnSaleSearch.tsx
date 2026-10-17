import type { FormEvent } from "react";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { SearchInput } from "@/shared/components/SearchInput";

interface ReturnSaleSearchProps {
  value: string;
  loading: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onSearch: () => void;
}

export function ReturnSaleSearch({
  value,
  loading,
  disabled,
  onChange,
  onSearch,
}: ReturnSaleSearchProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch();
  }

  return (
    <section className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm sm:p-5">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4"
        onSubmit={handleSubmit}
      >
        <div className="min-w-0 flex-1">
          <FormField
            id="return-document-number"
            label="Número de documento o factura"
            hint="Busca el documento emitido por el Terminal de Cobro."
          >
            <SearchInput
              autoComplete="off"
              disabled={disabled || loading}
              id="return-document-number"
              placeholder="Ej. POS-002"
              value={value}
              onChange={(event) => onChange(event.target.value)}
            />
          </FormField>
        </div>
        <Button className="w-full sm:w-auto sm:min-w-44" disabled={disabled || loading} type="submit">
          {loading ? "Buscando..." : "Buscar documento"}
        </Button>
      </form>
    </section>
  );
}
