import type { PermissionDefinition } from "@/shared/types/permissions.types";

export const customerPermissions = [
  {
    key: "customer.account.read",
    module: "customer",
    name: "Leer cuenta de cliente",
    description: "Permite consultar cuenta de cliente.",
  },
  {
    key: "customer.account.update",
    module: "customer",
    name: "Actualizar cuenta de cliente",
    description: "Permite actualizar cuenta de cliente.",
  },
  {
    key: "customer.address.manage",
    module: "customer",
    name: "Gestionar direcciones",
    description: "Permite administrar direcciones.",
  },
  {
    key: "customer.payment_method.manage",
    module: "customer",
    name: "Gestionar medios de pago",
    description: "Permite administrar medios de pago.",
  },
] satisfies PermissionDefinition[];
