import { describe, expect, it } from "vitest";
import { CashMovementType } from "@/core/enums";
import { findRegisteredMovementCandidates } from "@/modules/pos/application/cashMovementVerification";
import type { CashMovementDto } from "@/modules/pos/application/dto/CashMovementDto";
import { id, ids } from "./posFixtures";

const request = { type: CashMovementType.out, amount: 5, reason: "Bolsas" };

function movement(overrides: Partial<CashMovementDto> = {}): CashMovementDto {
  return {
    id: id(500),
    cashShiftId: ids.shift,
    type: CashMovementType.out,
    amount: 5,
    reason: "Bolsas",
    createdByUserId: ids.user,
    createdAt: "2026-10-28T10:00:00.000Z",
    ...overrides,
  };
}

function candidates(movements: CashMovementDto[], knownIds: string[] = []) {
  return findRegisteredMovementCandidates({
    movements,
    knownIds,
    request,
    cashShiftId: ids.shift,
    actorUserId: ids.user,
  });
}

describe("findRegisteredMovementCandidates", () => {
  it("encuentra el movimiento nuevo que coincide en turno, tipo, monto, motivo y autor", () => {
    const created = movement();

    expect(candidates([created])).toEqual([created]);
  });

  it("un movimiento identico que ya existia antes del envio NO es candidato (no basta monto y motivo)", () => {
    const previous = movement({ id: id(501) });

    expect(candidates([previous], [previous.id])).toEqual([]);
  });

  it("distingue el movimiento nuevo de uno anterior identico", () => {
    const previous = movement({ id: id(501) });
    const created = movement({ id: id(502) });

    expect(candidates([previous, created], [previous.id])).toEqual([created]);
  });

  it.each<[string, Partial<CashMovementDto>]>([
    ["otro tipo", { type: CashMovementType.in }],
    ["otro monto", { amount: 6 }],
    ["otro motivo", { reason: "Otra cosa" }],
    ["otro autor", { createdByUserId: id(900) }],
    ["otro turno", { cashShiftId: id(901) }],
    ["movimiento de una venta", { referenceType: "sale", referenceId: ids.sale }],
  ])("descarta un movimiento nuevo con %s", (_label, overrides) => {
    expect(candidates([movement(overrides)])).toEqual([]);
  });

  it("tolera diferencias de redondeo menores a medio centavo y espacios en el motivo", () => {
    expect(candidates([movement({ amount: 5.0004, reason: "  Bolsas " })])).toHaveLength(1);
  });

  it("devuelve varios candidatos cuando hay mas de un movimiento nuevo igual (ambiguo)", () => {
    expect(candidates([movement({ id: id(502) }), movement({ id: id(503) })])).toHaveLength(2);
  });
});
