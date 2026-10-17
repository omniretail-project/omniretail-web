import type { PermissionDefinition } from "@/shared/types/permissions.types";

export const storefrontPermissions = [
  {
    key: "storefront.orders.read",
    module: "storefront",
    name: "Leer pedidos storefront",
    description: "Permite consultar pedidos de e-commerce.",
  },
] satisfies PermissionDefinition[];
