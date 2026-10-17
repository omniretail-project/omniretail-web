import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CashShiftStatus, ProductType } from "@/core/enums";
import type { PosProductDto } from "@/modules/pos/application/dto/PosProductDto";
import type { PosTraceabilityInventoryDto } from "@/modules/pos/application/dto/PosTraceabilityInventoryDto";
import { PosTerminalPage } from "@/modules/pos/pages/PosTerminalPage";
import { id, ids } from "./posFixtures";

const mocks = vi.hoisted(() => ({
  repositories: {} as object,
  branch: {} as {
    currentBranch: { id: string; tenantId: string; name: string } | null;
    loading: boolean;
  },
  session: {} as {
    sessionId: string | null;
    user: { id: string; tenantId: string } | null;
    canAccessBranch: (branchId: string) => boolean;
    hasPermission: (permission: string) => boolean;
    loading: boolean;
    error: string | null;
  },
  products: vi.fn(),
  openShift: vi.fn(),
  bankAccounts: vi.fn(),
  inventory: vi.fn(),
  confirm: vi.fn(),
  capabilities: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => mocks.repositories,
}));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => mocks.session,
}));
vi.mock("@/shared/navigation/PrivateHeader/ActiveBranchProvider", () => ({
  useActiveBranch: () => mocks.branch,
}));
vi.mock("@/shared/hooks/useEntitlement", () => ({
  useEntitlement: () => ({ hasCapability: () => true }),
}));
vi.mock("@/shared/hooks/useDataEvent", () => ({
  useDataEvent: () => undefined,
}));
vi.mock("@/modules/pos/application/services/GetPosProductsService", () => ({
  GetPosProductsService: class {
    execute(input: unknown) {
      return mocks.products(input);
    }
  },
}));
vi.mock("@/modules/pos/application/services/GetOpenCashShiftService", () => ({
  GetOpenCashShiftService: class {
    execute(input: unknown) {
      return mocks.openShift(input);
    }
  },
}));
vi.mock("@/modules/pos/application/services/GetCheckoutBankAccountsService", () => ({
  GetCheckoutBankAccountsService: class {
    execute(input: unknown) {
      return mocks.bankAccounts(input);
    }
  },
}));
vi.mock("@/modules/pos/application/services/GetPosTraceabilityInventoryService", () => ({
  POS_TRACEABILITY_STOCK_PERMISSION: "inventory.stock.read",
  POS_TRACEABILITY_LOCATIONS_PERMISSION: "catalog.locations.read",
  GetPosTraceabilityInventoryService: class {
    execute(input: unknown) {
      return mocks.inventory(input);
    }
  },
}));
vi.mock("@/modules/pos/application/services/ConfirmSaleService", () => ({
  ConfirmSaleService: class {
    execute(input: { beforeSend?: () => void }) {
      const { beforeSend, ...request } = input;
      beforeSend?.();
      return mocks.confirm(request);
    }
  },
}));

// Estos flujos tienen suites propias; aquí se mantienen fuera para integrar catálogo, hook,
// ticket y selector de trazabilidad sin simular las piezas bajo prueba.
vi.mock("@/modules/pos/components/CheckoutModal", () => ({ CheckoutModal: () => null }));
vi.mock("@/modules/pos/components/PendingSaleBanner", () => ({ PendingSaleBanner: () => null }));
vi.mock("@/modules/pos/components/PosSalesHistoryModal", () => ({
  PosSalesHistoryModal: () => null,
}));

const ordinaryProduct: PosProductDto = {
  productId: ids.product,
  sku: "POS-001",
  name: "Producto ordinario",
  productType: ProductType.physical,
  basePrice: 25,
  effectivePrice: 25,
  discount: 0,
  salesPriceTiers: [],
  availableQuantity: 10,
  baseUnitId: id(50),
  saleUnitId: id(50),
  saleUnitName: "Unidad",
  saleUnitToBaseFactor: 1,
  tracksStock: true,
  requiresLot: false,
  requiresSerial: false,
  requiresExpiration: false,
  requiresTraceabilitySelection: false,
  requiresUnsupportedTraceability: false,
  isAvailableForSale: true,
};

const traceableProduct: PosProductDto = {
  ...ordinaryProduct,
  productId: id(90),
  sku: "POS-TRZ-001",
  name: "Producto trazable",
  availableQuantity: 2,
  saleUnitId: id(51),
  saleUnitName: "Caja",
  saleUnitToBaseFactor: 2,
  requiresLot: true,
  requiresSerial: true,
  requiresExpiration: true,
  requiresTraceabilitySelection: true,
};

const incompatibleProduct: PosProductDto = {
  ...traceableProduct,
  productId: id(91),
  sku: "POS-KIT-001",
  name: "Kit trazable incompatible",
  productType: ProductType.kit,
  requiresTraceabilitySelection: false,
  requiresUnsupportedTraceability: true,
  isAvailableForSale: false,
};

function inventory(
  productId = traceableProduct.productId,
  branchId = ids.branch,
): PosTraceabilityInventoryDto {
  const location = { id: ids.location, code: "A-01", name: "Estante A", type: "shelf" as const };
  const lot = {
    lotId: ids.lot,
    lotNumber: "LOT-001",
    expirationDate: "2027-12-31",
  };
  const serials = [1, 2, 3, 4].map((suffix) => ({
    serialId: id(100 + suffix),
    serialNumber: `SER-00${suffix}`,
    locationId: location.id,
    lotId: lot.lotId,
  }));
  return {
    branchId,
    productId,
    businessDate: "2026-10-17",
    locations: [location],
    lots: [
      {
        ...lot,
        locationId: location.id,
        quantity: 4,
        reservedQuantity: 0,
        availableQuantity: 4,
      },
    ],
    serials,
    combinations: [
      {
        location,
        lot,
        quantity: 4,
        reservedQuantity: 0,
        availableQuantity: 4,
        serials,
        availableSerialCount: 4,
      },
    ],
  };
}

