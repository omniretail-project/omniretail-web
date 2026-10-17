import type { PermissionDefinition } from "@/shared/types/permissions.types";

export const logisticsPermissions = [
  {
    key: "logistics.history.read",
    module: "logistics",
    name: "Leer historial logístico",
    description: "Permite consultar el historial operativo de pedidos de una sucursal.",
  },
  {
    key: "logistics.picking.read",
    module: "logistics",
    name: "Leer picking",
    description: "Permite consultar picking.",
  },
  {
    key: "logistics.picking.start",
    module: "logistics",
    name: "Iniciar picking",
    description: "Permite iniciar picking.",
  },
  {
    key: "logistics.picking.complete",
    module: "logistics",
    name: "Completar picking",
    description: "Permite completar picking.",
  },
  {
    key: "logistics.packing.read",
    module: "logistics",
    name: "Leer packing",
    description: "Permite consultar preparaciones de empaque.",
  },
  {
    key: "logistics.packing.prepare",
    module: "logistics",
    name: "Preparar packing",
    description: "Permite guardar checklist, bultos y etiqueta de packing.",
  },
  {
    key: "logistics.packing.finalize",
    module: "logistics",
    name: "Finalizar packing",
    description: "Permite finalizar la preparación de un pedido.",
  },
  {
    key: "logistics.dispatch.read",
    module: "logistics",
    name: "Leer despachos",
    description: "Permite consultar despachos.",
  },
  {
    key: "logistics.dispatch.confirm",
    module: "logistics",
    name: "Confirmar despachos",
    description: "Permite confirmar despachos.",
  },
] satisfies PermissionDefinition[];
