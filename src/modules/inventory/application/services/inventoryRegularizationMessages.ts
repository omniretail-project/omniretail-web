/**
 * Mensajes para el usuario de la pantalla de regularizacion de ubicaciones.
 *
 * Solo aplica a esta pantalla: no sustituye ni altera el manejo de errores de otros modulos. Los
 * codigos del backend se conservan en `diagnosticCode` (diagnostico y soporte) pero el texto
 * principal es siempre un mensaje claro en espanol. Los mensajes crudos del backend no se muestran.
 */
export interface RegularizationUserMessage {
  /** Texto principal para el usuario. */
  title: string;
  /** Orientacion breve sobre que hacer a continuacion. */
  hint?: string;
  /** Codigo tecnico original (se muestra solo como detalle secundario). */
  diagnosticCode?: string;
}

interface KnownMessage {
  title: string;
  hint?: string;
}

const PREFIX = "INVENTORY_REGULARIZATION_";

const KNOWN_MESSAGES: Record<string, KnownMessage> = {
  [`${PREFIX}STALE_SNAPSHOT`]: {
    title: "El inventario cambió desde la última consulta. Actualiza la información antes de continuar.",
    hint: "Usa «Actualizar vista previa» y revisa las cantidades.",
  },
  [`${PREFIX}RESERVATION_DRIFT`]: {
    title:
      "Las unidades reservadas no coinciden con el inventario registrado. No se realizó ningún cambio.",
  },
  [`${PREFIX}PICKING_CONFLICT`]: {
    title:
      "Este producto tiene pedidos en preparación que impiden realizar la regularización.",
    hint: "Termina o cancela esos pedidos en Logística y vuelve a consultar.",
  },
  [`${PREFIX}DESTINATION_NOT_ASSIGNED`]: {
    title: "Este producto todavía no tiene una ubicación de inventario asignada.",
    hint: "Asígnala primero desde Catálogo y precios.",
  },
  [`${PREFIX}NOT_REQUIRED`]: {
    title: "Este producto no tiene existencias pendientes de regularizar.",
  },
  [`${PREFIX}LOCATIONS_DISABLED`]: {
    title: "El control de ubicaciones está desactivado en este negocio, así que no hay nada que regularizar.",
  },
  [`${PREFIX}DESTINATION_INACTIVE`]: {
    title: "La ubicación asignada a este producto está inactiva.",
    hint: "Actívala o asigna otra desde Catálogo y precios.",
  },
  [`${PREFIX}THIRD_LOCATION_STOCK`]: {
    title: "Este producto tiene existencias en otra ubicación de la sucursal.",
    hint: "Debe resolverse ese inventario antes de regularizar.",
  },
  [`${PREFIX}TRACEABILITY_INCONSISTENT`]: {
    title:
      "Los lotes o series registrados no coinciden con las existencias del producto. No se realizó ningún cambio.",
    hint: "Revisa la trazabilidad del producto antes de continuar.",
  },
  [`${PREFIX}TRACEABLE_RESERVATION`]: {
    title:
      "Este producto con lotes o series tiene unidades reservadas sin ubicación y todavía no puede regularizarse.",
  },
  [`${PREFIX}RESERVATION_INVALID`]: {
    title: "Hay reservas con datos incompletos o inválidos. No se realizó ningún cambio.",
  },
  [`${PREFIX}RESERVATION_OTHER_BALANCE`]: {
    title:
      "Algunas reservas están asignadas a una ubicación distinta del destino. No se realizó ningún cambio.",
  },
  [`${PREFIX}INCONSISTENT`]: {
    title:
      "Las cantidades registradas no permiten consolidar el inventario de forma segura. No se realizó ningún cambio.",
  },
  [`${PREFIX}KEY_REUSED`]: {
    title:
      "Esta solicitud ya se había utilizado con datos distintos. Actualiza la información antes de intentarlo de nuevo.",
  },
  [`${PREFIX}PRODUCT_NOT_ELIGIBLE`]: {
    title: "Solo los productos físicos con control de inventario pueden regularizarse.",
  },
  [`${PREFIX}ASSIGNMENT_CONFLICT`]: {
    title:
      "Este producto ya tiene otra ubicación de inventario asignada. Actualiza la información antes de continuar.",
    hint: "Una ubicación asignada no se cambia desde aquí; usa «Actualizar vista previa».",
  },
  [`${PREFIX}ASSIGNMENT_PERMISSION`]: {
    title:
      "Faltan permisos para asignar ubicaciones de inventario. Necesitas poder registrar ajustes y actualizar productos.",
    hint: "Solicita el acceso a un administrador.",
  },
  [`${PREFIX}BUSY`]: {
    title:
      "Otra operación está utilizando el inventario de este producto. No se realizó ningún cambio.",
    hint: "Puedes reintentar la misma solicitud de forma segura en unos segundos.",
  },
  ACCESS_DENIED: {
    title: "No tienes los permisos necesarios para asignar una ubicación inicial.",
    hint: "Necesitas poder registrar ajustes de inventario y actualizar productos.",
  },
  BRANCH_ACCESS_DENIED: { title: "No tienes acceso a esta sucursal." },
  BRANCH_NOT_FOUND: {
    title: "No se encontró la sucursal seleccionada.",
    hint: "Actualiza la pantalla e inténtalo de nuevo.",
  },
  PRODUCT_NOT_FOUND: {
    title: "No se encontró el producto seleccionado.",
    hint: "Búscalo de nuevo e inténtalo otra vez.",
  },
  LOCATION_NOT_FOUND: {
    title: "No se encontró la ubicación asignada al producto.",
    hint: "Revisa la configuración del producto en Catálogo y precios.",
  },
  LOCATION_BRANCH_MISMATCH: {
    title: "La ubicación asignada no pertenece a la sucursal seleccionada.",
  },
  CAPABILITY_REQUIRED: { title: "Tu plan actual no incluye esta función." },
  FORBIDDEN: { title: "No tienes permiso para realizar esta operación." },
};