function productCard(name: string) {
  return screen.getByText(name).closest("li") as HTMLElement;
}

function ticket() {
  return screen.getByRole("heading", { name: "Ticket de venta" }).closest("aside") as HTMLElement;
}

async function renderReadyPage() {
  const view = render(<PosTerminalPage />);
  await screen.findByText(ordinaryProduct.name);
  await screen.findByText(traceableProduct.name);
  return view;
}

async function addTraceableLine() {
  fireEvent.click(within(productCard(traceableProduct.name)).getByRole("button", { name: "Seleccionar" }));
  await screen.findByRole("heading", { name: "Seleccionar inventario físico" });
  fireEvent.click(await screen.findByRole("checkbox", { name: "SER-001" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "SER-002" }));
  fireEvent.click(screen.getByRole("button", { name: "Usar selección" }));
  await waitFor(() =>
    expect(within(ticket()).getByText(/Selección física preparada: 2 unidades base/)).toBeInTheDocument(),
  );
}

describe("PosTerminalPage integración trazable", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mocks.repositories = {
      inventoryStockDataSource: "api",
      businessConfig: { getCapabilities: mocks.capabilities },
    };
    mocks.branch = {
      currentBranch: { id: ids.branch, tenantId: ids.tenant, name: "Centro" },
      loading: false,
    };
    mocks.session = {
      sessionId: ids.session,
      user: { id: ids.user, tenantId: ids.tenant },
      canAccessBranch: () => true,
      hasPermission: () => true,
      loading: false,
      error: null,
    };
    mocks.products.mockResolvedValue([ordinaryProduct, traceableProduct, incompatibleProduct]);
    mocks.openShift.mockResolvedValue({
      id: ids.shift,
      branchId: ids.branch,
      userId: ids.user,
      registerCode: "POS-01",
      status: CashShiftStatus.open,
      openedAt: "2026-10-17T08:00:00.000Z",
      openingAmount: 100,
    });
    mocks.bankAccounts.mockResolvedValue([]);
    mocks.capabilities.mockResolvedValue({ allowedPosPaymentMethods: ["cash"] });
    mocks.inventory.mockImplementation(
      ({ productId, branchId }: { productId: string; branchId: string }) =>
        Promise.resolve(inventory(productId, branchId)),
    );
  });

  it("renderiza el terminal, carga productos y agrega un producto ordinario al ticket", async () => {
    const pendingProducts = deferred<PosProductDto[]>();
    mocks.products.mockReturnValueOnce(pendingProducts.promise);
    render(<PosTerminalPage />);

    expect(screen.getByRole("heading", { name: "Terminal de Cobro" })).toBeInTheDocument();
    expect(screen.getByText("Cargando productos...")).toBeInTheDocument();
    await act(async () => {
      pendingProducts.resolve([ordinaryProduct, traceableProduct, incompatibleProduct]);
    });
    await screen.findByText(ordinaryProduct.name);
    fireEvent.click(within(productCard(ordinaryProduct.name)).getByRole("button", { name: "Agregar" }));

    expect(within(ticket()).getByText(ordinaryProduct.name)).toBeInTheDocument();
    expect(within(ticket()).getByText("1 producto")).toBeInTheDocument();
  });

  it("abre el selector para un trazable y cancelar no modifica el ticket", async () => {
    await renderReadyPage();

    fireEvent.click(within(productCard(traceableProduct.name)).getByRole("button", { name: "Seleccionar" }));
    expect(await screen.findByRole("heading", { name: "Seleccionar inventario físico" })).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.inventory).toHaveBeenCalledWith({
        branchId: ids.branch,
        productId: traceableProduct.productId,
        locationId: undefined,
        lotId: undefined,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Seleccionar inventario físico" })).not.toBeInTheDocument(),
    );
    expect(within(ticket()).getByText("Tu ticket está vacío")).toBeInTheDocument();
  });

  it("incorpora ubicación, lote y series, y conserva la línea al cancelar una reselección", async () => {
    await renderReadyPage();
    await addTraceableLine();

    expect(screen.queryByRole("heading", { name: "Seleccionar inventario físico" })).not.toBeInTheDocument();
    fireEvent.click(
      within(ticket()).getByRole("button", { name: `Aumentar cantidad de ${traceableProduct.name}` }),
    );
    expect(await screen.findByText("Debes seleccionar 4 unidades base")).toBeInTheDocument();
    expect(within(ticket()).getByRole("textbox", { name: `Cantidad de ${traceableProduct.name}` })).toHaveValue("1");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(within(ticket()).getByText(/Selección física preparada: 2 unidades base/)).toBeInTheDocument();
    expect(within(ticket()).getByRole("textbox", { name: `Cantidad de ${traceableProduct.name}` })).toHaveValue("1");
  });

  it("invalida la línea trazable cuando cambia la sucursal", async () => {
    const view = await renderReadyPage();
    await addTraceableLine();

    mocks.branch = {
      currentBranch: { id: ids.otherBranch, tenantId: ids.tenant, name: "Norte" },
      loading: false,
    };
    view.rerender(<PosTerminalPage />);

    await waitFor(() => expect(within(ticket()).getByText("Tu ticket está vacío")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "Seleccionar inventario físico" })).not.toBeInTheDocument();
  });

  it("mantiene bloqueados los productos trazables incompatibles", async () => {
    await renderReadyPage();
    const card = productCard(incompatibleProduct.name);

    expect(within(card).getByText("Este producto requiere un proceso de venta distinto.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "No disponible" })).toBeDisabled();
  });
});
