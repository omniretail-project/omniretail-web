import type { CashMovementType } from "@/core/enums";
import type { CashMovementDto } from "@/modules/pos/application/dto/CashMovementDto";

const AMOUNT_TOLERANCE = 0.005;

/** Misma forma que `CashMovementFormInput` del hook, sin depender de el. */
export interface RequestedCashMovement {
  type: CashMovementType;
  amount: number;
  reason: string;
}

/**
 * Movimientos manuales de la lista autoritativa que PUEDEN corresponder a una solicitud cuyo resultado
 * quedo incierto. Un movimiento solo es candidato si NO existia antes de enviar la solicitud (su id no
 * estaba en `knownIds`) y coincide en turno, tipo, monto, motivo, autor y es manual (sin referencia a una
 * venta). Comparar monto y motivo no basta por si solo: la novedad del id es lo que lo distingue de un
 * movimiento anterior identico.
 *
 * Aun asi es una verificacion, no una prueba: otra sesion del mismo usuario podria haber creado un
 * movimiento igual en ese intervalo. Por eso quien la usa debe informar la incertidumbre cuando no hay
 * exactamente un candidato.
 */
export function findRegisteredMovementCandidates(input: {
  movements: readonly CashMovementDto[];
  knownIds: readonly string[];
  request: RequestedCashMovement;
  cashShiftId: string;
  actorUserId: string;
}): CashMovementDto[] {
  const known = new Set(input.knownIds);
  const reason = input.request.reason.trim();
  return input.movements.filter(
    (movement) =>
      !known.has(movement.id) &&
      movement.cashShiftId === input.cashShiftId &&
      movement.type === input.request.type &&
      Math.abs(movement.amount - input.request.amount) < AMOUNT_TOLERANCE &&
      movement.reason.trim() === reason &&
      movement.createdByUserId === input.actorUserId &&
      !movement.referenceType,
  );
}
