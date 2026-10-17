import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PosApiTrackingSelection } from "@/core/repositories";
import type { PosTraceabilityInventoryDto } from "@/modules/pos/application/dto/PosTraceabilityInventoryDto";
import {
  PosTraceabilitySelector,
  type PosTraceabilitySelectorProduct,
} from "@/modules/pos/components/PosTraceabilitySelector";
import { id, ids } from "./posFixtures";

const mocks = vi.hoisted(() => ({
  load: vi.fn().mockResolvedValue(true),
  close: vi.fn(),
  state: {} as {
    status: "idle" | "loading" | "loaded" | "error";
    data: PosTraceabilityInventoryDto | null;
    error: string | null;
    canQuery: boolean;
  },
}));

vi.mock("@/modules/pos/hooks/usePosTraceabilityInventory", () => ({
  usePosTraceabilityInventory: () => ({
    ...mocks.state,
    load: mocks.load,
    close: mocks.close,
  }),
}));

const locationA = { id: ids.location, code: "A-01", name: "Estante A", type: "shelf" as const };
const locationB = { id: id(81), code: "B-01", name: "Estante B", type: "shelf" as const };

function inventory(productId = ids.product): PosTraceabilityInventoryDto {
  return {
    branchId: ids.branch,
    productId,
    businessDate: "2026-10-16",
    locations: [locationA, locationB],
    lots: [],
    serials: [],
    combinations: [
      {
        location: locationB,
        lot: { lotId: id(84), lotNumber: "LOT-002", expirationDate: "2027-01-31" },
        quantity: 3,
        reservedQuantity: 0,
        availableQuantity: 3,
        serials: [
          {
            serialId: id(85),
            serialNumber: "SER-003",
            locationId: locationB.id,
            lotId: id(84),
          },
        ],
        availableSerialCount: 1,
      },
      {
        location: locationA,
        lot: { lotId: ids.lot, lotNumber: "LOT-001", expirationDate: "2026-12-31" },
        quantity: 5,
        reservedQuantity: 1,
        availableQuantity: 4,
        serials: [
          {
            serialId: id(82),
            serialNumber: "SER-001",
            locationId: locationA.id,
            lotId: ids.lot,
          },
          {
            serialId: id(83),
            serialNumber: "SER-002",
            locationId: locationA.id,
            lotId: ids.lot,
          },
        ],
        availableSerialCount: 2,
      },
      {
        location: locationA,
        lot: { lotId: id(86), lotNumber: "LOT-EXP", expirationDate: "2026-10-15" },
        quantity: 2,
        reservedQuantity: 0,
        availableQuantity: 2,
        serials: [],
        availableSerialCount: 0,
      },
    ],
  };
}

function product(
  overrides: Partial<PosTraceabilitySelectorProduct> = {},
): PosTraceabilitySelectorProduct {
  return {
    productId: ids.product,
    name: "Producto trazable",
    sku: "TRZ-001",
    requiredBaseQuantity: 2,
    requiresLot: true,
    requiresSerial: false,
    requiresExpiration: true,
    ...overrides,
  };
}

function renderSelector(options?: {
  selectedProduct?: PosTraceabilitySelectorProduct;
  onCancel?: () => void;
  onConfirm?: (selections: PosApiTrackingSelection[]) => void;
}) {
  const onCancel = options?.onCancel ?? vi.fn();
  const onConfirm = options?.onConfirm ?? vi.fn();
  const selectedProduct = options?.selectedProduct ?? product();
  const view = render(
    <PosTraceabilitySelector
      open
      product={selectedProduct}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  return { ...view, onCancel, onConfirm, selectedProduct };
}

async function waitUntilLoaded(productId = ids.product) {
  await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(productId));
}

