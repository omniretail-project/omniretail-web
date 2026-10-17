import type { PermissionDefinition } from "@/shared/types/permissions.types";

export const posPermissions = [
  {
    key: "pos.sales.create",
    module: "pos",
    name: "Crear ventas",
    description: "Permite registrar ventas.",
  },
  {
    key: "pos.sales.read",
    module: "pos",
    name: "Leer ventas",
    description: "Permite consultar ventas.",
  },
  {
    key: "pos.cash.open",
    module: "pos",
    name: "Abrir caja",
    description: "Permite abrir turno de caja.",
  },
  {
    key: "pos.cash.close",
    module: "pos",
    name: "Cerrar caja",
    description: "Permite cerrar turno de caja.",
  },
  {
    key: "pos.cash.read",
    module: "pos",
    name: "Consultar caja",
    description: "Permite consultar el turno y sus movimientos de caja.",
  },
  {
    key: "pos.cash.movement.create",
    module: "pos",
    name: "Registrar movimientos de caja",
    description: "Permite registrar ingresos y egresos manuales.",
  },
  {
    key: "pos.returns.read",
    module: "pos",
    name: "Consultar ventas para devoluciones",
    description: "Permite buscar ventas y consultar su elegibilidad para devolucion o anulacion.",
  },
  {
    key: "pos.returns.create",
    module: "pos",
    name: "Crear devoluciones",
    description: "Permite registrar devoluciones.",
  },
  {
    key: "pos.sales.void",
    module: "pos",
    name: "Anular ventas",
    description: "Permite procesar la anulacion total de una venta elegible.",
  },
] satisfies PermissionDefinition[];
