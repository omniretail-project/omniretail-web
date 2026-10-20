import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PickingFefoPreviewDto } from "@/modules/logistics/application/dto/PickingReadModelDto";
import {
  areFefoSelectionsEquivalent,
  PickingFefoPreviewContent,
  sortFefoAllocations,
} from "@/modules/logistics/components/PickingFefoPreview";

const preview: PickingFefoPreviewDto = {
  pickingOrderId: "40000000-0000-4000-8000-000000000001",
  pickingLineId: "40000000-0000-4000-8000-000000000002",
  productId: "40000000-0000-4000-8000-000000000003",
  branchId: "40000000-0000-4000-8000-000000000004",
  location: { id: "40000000-0000-4000-8000-000000000005", code: "BOD-01", name: "Estante 1" },
  currentPickedQuantity: 100,
  targetPickedQuantity: 150,
  incrementalQuantity: 50,
  existingSelections: [
    { locationId: "40000000-0000-4000-8000-000000000005", locationCode: "BOD-01", locationName: "Estante 1", lotId: "40000000-0000-4000-8000-000000000006", lotNumber: "A", expirationDate: "2027-03-13", quantity: 100 },
  ],
  incrementalAllocations: [
    { locationId: "40000000-0000-4000-8000-000000000005", locationCode: "BOD-01", locationName: "Estante 1", lotId: "40000000-0000-4000-8000-000000000007", lotNumber: "B", expirationDate: "2027-11-17", quantity: 20 },
    { locationId: "40000000-0000-4000-8000-000000000005", locationCode: "BOD-01", locationName: "Estante 1", lotId: "40000000-0000-4000-8000-000000000006", lotNumber: "A", expirationDate: "2027-03-13", quantity: 130 },
  ],
  resultingSelections: [
    { locationId: "40000000-0000-4000-8000-000000000005", locationCode: "BOD-01", locationName: "Estante 1", lotId: "40000000-0000-4000-8000-000000000007", lotNumber: "B", expirationDate: "2027-11-17", quantity: 20 },
    { locationId: "40000000-0000-4000-8000-000000000005", locationCode: "BOD-01", locationName: "Estante 1", lotId: "40000000-0000-4000-8000-000000000006", lotNumber: "A", expirationDate: "2027-03-13", quantity: 30 },
  ],
  calculatedAt: "2026-10-19T14:30:00-06:00",
  provisional: true,
};

describe("PickingFefoPreview", () => {
  it("muestra progreso confirmado, incremento y lotes ordenados por FEFO", () => {
    render(<PickingFefoPreviewContent state={{ status: "loaded", data: preview, error: null }} />);
    const region = screen.getByRole("region", { name: "Lotes para la cantidad indicada" });
    const confirmedField = within(region).getByText("Cantidad recogida").closest("div");
    expect(confirmedField).not.toBeNull();
    expect(within(confirmedField!).getByText("100")).toBeInTheDocument();
    expect(within(region).getByText("Cantidad adicional: 50")).toBeInTheDocument();
    const incremental = within(region).getByRole("group", { name: "Lotes para esta recolección" });
    expect(within(incremental).getAllByText(/^Lote /).map((node) => node.textContent)).toEqual([
      "Lote A", "Lote B",
    ]);
    expect(within(incremental).getByText(/Vence 13\/03\/2027 · BOD-01 · Estante 1/)).toBeInTheDocument();
  });

  it("presenta la recomendacion para completar como una guia distinta de la captura", () => {
    render(
      <PickingFefoPreviewContent
        purpose="completion"
        state={{ status: "loaded", data: preview, error: null }}
      />,
    );
    const region = screen.getByRole("region", {
      name: "Lotes recomendados para recoger",
    });
    expect(within(region).getByText("Por recoger: 50")).toBeInTheDocument();
    expect(within(region).getByText("Cantidad pendiente")).toBeInTheDocument();
    expect(within(region).getByText("Total pendiente por recoger: 50 unidades")).toBeInTheDocument();
    const lots = within(region).getByRole("group", { name: "Lotes que debes recoger" });
    expect(within(lots).getAllByText(/^Lote /).map((node) => node.textContent)).toEqual(["Lote A", "Lote B"]);
  });

  it("presenta una recomendacion que puede resolverse con un solo lote", () => {
    const singleLotPreview: PickingFefoPreviewDto = {
      ...preview,
      incrementalQuantity: 30,
      targetPickedQuantity: 130,
      incrementalAllocations: [{ ...preview.incrementalAllocations[1], quantity: 30 }],
      resultingSelections: [{ ...preview.incrementalAllocations[1], quantity: 130 }],
    };
    render(
      <PickingFefoPreviewContent
        purpose="completion"
        state={{ status: "loaded", data: singleLotPreview, error: null }}
      />,
    );
    const lots = screen.getByRole("group", { name: "Lotes que debes recoger" });
    expect(within(lots).getAllByText(/^Lote /)).toHaveLength(1);
    expect(within(lots).getByText("Lote A")).toBeInTheDocument();
    expect(screen.getByText("Total pendiente por recoger: 30 unidades")).toBeInTheDocument();
  });

  it("distingue carga, error y reintento sin presentar asignaciones inventadas", () => {
    const retry = vi.fn();
    const view = render(<PickingFefoPreviewContent state={{ status: "loading", data: null, error: null }} />);
    expect(screen.getByText("Calculando lotes para esta cantidad")).toBeInTheDocument();
    view.rerender(<PickingFefoPreviewContent state={{ status: "error", data: null, error: "Existencia insuficiente" }} onRetry={retry} />);
    expect(screen.getByText("Existencia insuficiente")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("distingue errores de la recomendacion y no presenta distribuciones", () => {
    render(
      <PickingFefoPreviewContent
        purpose="completion"
        state={{ status: "error", data: null, error: "Stock insuficiente" }}
      />,
    );
    expect(screen.getByText("No se pudieron cargar los lotes recomendados")).toBeInTheDocument();
    expect(screen.getByText("Stock insuficiente")).toBeInTheDocument();
    expect(screen.queryByRole("region", {
      name: "Lotes recomendados para recoger",
    })).not.toBeInTheDocument();
  });

  it("ordena con desempate estable y detecta diferencias con el read-back", () => {
    expect(sortFefoAllocations(preview.incrementalAllocations).map((item) => item.lotNumber)).toEqual(["A", "B"]);
    const persisted = [{
      locationId: preview.location.id,
      lotId: preview.incrementalAllocations[0].lotId,
      quantity: 50,
    }];
    expect(areFefoSelectionsEquivalent({ ...preview, resultingSelections: persisted.map((item) => ({
      ...item, locationCode: "BOD-01", locationName: "Estante 1", lotNumber: "B", expirationDate: "2027-11-17",
    })) }, persisted)).toBe(true);
    expect(areFefoSelectionsEquivalent(preview, persisted)).toBe(false);
  });

  it("renderiza asignaciones repetidas sin claves duplicadas", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <PickingFefoPreviewContent
        state={{
          status: "loaded",
          data: {
            ...preview,
            resultingSelections: [
              preview.existingSelections[0]!,
              { ...preview.existingSelections[0]!, quantity: 30 },
            ],
          },
          error: null,
        }}
      />,
    );
    const reportedErrors = errorSpy.mock.calls.flat().join(" ");
    errorSpy.mockRestore();

    const result = screen.getByRole("group", { name: "Resultado estimado después de guardar" });
    expect(within(result).getAllByText("Lote A")).toHaveLength(2);
    expect(reportedErrors).not.toContain("same key");
  });
});
