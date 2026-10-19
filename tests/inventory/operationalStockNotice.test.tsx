import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InventoryProductRow } from "@/modules/inventory/application/dto/InventoryAlertsDto";
import { OperationalStockNotice } from "@/modules/inventory/pages/InventoryAlertsPage";

function row(overrides: Partial<InventoryProductRow>): InventoryProductRow {
  return {
    defaultLocationId: "loc-a",
    requiresRegularization: false,
    ...overrides,
  } as InventoryProductRow;
}

const UNASSIGNED_MESSAGE =
  "Sin ubicacion operativa asignada: el producto no puede recibir, reservar ni vender existencias.";
const LEGACY_MESSAGE =
  "Stock heredado: el producto conserva existencias fuera de su ubicacion operativa.";

describe("OperationalStockNotice", () => {
  it("shows nothing when the product has an operational location and no stock outside it", () => {
    const { container } = render(<OperationalStockNotice canRegularize row={row({})} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("does not claim legacy stock when the backend could not determine it", () => {
    const { container } = render(
      <OperationalStockNotice canRegularize row={row({ requiresRegularization: null })} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("warns that a product without operational location cannot receive, reserve or sell", () => {
    render(
      <OperationalStockNotice
        canRegularize
        row={row({ defaultLocationId: undefined, requiresRegularization: false })}
      />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(UNASSIGNED_MESSAGE);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("warns about legacy stock and links to the explicit regularization when allowed", () => {
    render(<OperationalStockNotice canRegularize row={row({ requiresRegularization: true })} />);

    expect(screen.getByRole("note")).toHaveTextContent(LEGACY_MESSAGE);
    expect(screen.getByRole("link", { name: "Ir a regularizacion de ubicaciones" })).toHaveAttribute(
      "href",
      "/inventario/regularizacion",
    );
  });

  it("explains the legacy stock but hides the regularization link without permission", () => {
    render(
      <OperationalStockNotice canRegularize={false} row={row({ requiresRegularization: true })} />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(LEGACY_MESSAGE);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("prioritizes the missing assignment message when both conditions apply", () => {
    render(
      <OperationalStockNotice
        canRegularize
        row={row({ defaultLocationId: null, requiresRegularization: true })}
      />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(UNASSIGNED_MESSAGE);
    expect(screen.getByRole("link", { name: "Ir a regularizacion de ubicaciones" })).toBeInTheDocument();
  });
});
