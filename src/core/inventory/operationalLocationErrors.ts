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
