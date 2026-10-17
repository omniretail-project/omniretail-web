import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Branch } from "@/core/entities";
import { BranchStatus, BranchType, InventoryTransferReason } from "@/core/enums";
import type { OtherBranchAvailability } from "@/core/repositories";
import type {
  InventoryProductRow,
  TransferRequestDto,
} from "@/modules/inventory/application/dto/InventoryAlertsDto";
import type { InventoryOtherBranchesService } from "@/modules/inventory/application/services/InventoryOtherBranchesService";
import { RequestTransferModal } from "@/modules/inventory/pages/InventoryAlertsPage";

const NORTH_ID = "10000000-0000-4000-8000-000000000001";
const CENTER_ID = "10000000-0000-4000-8000-000000000002";
const INACTIVE_ID = "10000000-0000-4000-8000-000000000003";

describe("RequestTransferModal API providers", () => {
  it("loads real providers and keeps only positive, different and known-active branches", async () => {
    const execute = vi.fn(async () => [
      availability(CENTER_ID, "Sucursal Centro", 100),
      availability(NORTH_ID, "Sucursal Norte", 25),
      availability(INACTIVE_ID, "Sucursal Inactiva", 50),
      availability("10000000-0000-4000-8000-000000000004", "Sucursal sin stock", 0),
    ]);
    const onSubmit = vi.fn(async () => undefined);

    renderModal({ execute, onSubmit });

    expect(screen.getByText("Cargando sucursales proveedoras...")).toBeInTheDocument();
    const providerSelect = await screen.findByLabelText("Sucursal proveedora *");
    await waitFor(() => expect(providerSelect).toHaveValue(CENTER_ID));
    expect(screen.getByRole("option", { name: "Sucursal Centro - disponible 100" })).toBeEnabled();
    expect(screen.queryByRole("option", { name: /Sucursal Norte/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Sucursal Inactiva/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Sucursal sin stock/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("100 Unidad")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Solicitar traslado" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        productId: "20000000-0000-4000-8000-000000000001",
        requesterBranchId: NORTH_ID,
        providerBranchId: CENTER_ID,
        quantity: 1,
        reason: InventoryTransferReason.replenishment,
        notes: "",
      }),
    );
    expect(execute).toHaveBeenCalledWith({
      productId: "20000000-0000-4000-8000-000000000001",
      branchId: NORTH_ID,
    });
  });

  it("shows an explicit empty state when the API has no positive provider", async () => {
    renderModal({
      execute: vi.fn(async () => [availability(CENTER_ID, "Sucursal Centro", 0)]),
    });

    expect(
      await screen.findByText("No hay sucursales proveedoras con existencias disponibles."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Solicitar traslado" })).toBeDisabled();
    expect(screen.getByLabelText("Sucursal proveedora *")).toBeDisabled();
  });

  it("shows a closed error state when the provider GET fails", async () => {
    renderModal({ execute: vi.fn(async () => Promise.reject(new Error("Red no disponible"))) });

    expect(
      await screen.findByText("No se pudieron cargar las sucursales proveedoras."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Solicitar traslado" })).toBeDisabled();
    expect(screen.getByLabelText("Sucursal proveedora *")).toBeDisabled();
  });

  it("does not let a late response from another product contaminate the current form", async () => {
    const first = deferred<OtherBranchAvailability[]>();
    const second = deferred<OtherBranchAvailability[]>();
    const execute = vi.fn(({ productId }: { productId: string }) =>
      productId.endsWith("1") ? first.promise : second.promise,
    );
    const { rerender } = render(
      modal(
        { execute },
        inventoryRow({ productId: "20000000-0000-4000-8000-000000000001" }),
      ),
    );

    rerender(
      modal(
        { execute },
        inventoryRow({
          productId: "20000000-0000-4000-8000-000000000002",
          productName: "Rodillo profesional",
          sku: "PIN-ROD-001",
        }),
      ),
    );
    await act(async () => second.resolve([availability(CENTER_ID, "Sucursal Centro", 20)]));
    await waitFor(() => expect(screen.getByLabelText("Sucursal proveedora *")).toHaveValue(CENTER_ID));

    await act(async () =>
      first.resolve([
        availability("10000000-0000-4000-8000-000000000005", "Respuesta antigua", 99),
      ]),
    );
    expect(screen.queryByRole("option", { name: /Respuesta antigua/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("Rodillo profesional")).toHaveLength(2);
    expect(screen.getByText("20 Unidad")).toBeInTheDocument();
  });

  it("validates the requested quantity against the selected API provider availability", async () => {
    const onSubmit = vi.fn(async () => undefined);
    renderModal({
      execute: vi.fn(async () => [availability(CENTER_ID, "Sucursal Centro", 5)]),
      onSubmit,
    });
    await waitFor(() => expect(screen.getByLabelText("Sucursal proveedora *")).toHaveValue(CENTER_ID));

    fireEvent.change(screen.getByLabelText("Cantidad solicitada *"), { target: { value: "6" } });

    expect(
      screen.getByText("La cantidad excede la existencia conocida de la sucursal."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Solicitar traslado" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("preserves mock providers without calling the API service", () => {
    const execute = vi.fn();
    const row = inventoryRow({
      otherBranchStocks: [
        {
          branchId: CENTER_ID,
          branchName: "Sucursal Centro mock",
          quantity: 12,
          reservedQuantity: 2,
          availableQuantity: 10,
        },
      ],
    });

    render(modal({ execute, apiMode: false }, row));

    expect(screen.getByRole("option", { name: "Sucursal Centro mock - disponible 10" })).toBeEnabled();
    expect(screen.getByText("10 Unidad")).toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
  });
});

function renderModal(options: ModalOptions = {}) {
  return render(modal(options, inventoryRow()));
}

interface ModalOptions {
  apiMode?: boolean;
  execute?: (input: { productId: string; branchId: string }) => Promise<OtherBranchAvailability[]>;
  onSubmit?: (dto: TransferRequestDto) => Promise<void>;
}

function modal(options: ModalOptions, row: InventoryProductRow) {
  const service = {
    execute: options.execute ?? vi.fn(async () => []),
  } as unknown as InventoryOtherBranchesService;
  return (
    <RequestTransferModal
      apiMode={options.apiMode ?? true}
      branches={branches()}
      key={`${row.branchId}:${row.productId}`}
      open
      providerBranchId={null}
      row={row}
      service={service}
      onClose={vi.fn()}
      onSubmit={
        options.onSubmit ??
        vi.fn(async (_dto: TransferRequestDto): Promise<void> => undefined)
      }
    />
  );
}

function availability(
  branchId: string,
  branchName: string,
  availableQuantity: number,
): OtherBranchAvailability {
  return { branchId, branchName, availableQuantity };
}

function branches(): Branch[] {
  return [
    branch(NORTH_ID, "Sucursal Norte", BranchStatus.active),
    branch(CENTER_ID, "Sucursal Centro", BranchStatus.active),
    branch(INACTIVE_ID, "Sucursal Inactiva", BranchStatus.inactive),
  ];
}

function branch(id: string, name: string, status: BranchStatus): Branch {
  return {
    id,
    tenantId: "00000000-0000-4000-8000-000000000001",
    code: id,
    name,
    type: BranchType.store,
    status,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

function inventoryRow(overrides: Partial<InventoryProductRow> = {}): InventoryProductRow {
  return {
    productId: "20000000-0000-4000-8000-000000000001",
    tenantId: "00000000-0000-4000-8000-000000000001",
    productName: 'Brocha profesional 2"',
    sku: "PIN-BRO-001",
    productType: "physical",
    inventoryMode: "TRACKED",
    displayStatus: "OUT_OF_STOCK",
    categoryId: "30000000-0000-4000-8000-000000000001",
    categoryName: "Pinturas",
    unitId: "40000000-0000-4000-8000-000000000001",
    unitName: "Unidad",
    unitAllowsDecimals: false,
    saleUnitId: "40000000-0000-4000-8000-000000000001",
    saleUnitName: "Unidad",
    sellableQuantity: 0,
    sellableReservedQuantity: 0,
    sellableAvailableQuantity: 0,
    inventoryUnitId: "40000000-0000-4000-8000-000000000001",
    inventoryUnitName: "Unidad",
    inventoryPresentationQuantity: 0,
    inventoryPresentationAvailableQuantity: 0,
    inventoryToBaseFactor: 1,
    adjustmentUnits: [],
    branchId: NORTH_ID,
    branchName: "Sucursal Norte",
    defaultLocationName: "Principal",
    locationQuantities: {},
    locationAvailableQuantities: {},
    unlocatedQuantity: 0,
    unlocatedAvailableQuantity: 0,
    tracking: { stock: true, lot: false, expiration: false, serial: false },
    availableLots: [],
    availableSerials: [],
    quantity: 0,
    reservedQuantity: 0,
    availableQuantity: 0,
    minStock: 5,
    status: "out_of_stock",
    statusLabel: "Sin existencias",
    tracksExpiration: false,
    nextExpirationLabel: "No disponible",
    activeAlerts: [],
    otherBranchStocks: [],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
