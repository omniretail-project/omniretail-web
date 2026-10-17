export interface RegularizationProductOption {
  id: string;
  name: string;
  sku: string;
}

/**
 * Destino de la regularizacion: SIEMPRE la ubicacion operativa asignada al producto en la sucursal
 * (configuracion real del backend). Nunca se propone ni se elige otra.
 */
export interface RegularizationLocationOption {
  id: string;
  code: string;
  name: string;
}

export type RegularizationDestination =
  | {
      kind: "assigned";
      locationId: string;
      locationName: string;
      locationCode: string;
      active: boolean;
    }
  /**
   * Sin ubicacion asignada: el usuario elige una de las activas que entrega el backend y la
   * operacion la asigna y consolida en una sola transaccion (modo assignDestination).
   */
  | { kind: "unassigned"; assignableLocations: RegularizationLocationOption[] }
  /** Hay una asignacion, pero la ubicacion no figura entre las de la sucursal. */
  | { kind: "unavailable"; locationId: string }
  /** El control de ubicaciones esta apagado: no hay regularizacion posible. */
  | { kind: "locations_disabled" };

/** Error del backend (o local) con su codigo y mensaje reales, sin reescribir. */
export interface RegularizationErrorInfo {
  code?: string;
  status?: number;
  message: string;
  fields?: Record<string, string>;
  /** true: el mensaje es de la aplicacion (validacion local), no un mensaje crudo del backend. */
  local?: boolean;
}

/**
 * uncertain: la solicitud pudo haber llegado al backend (red, 5xx, 503, respuesta ilegible); no se
 * puede asumir que no se aplico. definitive: el backend (o la validacion local) la rechazo.
 */
export type RegularizationFailureKind = "uncertain" | "definitive";

export interface RegularizationFailure extends RegularizationErrorInfo {
  kind: RegularizationFailureKind;
}

/** Datos de presentacion del intento (viajan con la solicitud congelada y se recuperan con ella). */
export interface RegularizationAttemptSummary {
  productName: string;
  sku: string;
  locationName: string;
}
