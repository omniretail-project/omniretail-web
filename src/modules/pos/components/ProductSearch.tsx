import { SearchInput } from "@/shared/components/SearchInput";

interface ProductSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function ProductSearch({ value, onChange }: ProductSearchProps) {
  return (
    <SearchInput
      aria-label="Buscar productos"
      onChange={(event) => onChange(event.target.value)}
      placeholder="Buscar por nombre, Código / SKU o barcode"
      value={value}
    />
  );
}
