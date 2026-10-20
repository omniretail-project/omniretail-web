import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PickingItemStatus } from "@/core/enums";
import type { PickingDetailLineDto } from "@/modules/logistics/application/dto/PickingReadModelDto";
import { PickingLineList } from "@/modules/logistics/components/PickingLineList";

interface FefoPreviewQueryMock {
  pickingOrderId: string;
  pickingLineId: string;
  productId: string;
  locationId: string;
  pickedQuantity: number;
}

const fefoPreviewMock = vi.hoisted(() => ({
  resultsByQuery: new Map<string, object>(),
  currentPickedQuantity: 0,
  reload: vi.fn(),
  idleResult: {
    status: "idle" as const,
    data: null,
    error: null,
    canQuery: false,
    reload: vi.fn(),
  },
}));

vi.mock("@/modules/logistics/hooks/usePickingFefoPreview", () => ({
  usePickingFefoPreview: (query: FefoPreviewQueryMock | null) => {
    if (!query) return fefoPreviewMock.idleResult;
    const queryKey = JSON.stringify([
      query.pickingOrderId,
      query.pickingLineId,
      query.productId,
      query.locationId,
      query.pickedQuantity,
    ]);
    const cached = fefoPreviewMock.resultsByQuery.get(queryKey);
    if (cached) return cached;
    const currentPickedQuantity = fefoPreviewMock.currentPickedQuantity;
    const incrementalQuantity = query.pickedQuantity - currentPickedQuantity;
    const firstLotQuantity = Math.min(incrementalQuantity, 100);
    const secondLotQuantity = Math.max(incrementalQuantity - firstLotQuantity, 0);
    const location = query.locationId === ids.locationB
      ? { id: query.locationId, code: "B-02", name: "Estante B" }
      : { id: query.locationId, code: "A-01", name: "Estante A" };
    const existingSelections = currentPickedQuantity > 0 ? [{
      locationId: query.locationId,
      locationCode: location.code,
      locationName: location.name,
      lotId: "10000000-0000-4000-8000-000000000020",
      lotNumber: "526397",
      expirationDate: "2027-03-13",
      quantity: currentPickedQuantity,
    }] : [];
    const incrementalAllocations = [
      ...(firstLotQuantity > 0 ? [{
        locationId: query.locationId,
        locationCode: location.code,
        locationName: location.name,
        lotId: "10000000-0000-4000-8000-000000000020",
        lotNumber: "526397",
        expirationDate: "2027-03-13",
        quantity: firstLotQuantity,
      }] : []),
      ...(secondLotQuantity > 0 ? [{
        locationId: query.locationId,
        locationCode: location.code,
        locationName: location.name,
        lotId: "10000000-0000-4000-8000-000000000099",
        lotNumber: "PREVIEW-LOT",
        expirationDate: "2027-10-01",
        quantity: secondLotQuantity,
      }] : []),
    ];
    const result = {
      status: "loaded" as const,
      data: {
        ...query,
        targetPickedQuantity: query.pickedQuantity,
        currentPickedQuantity,
        incrementalQuantity,
        productId: "10000000-0000-4000-8000-000000000005",
        branchId: "10000000-0000-4000-8000-000000000002",
        location,
        existingSelections,
        incrementalAllocations,
        resultingSelections: [...existingSelections, ...incrementalAllocations],
        calculatedAt: "2026-10-19T12:00:00-06:00",
        provisional: true as const,
      },
      error: null,
      canQuery: true,
      reload: fefoPreviewMock.reload,
    };
    fefoPreviewMock.resultsByQuery.set(queryKey, result);
    return result;
  },
}));

beforeEach(() => {
  fefoPreviewMock.resultsByQuery.clear();
  fefoPreviewMock.currentPickedQuantity = 0;
  fefoPreviewMock.reload.mockClear();
  fefoPreviewMock.idleResult.reload.mockClear();
});

