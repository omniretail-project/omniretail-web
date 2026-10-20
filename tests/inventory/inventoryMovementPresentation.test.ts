import { describe, expect, it } from "vitest";
import { InventoryMovementType } from "@/core/enums";
import type { InventoryMovementRow } from "@/modules/inventory/application/dto/InventoryMovementsDto";
import { resolveInventoryMovementPresentation } from "@/modules/inventory/application/services/resolveInventoryMovementPresentation";

const MOVEMENT_UUID = "a60a028c-12c1-4013-8493-66cdda7e85bf";

function movement(overrides: Partial<InventoryMovementRow> = {}): InventoryMovementRow {
  return {
    id: "movement-1",
    tenantId: "tenant-1",
    branchId: "branch-1",
    branchName: "Sucursal Centro",
    productId: "product-1",
    productName: "Producto",
    sku: "SKU-001",
    type: InventoryMovementType.out,
    displayType: "out",
    typeLabel: "Salida",
    typeTone: "danger",
    quantity: 5,
    signedQuantity: -5,
    unitLabel: "Unidad",
    locationLabel: "Bodega",
    referenceType: "unknown",
    referenceId: MOVEMENT_UUID,
    referenceLabel: MOVEMENT_UUID,
    userLabel: "Operador",
    reason: "Movimiento histórico",
    createdAt: "2026-10-19T12:00:00-06:00",
    ...overrides,
  };
}

describe("resolveInventoryMovementPresentation", () => {
  it("muestra el numero comercial y el tipo de una salida por traslado", () => {
    const result = resolveInventoryMovementPresentation(
      movement({
        referenceType: undefined,
        reason: "Salida por traslado TR-2026-00003",
      }),
    );

    expect(result).toEqual({
      displayType: "transfer_out",
      typeLabel: "Salida por traslado",
      referenceLabel: "TR-2026-00003",
    });
  });

  it("resuelve varias entradas de una transferencia desde el motivo de recepcion", () => {
    const entries = [
      movement({
        id: "movement-in-1",
        type: InventoryMovementType.in,
        displayType: "in",
        typeLabel: "Entrada",
        signedQuantity: 3,
        referenceType: undefined,
        reason: "Recepción de traslado TR-2026-00003",
      }),
      movement({
        id: "movement-in-2",
        type: InventoryMovementType.in,
        displayType: "in",
        typeLabel: "Entrada",
        signedQuantity: 2,
        referenceType: undefined,
        reason: "Recepción   de   traslado   TR-2026-00003",
      }),
    ];

    expect(entries.map(resolveInventoryMovementPresentation)).toEqual([
      {
        displayType: "transfer_in",
        typeLabel: "Entrada por traslado",
        referenceLabel: "TR-2026-00003",
      },
      {
        displayType: "transfer_in",
        typeLabel: "Entrada por traslado",
        referenceLabel: "TR-2026-00003",
      },
    ]);
  });

  it("identifica el retiro en tienda real aunque referenceType no lo clasifique", () => {
    expect(
      resolveInventoryMovementPresentation(
        movement({
          referenceType: undefined,
          reason: "Retiro en tienda entregado al cliente",
          referenceId: "15bf47f2-e7c2-498f-8c25-94b8913c1a5b",
          referenceLabel: "15bf47f2-e7c2-498f-8c25-94b8913c1a5b",
        }),
      ),
    ).toEqual({
      displayType: "store_pickup",
      typeLabel: "Salida por entrega en tienda",
      referenceLabel: "Retiro en tienda",
    });
  });

  it("conserva una referencia POS estructurada en un retiro en tienda", () => {
    expect(
      resolveInventoryMovementPresentation(
        movement({
          referenceType: "order",
          reason: "Entrega de pedido POS-004",
          referenceLabel: "POS-004",
        }),
      ).referenceLabel,
    ).toBe("POS-004");
  });

  it("conserva una referencia de venta POS que ya es comprensible", () => {
    expect(
      resolveInventoryMovementPresentation(
        movement({
          displayType: "sale",
          typeLabel: "Venta",
          referenceType: "sale",
          referenceLabel: "POS-001",
        }),
      ),
    ).toEqual({ displayType: "sale", typeLabel: "Venta", referenceLabel: "POS-001" });
  });

  it("conserva una referencia de recepcion que ya es comprensible", () => {
    expect(
      resolveInventoryMovementPresentation(
        movement({
          type: InventoryMovementType.in,
          displayType: "purchase_in",
          typeLabel: "Entrada por compra",
          referenceType: "receipt",
          referenceLabel: "REC-003",
        }),
      ),
    ).toEqual({
      displayType: "purchase_in",
      typeLabel: "Entrada por compra",
      referenceLabel: "REC-003",
    });
  });

  it("no reemplaza un UUID cuando el movimiento no se puede clasificar con seguridad", () => {
    expect(resolveInventoryMovementPresentation(movement())).toEqual({
      displayType: "out",
      typeLabel: "Salida",
      referenceLabel: MOVEMENT_UUID,
    });
  });
});
