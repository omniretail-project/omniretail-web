import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PickingItemStatus } from "@/core/enums";
import type { PickingDetailLineDto } from "@/modules/logistics/application/dto/PickingReadModelDto";
import { PickingLineList } from "@/modules/logistics/components/PickingLineList";

const ids = {
  tenant: "10000000-0000-4000-8000-000000000001",
  branch: "10000000-0000-4000-8000-000000000002",
  picking: "10000000-0000-4000-8000-000000000003",
  order: "10000000-0000-4000-8000-000000000004",
  product: "10000000-0000-4000-8000-000000000005",
  line: "10000000-0000-4000-8000-000000000006",
  orderLine: "10000000-0000-4000-8000-000000000007",
  location: "10000000-0000-4000-8000-000000000008",
  balance: "10000000-0000-4000-8000-000000000009",
};

const canonicalSerials = ["106", "107", "108", "109", "110"];

function serialLine(): PickingDetailLineDto {
  return {
    pickingLineId: ids.line,
    orderItemId: ids.orderLine,
    productId: ids.product,
    sku: "LAPTOP-SERIAL",
    name: "Laptop serializada",
    requiredQuantity: 2,
    pickedQuantity: 0,
    remainingQuantity: 2,
    status: PickingItemStatus.pending,
    location: { id: ids.location, code: "A-01", name: "Estante A" },
    lot: null,
    serialNumbers: [],
    availableLocations: [
      {
        id: ids.location,
        code: "A-01",
        name: "Estante A",
        ownReservedQuantity: 2,
        usableQuantity: 3,
      },
    ],
    availableLots: [],
    availableSerialNumbers: canonicalSerials,
    tracking: { stock: true, lot: false, expiration: false, serial: true },
    inventory: {
      tenantId: ids.tenant,
      branchId: ids.branch,
      pickingOrderId: ids.picking,
      orderId: ids.order,
      productId: ids.product,
      physicalQuantity: 7,
      ownReservedQuantity: 2,
      otherReservedQuantity: 4,
      freeQuantity: 1,
      usableQuantity: 3,
      locations: [
        {
          balanceId: ids.balance,
          locationId: ids.location,
          locationCode: "A-01",
          locationName: "Estante A",
          physicalQuantity: 7,
          ownReservedQuantity: 2,
          otherReservedQuantity: 4,
          freeQuantity: 1,
          usableQuantity: 3,
          lots: [],
          serialNumbers: [
            ...canonicalSerials.map((serial, index) => ({
              id: `10000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
              serialNumber: serial,
            })),
            {
              id: "10000000-0000-4000-8000-000000000099",
              serialNumber: "106",
            },
          ],
        },
      ],
    },
    sourceLineId: ids.orderLine,
    trackingSelections: [],
  };
}

function completedSerialLine(serialNumber = "106"): PickingDetailLineDto {
  return {
    ...serialLine(),
    requiredQuantity: 1,
    pickedQuantity: 1,
    remainingQuantity: 0,
    status: PickingItemStatus.completed,
    serialNumbers: [serialNumber],
    trackingSelections: [
      {
        locationId: ids.location,
        lotId: null,
        lotNumber: null,
        expirationDate: null,
        quantity: 1,
        serialNumbers: [serialNumber],
      },
    ],
  };
}

describe("PickingLineList series canonicas", () => {
  it("mantiene las sugeridas informativas y sincroniza lista, escaner y seleccion", () => {
    render(
      <PickingLineList
        disabled={false}
        editable
        incidents={[]}
        lines={[serialLine()]}
        onUpdate={vi.fn(async () => true)}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: "Cantidad total recogida" }), {
      target: { value: "2" },
    });
    const suggestions = screen.getByRole("list", { name: "Series sugeridas" });
    expect(within(suggestions).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "106",
      "107",
    ]);
    expect(within(suggestions).queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "106" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "107" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ver series disponibles (5)" }));
    expect(screen.getByRole("button", { name: "Ocultar series disponibles" })).toBeInTheDocument();

    const availableList = document.getElementById(`available-serials-${ids.line}`);
    expect(availableList).not.toBeNull();
    const list = within(availableList!);
    expect(list.getAllByRole("checkbox")).toHaveLength(5);
    expect(list.getByRole("checkbox", { name: "106" })).not.toBeChecked();
    expect(list.getByRole("checkbox", { name: "107" })).not.toBeChecked();

    fireEvent.click(list.getByRole("checkbox", { name: "106" }));
    expect(list.getByRole("checkbox", { name: "106" })).toBeChecked();
    expect(screen.getByText("seleccionadas 1 / requeridas 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar serie 106" })).toBeInTheDocument();

    fireEvent.click(list.getByRole("checkbox", { name: "106" }));
    expect(list.getByRole("checkbox", { name: "106" })).not.toBeChecked();

    fireEvent.change(screen.getByRole("textbox", { name: "Escanear o escribir serie" }), {
      target: { value: "107" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(list.getByRole("checkbox", { name: "107" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Quitar serie 107" })).toBeInTheDocument();

    fireEvent.click(list.getByRole("checkbox", { name: "107" }));

    fireEvent.click(list.getByRole("checkbox", { name: "108" }));
    fireEvent.click(list.getByRole("checkbox", { name: "109" }));
    expect(screen.getByText("seleccionadas 2 / requeridas 2")).toBeInTheDocument();
    expect(list.getByRole("checkbox", { name: "110" })).toBeDisabled();
  });

  it("permite filtrar la lista general incluyendo una serie sugerida", () => {
    render(
      <PickingLineList
        disabled={false}
        editable
        incidents={[]}
        lines={[serialLine()]}
        onUpdate={vi.fn(async () => true)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ver series disponibles (5)" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar serie" }), {
      target: { value: "106" },
    });

    const availableList = document.getElementById(`available-serials-${ids.line}`);
    expect(availableList).not.toBeNull();
    const list = within(availableList!);
    expect(list.getAllByRole("checkbox")).toHaveLength(1);
    expect(list.getByRole("checkbox", { name: "106" })).toBeInTheDocument();
  });

  it("muestra la serie persistida y permite reemplazarla desde la correccion", async () => {
    const onUpdate = vi.fn(async () => true);
    render(
      <PickingLineList
        disabled={false}
        editable
        incidents={[]}
        lines={[completedSerialLine()]}
        onUpdate={onUpdate}
      />,
    );

    const summary = screen.getByText("Series recogidas", { selector: "p.text-xs" }).parentElement;
    expect(summary).not.toBeNull();
    expect(within(summary!).getByText("106")).toBeInTheDocument();
    expect(screen.getByText("Corregir series recogidas · 1 / 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ver series disponibles" }));
    const replacementList = document.getElementById(`replacement-serials-${ids.line}`);
    expect(replacementList).not.toBeNull();
    const replacement = within(replacementList!);
    expect(replacement.getByRole("checkbox", { name: "106" })).toBeChecked();

    fireEvent.click(replacement.getByRole("checkbox", { name: "106" }));
    fireEvent.click(replacement.getByRole("checkbox", { name: "107" }));
    fireEvent.click(replacement.getByRole("button", { name: "Guardar selección de series" }));

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ serialNumbers: ["106"] }),
      1,
      {
        locationId: ids.location,
        trackingSelections: [
          {
            locationId: ids.location,
            lotId: null,
            quantity: 1,
            serialNumbers: ["107"],
          },
        ],
      },
    );
  });

  it("refresca la serie recogida al recibir un detalle autoritativo nuevo", () => {
    const onUpdate = vi.fn(async () => true);
    const { rerender } = render(
      <PickingLineList
        disabled={false}
        editable
        incidents={[]}
        lines={[completedSerialLine("106")]}
        onUpdate={onUpdate}
      />,
    );

    expect(screen.getByText("106")).toBeInTheDocument();

    rerender(
      <PickingLineList
        disabled={false}
        editable
        incidents={[]}
        lines={[completedSerialLine("107")]}
        onUpdate={onUpdate}
      />,
    );

    expect(screen.queryByText("106")).not.toBeInTheDocument();
    expect(screen.getByText("107")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver series disponibles" }));
    const replacementList = document.getElementById(`replacement-serials-${ids.line}`);
    expect(replacementList).not.toBeNull();
    expect(within(replacementList!).getByRole("checkbox", { name: "107" })).toBeChecked();
  });
});