const ids = {
  tenant: "10000000-0000-4000-8000-000000000001",
  branch: "10000000-0000-4000-8000-000000000002",
  picking: "10000000-0000-4000-8000-000000000003",
  order: "10000000-0000-4000-8000-000000000004",
  product: "10000000-0000-4000-8000-000000000005",
  line: "10000000-0000-4000-8000-000000000006",
  orderLine: "10000000-0000-4000-8000-000000000007",
  location: "10000000-0000-4000-8000-000000000008",
  locationB: "10000000-0000-4000-8000-000000000018",
  balance: "10000000-0000-4000-8000-000000000009",
  lotA: "10000000-0000-4000-8000-000000000020",
  lotB: "10000000-0000-4000-8000-000000000021",
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

function autoFefoLine(confirmed = false): PickingDetailLineDto {
  return {
    ...serialLine(),
    sku: "MED-FEFO",
    name: "Acetaminofen 400MG",
    requiredQuantity: 150,
    pickedQuantity: confirmed ? 150 : 0,
    remainingQuantity: confirmed ? 0 : 150,
    status: confirmed ? PickingItemStatus.completed : PickingItemStatus.pending,
    availableLots: [
      { id: ids.lotA, number: "526397", expirationDate: "2027-03-13", physicalQuantity: 100 },
      { id: ids.lotB, number: "121401", expirationDate: "2027-11-17", physicalQuantity: 75 },
    ],
    availableSerialNumbers: [],
    tracking: { stock: true, lot: true, expiration: true, serial: false },
    inventory: {
      ...serialLine().inventory,
      locations: [
        {
          ...serialLine().inventory.locations[0],
          lots: [
            {
              lotId: ids.lotA,
              lotNumber: "526397",
              expirationDate: "2027-03-13",
              physicalQuantity: 100,
              serialNumbers: [],
            },
            {
              lotId: ids.lotB,
              lotNumber: "121401",
              expirationDate: "2027-11-17",
              physicalQuantity: 75,
              serialNumbers: [],
            },
          ],
          serialNumbers: [],
        },
      ],
    },
    trackingSelections: confirmed
      ? [
          {
            locationId: ids.location,
            lotId: ids.lotB,
            lotNumber: "121401",
            expirationDate: "2027-11-17",
            quantity: 50,
            serialNumbers: [],
          },
          {
            locationId: ids.location,
            lotId: ids.lotA,
            lotNumber: "526397",
            expirationDate: "2027-03-13",
            quantity: 100,
            serialNumbers: [],
          },
        ]
      : [],
  };
}

describe("PickingLineList series canonicas", () => {
  it("mantiene las sugeridas informativas y sincroniza lista, escaner y seleccion", () => {
    render(
      <PickingLineList
        autoFefoEnabled={false}
        disabled={false}
        editable
        incidents={[]}
        lines={[serialLine()]}
        onUpdate={vi.fn(async () => true)}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: "Cantidad recogida hasta ahora" }), {
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
        autoFefoEnabled={false}
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
        autoFefoEnabled={false}
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
        autoFefoEnabled={false}
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
        autoFefoEnabled={false}
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

describe("PickingLineList FEFO automatico", () => {
  it("muestra al abrir la recomendacion completa sin rellenar la cantidad", () => {
    render(
      <PickingLineList
        autoFefoEnabled
        disabled={false}
        editable
        incidents={[]}
        lines={[autoFefoLine()]}
        onUpdate={vi.fn(async () => true)}
        pickingOrderId={ids.picking}
      />,
    );

    const recommendation = screen.getByRole("region", {
      name: "Lotes recomendados para recoger",
    });
    const lots = within(recommendation).getByRole("group", {
      name: "Lotes que debes recoger",
    });
    expect(within(lots).getAllByText(/^Lote /).map((item) => item.textContent)).toEqual([
      "Lote 526397",
      "Lote PREVIEW-LOT",
    ]);
    expect(within(lots).getByText("Recoger 100")).toBeInTheDocument();
    expect(within(lots).getByText("Recoger 50")).toBeInTheDocument();
    expect(within(recommendation).getByText("Total pendiente por recoger: 150 unidades")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "Cantidad recogida hasta ahora" })).toHaveValue(0);
    expect(recommendation.compareDocumentPosition(
      screen.getByRole("spinbutton", { name: "Cantidad recogida hasta ahora" }),
    ) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("distingue la recomendacion completa de la vista previa para una cantidad parcial", () => {
    render(
      <PickingLineList
        autoFefoEnabled
        disabled={false}
        editable
        incidents={[]}
        lines={[autoFefoLine()]}
        onUpdate={vi.fn(async () => true)}
        pickingOrderId={ids.picking}
      />,
    );

    fireEvent.change(screen.getByRole("spinbutton", { name: "Cantidad recogida hasta ahora" }), {
      target: { value: "75" },
    });

    const recommendation = screen.getByRole("region", {
      name: "Lotes recomendados para recoger",
    });
    const partial = screen.getByRole("region", { name: "Lotes para la cantidad indicada" });
    expect(within(recommendation).getByText("Total pendiente por recoger: 150 unidades")).toBeInTheDocument();
    expect(within(partial).getByText("Total que agregarás: 75 unidades")).toBeInTheDocument();
    expect(fefoPreviewMock.resultsByQuery.has(JSON.stringify([
      ids.picking, ids.line, ids.product, ids.location, 150,
    ]))).toBe(true);
    expect(fefoPreviewMock.resultsByQuery.has(JSON.stringify([
      ids.picking, ids.line, ids.product, ids.location, 75,
    ]))).toBe(true);
  });

  it("recalcula la recomendacion para la ubicacion seleccionada", () => {
    const base = autoFefoLine();
    const line: PickingDetailLineDto = {
      ...base,
      location: null,
      availableLocations: [
        ...base.availableLocations,
        {
          id: ids.locationB,
          code: "B-02",
          name: "Estante B",
          ownReservedQuantity: 150,
          usableQuantity: 150,
        },
      ],
      inventory: {
        ...base.inventory,
        locations: [
          ...base.inventory.locations,
          {
            ...base.inventory.locations[0],
            balanceId: "10000000-0000-4000-8000-000000000019",
            locationId: ids.locationB,
            locationCode: "B-02",
            locationName: "Estante B",
          },
        ],
      },
    };
    render(
      <PickingLineList
        autoFefoEnabled
        disabled={false}
        editable
        incidents={[]}
        lines={[line]}
        onUpdate={vi.fn(async () => true)}
        pickingOrderId={ids.picking}
      />,
    );

    expect(screen.getByText("Selecciona una ubicación")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ubicacion fisica *"), {
      target: { value: ids.locationB },
    });
    const recommendation = screen.getByRole("region", {
      name: "Lotes recomendados para recoger",
    });
    expect(within(recommendation).getAllByText(/B-02/).length).toBeGreaterThan(0);
    expect(fefoPreviewMock.resultsByQuery.has(JSON.stringify([
      ids.picking, ids.line, ids.product, ids.locationB, 150,
    ]))).toBe(true);
  });

  it("muestra el error autoritativo de la recomendacion sin inventar lotes", () => {
    const key = JSON.stringify([ids.picking, ids.line, ids.product, ids.location, 150]);
    fefoPreviewMock.resultsByQuery.set(key, {
      status: "error",
      data: null,
      error: "Existencia insuficiente para completar la linea.",
      canQuery: true,
      reload: fefoPreviewMock.reload,
    });
    render(
      <PickingLineList
        autoFefoEnabled
        disabled={false}
        editable
        incidents={[]}
        lines={[autoFefoLine()]}
        onUpdate={vi.fn(async () => true)}
        pickingOrderId={ids.picking}
      />,
    );

    expect(screen.getByText("No se pudieron cargar los lotes recomendados")).toBeInTheDocument();
    expect(screen.getByText("Existencia insuficiente para completar la linea.")).toBeInTheDocument();
    expect(screen.queryByRole("region", {
      name: "Lotes recomendados para recoger",
    })).not.toBeInTheDocument();
  });

  it("envia cantidad acumulada y solicita asignacion automatica en modo API", async () => {
    fefoPreviewMock.currentPickedQuantity = 100;
    const onUpdate = vi.fn(async () => true);
    const line: PickingDetailLineDto = {
      ...autoFefoLine(),
      pickedQuantity: 100,
      remainingQuantity: 50,
      status: PickingItemStatus.partial,
      trackingSelections: [
        {
          locationId: ids.location,
          lotId: ids.lotA,
          lotNumber: "526397",
          expirationDate: "2027-03-13",
          quantity: 100,
          serialNumbers: [],
        },
      ],
    };
    render(
      <PickingLineList
        autoFefoEnabled
        disabled={false}
        editable
        incidents={[]}
        lines={[line]}
        onUpdate={onUpdate}
      />,
    );

    expect(screen.queryByLabelText("Lote para el incremento *")).not.toBeInTheDocument();
    expect(screen.getByText("Selección de lotes por vencimiento")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Cantidad recogida hasta ahora" }), {
      target: { value: "150" },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar recolección" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Guardar recolección" }));

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ productId: ids.product }),
      150,
      {
        locationId: ids.location,
        autoAllocateLots: true,
        trackingSelections: [],
      },
    );
  });

  it("conserva la seleccion manual de lotes en modo mock", () => {
    render(
      <PickingLineList
        autoFefoEnabled={false}
        disabled={false}
        editable
        incidents={[]}
        lines={[autoFefoLine()]}
        onUpdate={vi.fn(async () => true)}
      />,
    );

    expect(screen.getByLabelText("Lote para el incremento *")).toBeInTheDocument();
    expect(screen.queryByText("Selección de lotes por vencimiento")).not.toBeInTheDocument();
    expect(screen.queryByText("Lotes recomendados para recoger")).not.toBeInTheDocument();
  });

  it("mantiene manual el flujo serializado aunque el modo API este activo", () => {
    const line: PickingDetailLineDto = {
      ...autoFefoLine(),
      requiredQuantity: 1,
      remainingQuantity: 1,
      tracking: { stock: true, lot: true, expiration: true, serial: true },
      availableSerialNumbers: ["SER-FEFO-1"],
      inventory: {
        ...autoFefoLine().inventory,
        locations: autoFefoLine().inventory.locations.map((location) => ({
          ...location,
          serialNumbers: [
            {
              id: "10000000-0000-4000-8000-000000000022",
              serialNumber: "SER-FEFO-1",
              lotId: ids.lotA,
            },
          ],
        })),
      },
    };
    render(
      <PickingLineList
        autoFefoEnabled
        disabled={false}
        editable
        incidents={[]}
        lines={[line]}
        onUpdate={vi.fn(async () => true)}
      />,
    );

    expect(screen.queryByText("Selección de lotes por vencimiento")).not.toBeInTheDocument();
    expect(screen.queryByText("Lotes recomendados para recoger")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Lote para el incremento *")).toBeInTheDocument();
    expect(screen.getByText("Series disponibles")).toBeInTheDocument();
  });

  it("muestra las asignaciones confirmadas ordenadas por vencimiento", () => {
    render(
      <PickingLineList
        autoFefoEnabled
        disabled={false}
        editable
        incidents={[]}
        lines={[autoFefoLine(true)]}
        onUpdate={vi.fn(async () => true)}
      />,
    );

    const summary = screen.getByRole("region", {
      name: "Lotes confirmados de Acetaminofen 400MG",
    });
    expect(within(summary).getAllByText(/^Lote /).map((item) => item.textContent)).toEqual([
      "Lote 526397",
      "Lote 121401",
    ]);
    expect(within(summary).getByText("Vence 13/03/2027 · A-01 · Estante A")).toBeInTheDocument();
    expect(within(summary).getByText("100 unidades")).toBeInTheDocument();
    expect(within(summary).getByText("50 unidades")).toBeInTheDocument();
    expect(within(summary).getByText("Total recogido: 150 unidades")).toBeInTheDocument();
  });

  it("advierte cuando el read-back autoritativo difiere de la vista previa usada", async () => {
    fefoPreviewMock.currentPickedQuantity = 100;
    const onUpdate = vi.fn(async () => true);
    const partial: PickingDetailLineDto = {
      ...autoFefoLine(),
      pickedQuantity: 100,
      remainingQuantity: 50,
      status: PickingItemStatus.partial,
      trackingSelections: [{
        locationId: ids.location,
        lotId: ids.lotA,
        lotNumber: "526397",
        expirationDate: "2027-03-13",
        quantity: 100,
        serialNumbers: [],
      }],
    };
    const view = render(
      <PickingLineList
        autoFefoEnabled
        disabled={false}
        editable
        incidents={[]}
        lines={[partial]}
        onUpdate={onUpdate}
        pickingOrderId={ids.picking}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "Cantidad recogida hasta ahora" }), {
      target: { value: "150" },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar recolección" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Guardar recolección" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());

    view.rerender(
      <PickingLineList
        autoFefoEnabled
        disabled={false}
        editable
        incidents={[]}
        lines={[autoFefoLine(true)]}
        onUpdate={onUpdate}
        pickingOrderId={ids.picking}
      />,
    );

    expect(screen.getByText("Los lotes recogidos cambiaron")).toBeInTheDocument();
    expect(screen.getByText(/Revisa los lotes que quedaron registrados/)).toBeInTheDocument();
  });
});
