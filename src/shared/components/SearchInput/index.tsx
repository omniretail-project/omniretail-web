import { Input, type InputProps } from "@/shared/components/Input";
export function SearchInput(props: InputProps) {
  return <Input type="search" placeholder={props.placeholder ?? "Buscar"} {...props} />;
}