const UNCERTAIN_MESSAGE: KnownMessage = {
  title:
    "No pudimos confirmar si la regularización se aplicó. Puede que ya esté registrada, así que no se enviará otra con datos nuevos.",
  hint: "Reintenta la misma solicitud: si ya se aplicó, verás el resultado registrado y no se duplicará.",
};

const GENERIC_LOAD_MESSAGE: KnownMessage = {
  title: "No pudimos cargar la información en este momento.",
  hint: "Inténtalo de nuevo en unos minutos.",
};

const GENERIC_EXECUTE_MESSAGE: KnownMessage = {
  title: "No se pudo completar la regularización. No se realizó ningún cambio.",
  hint: "Actualiza la vista previa e inténtalo de nuevo.",
};

const GENERIC_BLOCKER_MESSAGE: KnownMessage = {
  title: "Hay una condición del inventario que impide realizar la regularización.",
  hint: "Si persiste, comparte el código técnico con soporte.",
};

function withDiagnostic(message: KnownMessage, code?: string): RegularizationUserMessage {
  return { ...message, ...(code ? { diagnosticCode: code } : {}) };
}

/** Bloqueo informado por la vista previa del backend. */
export function describeRegularizationBlocker(blocker: {
  code: string;
}): RegularizationUserMessage {
  return withDiagnostic(KNOWN_MESSAGES[blocker.code] ?? GENERIC_BLOCKER_MESSAGE, blocker.code);
}

/**
 * Error de lectura (busqueda, destino, vista previa) o de ejecucion.
 *
 * - `kind: "uncertain"` nunca afirma que la operacion fallo: puede haberse aplicado.
 * - Un error local (sin codigo ni estado HTTP) ya viene redactado para el usuario y se conserva.
 * - Un codigo conocido se traduce; un error desconocido usa un mensaje general seguro.
 */
export function describeRegularizationFailure(
  failure: {
    kind?: "uncertain" | "definitive";
    code?: string;
    status?: number;
    message?: string;
    /** El mensaje lo redacto esta aplicacion para el usuario (validacion local previa al envio). */
    local?: boolean;
  },
  context: "load" | "execute",
): RegularizationUserMessage {
  // BUSY es la unica falla "pendiente" cuyo estado se conoce: no se aplico nada y puede repetirse.
  if (failure.code === `${PREFIX}BUSY`) return withDiagnostic(KNOWN_MESSAGES[failure.code], failure.code);
  if (failure.kind === "uncertain") return withDiagnostic(UNCERTAIN_MESSAGE, failure.code);
  if (failure.code && KNOWN_MESSAGES[failure.code]) {
    return withDiagnostic(KNOWN_MESSAGES[failure.code], failure.code);
  }
  if (failure.local && failure.message) return { title: failure.message };
  const status = failure.status;
  if (status === 403) return withDiagnostic(KNOWN_MESSAGES.FORBIDDEN, failure.code);
  if (status === 404) {
    return withDiagnostic(
      {
        title: "No se encontró la información solicitada.",
        hint: "Actualiza la pantalla e inténtalo de nuevo.",
      },
      failure.code,
    );
  }
  if (status === 400 || status === 422) {
    return withDiagnostic(
      {
        title: "Revisa los datos ingresados e inténtalo de nuevo.",
      },
      failure.code,
    );
  }
  if (status === 409) {
    return withDiagnostic(
      {
        title: "El inventario cambió y la operación no pudo completarse. No se realizó ningún cambio.",
        hint: "Actualiza la información antes de continuar.",
      },
      failure.code,
    );
  }
  return withDiagnostic(
    context === "load" ? GENERIC_LOAD_MESSAGE : GENERIC_EXECUTE_MESSAGE,
    failure.code,
  );
}
