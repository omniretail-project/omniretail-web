/** Codigos del backend para la politica de ubicacion operativa (el Mock los reproduce). */
export const OPERATIONAL_LOCATION_ERROR_MESSAGES = {
  INVENTORY_LOCATION_NOT_ASSIGNED:
    "El producto no tiene una ubicación operativa asignada en esta sucursal. Asígnala antes de operar sus existencias.",
  INVENTORY_LOCATION_REQUIRED:
    "Falta la ubicación operativa del producto. Selecciónala en el campo «Ubicación operativa» de Inventario y trazabilidad.",
  INVENTORY_LOCATION_CHANGE_BLOCKED:
    "Existen registros de inventario (existencias, reservas o movimientos pendientes) que impiden cambiar la ubicación operativa. Se mantiene la ubicación actual.",
  INVENTORY_LOCATION_MISMATCH:
    "La operación no corresponde a la ubicación operativa asignada del producto.",
  INVENTORY_ASSIGNED_LOCATION_INACTIVE:
    "La ubicación operativa asignada está inactiva o no existe. Asigna una ubicación activa.",
  INVENTORY_SETTINGS_LOCATION_NOT_FOUND:
    "La ubicación seleccionada ya no existe. Actualiza la lista de ubicaciones y elige otra.",
  INVENTORY_SETTINGS_PRODUCT_NOT_ELIGIBLE:
    "Este producto no admite ubicación operativa: solo la tienen los productos físicos que controlan stock.",
  INVENTORY_SETTINGS_LOCATION_BRANCH_MISMATCH:
    "La ubicación seleccionada pertenece a otra sucursal. Elige una ubicación de la sucursal actual.",
  INVENTORY_SETTINGS_LOCATION_NOT_ACTIVE:
    "La ubicación seleccionada no está activa. Elige una ubicación activa de la sucursal actual.",
} as const;

export type OperationalLocationErrorCode = keyof typeof OPERATIONAL_LOCATION_ERROR_MESSAGES;

export function isOperationalLocationErrorCode(
  code: unknown,
): code is OperationalLocationErrorCode {
  return (
    typeof code === "string" &&
    Object.prototype.hasOwnProperty.call(OPERATIONAL_LOCATION_ERROR_MESSAGES, code)
  );
}

export class OperationalLocationError extends Error {
  readonly code: OperationalLocationErrorCode;

  constructor(code: OperationalLocationErrorCode, detail?: string) {
    super(detail ?? OPERATIONAL_LOCATION_ERROR_MESSAGES[code]);
    this.name = "OperationalLocationError";
    this.code = code;
  }
}
