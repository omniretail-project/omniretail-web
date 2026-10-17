import type { NavigationItem } from "@/shared/types/navigation.types";

export const receivingNavigation = [
  {
    id: "receiving",
    label: "Recepciones",
    href: "/compras/recepciones",
    permission: "receiving.receipts.confirm",
  },
] satisfies NavigationItem[];