describe("PosTraceabilitySelector", () => {
  beforeEach(() => {
    mocks.state = { status: "loaded", data: inventory(), error: null, canQuery: true };
    mocks.load.mockResolvedValue(true);
  });

  it("muestra y confirma la asignación FEFO automática sin cantidades manuales", async () => {
    const { onConfirm } = renderSelector();
    await waitUntilLoaded();

    expect(screen.getByText("Asignación FEFO automática")).toBeInTheDocument();
    expect(screen.queryByLabelText("Cantidad del lote LOT-001")).not.toBeInTheDocument();
    expect(screen.getByTestId(`traceability-combination-${locationA.id}:${ids.lot}`))
      .toHaveTextContent("Asignación FEFO: 2 unidades base");
    const confirmButton = screen.getByRole("button", { name: "Usar selección" });
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({ locationId: locationA.id, lotId: ids.lot, quantity: 2 }),
    ]);
  });

  it("distribuye FEFO entre varias ubicaciones cuando el primer lote no alcanza", async () => {
    const { onConfirm } = renderSelector({
      selectedProduct: product({ requiredBaseQuantity: 5 }),
    });
    await waitUntilLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Usar selección" }));

    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({ locationId: locationA.id, lotId: ids.lot, quantity: 4 }),
      expect.objectContaining({ locationId: locationB.id, lotId: id(84), quantity: 1 }),
    ]);
  });

  it("conserva cantidades manuales para lotes sin seguimiento de vencimiento", async () => {
    const { onConfirm } = renderSelector({
      selectedProduct: product({ requiresExpiration: false }),
    });
    await waitUntilLoaded();
    fireEvent.change(screen.getByLabelText("Cantidad del lote LOT-001"), {
      target: { value: "1.25" },
    });
    fireEvent.change(screen.getByLabelText("Cantidad del lote LOT-002"), {
      target: { value: "0.75" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Usar selección" }));

    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({ locationId: locationA.id, quantity: 1.25 }),
      expect.objectContaining({ locationId: locationB.id, quantity: 0.75 }),
    ]);
  });

  it("exige completar series FEFO anteriores antes de habilitar fechas posteriores", async () => {
    const { onConfirm } = renderSelector({
      selectedProduct: product({ requiredBaseQuantity: 3, requiresSerial: true }),
    });
    await waitUntilLoaded();

    const confirmButton = screen.getByRole("button", { name: "Usar selección" });
    expect(confirmButton).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "SER-003" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "SER-001" }));
    expect(confirmButton).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "SER-003" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "SER-002" }));
    expect(confirmButton).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "SER-003" })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "SER-003" }));
    expect(confirmButton).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "SER-003" }));
    expect(confirmButton).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "SER-003" }));
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({
        locationId: locationA.id,
        lotId: ids.lot,
        serialNumbers: ["SER-001", "SER-002"],
      }),
      expect.objectContaining({
        locationId: locationB.id,
        lotId: id(84),
        serialNumbers: ["SER-003"],
      }),
    ]);
  });

  it("permite elegir series entre lotes empatados en vencimiento", async () => {
    const current = inventory();
    current.combinations[0] = {
      ...current.combinations[0],
      lot: { ...current.combinations[0].lot!, expirationDate: "2026-12-31" },
    };
    mocks.state = { status: "loaded", data: current, error: null, canQuery: true };
    const { onConfirm } = renderSelector({
      selectedProduct: product({ requiredBaseQuantity: 1, requiresSerial: true }),
    });
    await waitUntilLoaded();

    expect(screen.getByRole("checkbox", { name: "SER-003" })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "SER-003" }));
    fireEvent.click(screen.getByRole("button", { name: "Usar selección" }));
    expect(onConfirm).toHaveBeenCalledWith([
      expect.objectContaining({ locationId: locationB.id, serialNumbers: ["SER-003"] }),
    ]);
  });

  it("identifica lotes vencidos como no elegibles", async () => {
    renderSelector();
    await waitUntilLoaded();
    const expiredCard = screen.getByTestId(`traceability-combination-${locationA.id}:${id(86)}`);

    expect(within(expiredCard).getByText("Lote vencido")).toBeInTheDocument();
    expect(within(expiredCard).getByText("No elegible")).toBeInTheDocument();
    expect(within(expiredCard).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("bloquea confirmación cuando el inventario FEFO es insuficiente", async () => {
    renderSelector({ selectedProduct: product({ requiredBaseQuantity: 8 }) });
    await waitUntilLoaded();

    expect(screen.getByText("Inventario FEFO insuficiente")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usar selección" })).toBeDisabled();
  });

  it("cancela sin publicar ni conservar la selección", async () => {
    const { onCancel, onConfirm } = renderSelector({
      selectedProduct: product({ requiresExpiration: false }),
    });
    await waitUntilLoaded();
    fireEvent.change(screen.getByLabelText("Cantidad del lote LOT-001"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(mocks.close).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("diferencia errores de permisos o red de una consulta sin inventario", () => {
    mocks.state = {
      status: "error",
      data: null,
      error: "No dispone de permisos para consultar inventario trazable y ubicaciones.",
      canQuery: false,
    };
    const view = renderSelector();
    expect(screen.getByText(/No dispone de permisos/i)).toBeInTheDocument();
    expect(screen.queryByText("Sin inventario trazable disponible")).not.toBeInTheDocument();

    mocks.state = {
      status: "loaded",
      data: { ...inventory(), combinations: [] },
      error: null,
      canQuery: true,
    };
    view.rerender(
      <PosTraceabilitySelector
        open
        product={view.selectedProduct}
        onCancel={view.onCancel}
        onConfirm={view.onConfirm}
      />,
    );
    expect(screen.getByText("Sin inventario trazable disponible")).toBeInTheDocument();
  });

  it("mantiene diferenciado el estado de carga", () => {
    mocks.state = { status: "loading", data: null, error: null, canQuery: true };
    renderSelector();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Consultando ubicaciones, lotes y series disponibles",
    );
    expect(screen.queryByText("Sin inventario trazable disponible")).not.toBeInTheDocument();
  });

  it("recarga y descarta visualmente el inventario al cambiar de producto", async () => {
    const view = renderSelector();
    await waitUntilLoaded();

    const otherProductId = id(90);
    const nextProduct = product({ productId: otherProductId, name: "Otro producto" });
    view.rerender(
      <PosTraceabilitySelector
        open
        product={nextProduct}
        onCancel={view.onCancel}
        onConfirm={view.onConfirm}
      />,
    );

    await waitFor(() => expect(mocks.load).toHaveBeenCalledWith(otherProductId));
    expect(screen.queryByText("Lote LOT-001", { exact: false })).not.toBeInTheDocument();
  });
});
