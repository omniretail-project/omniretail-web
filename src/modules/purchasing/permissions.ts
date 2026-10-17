import type { PermissionDefinition } from "@/shared/types/permissions.types";

export const purchasingPermissions = [
  {
    key: "purchasing.orders.read",
    module: "purchasing",
    name: "Leer ordenes de compra",
    description: "Permite consultar ordenes de compra.",
  },
  {
    key: "purchasing.orders.create",
    module: "purchasing",
    name: "Crear ordenes de compra",
    description: "Permite crear ordenes de compra.",
  },
  {
    key: "purchasing.orders.approve",
    module: "purchasing",
    name: "Aprobar ordenes de compra",
    description: "Permite aprobar ordenes de compra.",
  },
] satisfies PermissionDefinition[];
