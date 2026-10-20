import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InventoryMovementType } from "@/core/enums";
import type { InventoryMovementRow } from "@/modules/inventory/application/dto/InventoryMovementsDto";
import { InventoryMovementsPage } from "@/modules/inventory/pages/InventoryMovementsPage";

const { useInventoryMovementsMock } = vi.hoisted(() => ({
  useInventoryMovementsMock: vi.fn(),
}));

vi.mock("@/modules/inventory/hooks/useInventoryMovements", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/inventory/hooks/useInventoryMovements")>();
  return { ...actual, useInventoryMovements: useInventoryMovementsMock };
});

vi.mock("@/modules/inventory/application/services/exportInventoryMovementsXlsx", () => ({
  exportInventoryMovementsXlsx: vi.fn(),
}));

const transferMovement: InventoryMovementRow = {
  id: "movement-transfer",
  tenantId: "tenant-1",
  branchId: "branch-1",
  branchName: "Sucursal Centro",
  productId: "product-1",
  productName: "Producto trasladado",
  sku: "SKU-001",
  type: InventoryMovementType.out,
  displayType: "out",
  typeLabel: "Salida",
  typeTone: "danger",
  quantity: 5,
  signedQuantity: -5,
  quantityBefore: 10,
  quantityAfter: 5,
  unitLabel: "Unidad",
  locationLabel: "Bodega",
  referenceType: undefined,
  referenceId: "a60a028c-12c1-4013-8493-66cdda7e85bf",
  referenceLabel: "a60a028c-12c1-4013-8493-66cdda7e85bf",
  userLabel: "Operador",
  reason: "Salida por traslado TR-2026-00003",
  createdAt: "2026-10-19T12:00:00-06:00",
};

const storePickupMovement: InventoryMovementRow = {
  ...transferMovement,
  id: "movement-store-pickup",
  productName: "Acetaminofén 400MG Tableta",
  referenceType: undefined,
  referenceId: "15bf47f2-e7c2-498f-8c25-94b8913c1a5b",
  referenceLabel: "15bf47f2-e7c2-498f-8c25-94b8913c1a5b",
  reason: "Retiro en tienda entregado al cliente",
};

const transferEntryMovement: InventoryMovementRow = {
  ...transferMovement,
  id: "movement-transfer-in",
  productName: "Billetera Doble",
  type: InventoryMovementType.in,
  displayType: "in",
  typeLabel: "Entrada por traslado",
  signedQuantity: 5,
  referenceType: undefined,
  reason: "Recepción de traslado TR-2026-00003",
};

function mockInventoryMovements(rows: InventoryMovementRow[]) {
  useInventoryMovementsMock.mockReturnValue({
    data: {
      rows,
      branches: [{ id: "branch-1", name: "Sucursal Centro" }],
    },
    paginatedRows: rows,
    kpis: { incoming: 0, outgoing: 5, net: -5 },
    loading: false,
    error: null,
    search: "",
    period: "30d",
    type: "all",
    branchId: "branch-1",
    productId: "",
    productName: "",
    productSku: "",
    filtersOpen: false,
    page: 1,
    pageSize: 20,
    totalItems: rows.length,
    totalPages: 1,
    apiMode: true,
    loadExportData: vi.fn(),
    setSearch: vi.fn(),
    setPeriod: vi.fn(),
    setType: vi.fn(),
    setBranchId: vi.fn(),
    setProductId: vi.fn(),
    setFiltersOpen: vi.fn(),
    setPage: vi.fn(),
    setPageSize: vi.fn(),
  });
}

describe("presentacion del historial de movimientos", () => {
  beforeEach(() => {
    mockInventoryMovements([transferMovement]);
  });

  it("usa el mismo tipo y referencia comercial en la tabla y el detalle", () => {
    render(<InventoryMovementsPage />);

    const tableRow = screen.getByText("Producto trasladado").closest("tr");
    expect(tableRow).not.toBeNull();
    expect(within(tableRow!).getByText("Salida por traslado")).toBeInTheDocument();
    expect(within(tableRow!).getByText("TR-2026-00003")).toBeInTheDocument();

    fireEvent.click(tableRow!);

    const detail = screen.getByRole("dialog", { name: "Detalle de movimiento historico" });
    expect(within(detail).getByRole("heading", { name: "TR-2026-00003" })).toBeInTheDocument();
    expect(within(detail).getByText("Salida por traslado")).toBeInTheDocument();
    expect(within(detail).getAllByText("TR-2026-00003")).toHaveLength(2);
    expect(within(detail).getByText("Salida por traslado TR-2026-00003")).toBeInTheDocument();
  });

  it("presenta el retiro en tienda real en la tabla y el detalle", () => {
    mockInventoryMovements([storePickupMovement]);
    render(<InventoryMovementsPage />);

    const tableRow = screen.getByText("Acetaminofén 400MG Tableta").closest("tr");
    expect(tableRow).not.toBeNull();
    expect(within(tableRow!).getByText("Salida por entrega en tienda")).toBeInTheDocument();
    expect(within(tableRow!).getByText("Retiro en tienda")).toBeInTheDocument();

    fireEvent.click(tableRow!);

    const detail = screen.getByRole("dialog", { name: "Detalle de movimiento historico" });
    expect(within(detail).getByRole("heading", { name: "Retiro en tienda" })).toBeInTheDocument();
    expect(within(detail).getByText("Salida por entrega en tienda")).toBeInTheDocument();
    expect(within(detail).getAllByText("Retiro en tienda")).toHaveLength(2);
    expect(within(detail).getByText("Retiro en tienda entregado al cliente")).toBeInTheDocument();
  });

  it("presenta la referencia comercial de una entrada por traslado en tabla y detalle", () => {
    mockInventoryMovements([transferEntryMovement]);
    render(<InventoryMovementsPage />);

    const tableRow = screen.getByText("Billetera Doble").closest("tr");
    expect(tableRow).not.toBeNull();
    expect(within(tableRow!).getByText("Entrada por traslado")).toBeInTheDocument();
    expect(within(tableRow!).getByText("TR-2026-00003")).toBeInTheDocument();

    fireEvent.click(tableRow!);

    const detail = screen.getByRole("dialog", { name: "Detalle de movimiento historico" });
    expect(within(detail).getByRole("heading", { name: "TR-2026-00003" })).toBeInTheDocument();
    expect(within(detail).getByText("Entrada por traslado")).toBeInTheDocument();
    expect(within(detail).getAllByText("TR-2026-00003")).toHaveLength(2);
    expect(within(detail).getByText("Recepción de traslado TR-2026-00003")).toBeInTheDocument();
  });
});
