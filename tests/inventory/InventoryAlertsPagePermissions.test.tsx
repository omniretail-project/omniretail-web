import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InventoryProductRow } from "@/modules/inventory/application/dto/InventoryAlertsDto";
import {
  INVENTORY_MOVEMENTS_READ_PERMISSION,
  INVENTORY_STOCK_READ_PERMISSION,
} from "@/modules/inventory/application/services/serviceHelpers";

const state = vi.hoisted(() => ({
  permissions: [] as string[],
  capabilities: { inventory: true, purchasing: false } as Record<string, boolean>,
  alertsState: {} as Record<string, unknown>,
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn() }),
  usePathname: () => "/inventario/alertas",
  // El panel de detalle con las acciones del producto solo se monta con ?productId= en la URL.
  useSearchParams: () => new URLSearchParams("panel=product-detail&productId=prod-1"),
}));
vi.mock("@/shared/components/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => ({
    hasPermission: (p: string) => state.permissions.includes(p),
  }),
}));
vi.mock("@/shared/hooks/useEntitlement", () => ({
  useEntitlement: () => ({
    hasCapability: (c: string) => state.capabilities[c] ?? true,
  }),
}));
vi.mock("@/modules/inventory/hooks/useInventoryAlerts", () => ({
  useInventoryAlerts: () => state.alertsState,
}));
vi.mock("@/modules/inventory/components/TraceableCountFlow", () => ({
  TraceableCountFlow: () => <div data-testid="traceable-count-flow" />,
}));
vi.mock("@/modules/inventory/components/InventoryProductTransfersModal", () => ({
  InventoryProductTransfersModal: ({ productId }: { productId: string }) => (
    <div data-testid="product-transfers-modal">{productId}</div>
  ),
}));

import { InventoryAlertsPage } from "@/modules/inventory/pages/InventoryAlertsPage";

function sampleRow(overrides: Partial<InventoryProductRow> = {}): InventoryProductRow {
  return {
    productId: "prod-1",
    productName: "Taladro Percutor",
    sku: "TAL-001",
    inventoryMode: "TRACKED",
    displayStatus: "normal",
    productType: "standard",
    categoryId: "cat-1",
    categoryName: "Herramientas",
    unitId: "unit-1",
    unitName: "Unidad",
    unitAllowsDecimals: false,
    saleUnitId: "unit-1",
    saleUnitName: "Unidad",
    sellableQuantity: 10,
    sellableReservedQuantity: 0,
    sellableAvailableQuantity: 10,
    inventoryUnitId: "unit-1",
    inventoryUnitName: "Unidad",
    inventoryPresentationQuantity: 10,
    inventoryPresentationAvailableQuantity: 10,
    inventoryToBaseFactor: 1,
    adjustmentUnits: [],
    branchId: "branch-1",
    branchName: "Sucursal Centro",
    defaultLocationId: "loc-1",
    defaultLocationName: "Estantería A",
    requiresRegularization: false,
    ...overrides,
  } as InventoryProductRow;
}

function createAlertsState(overrides: Record<string, unknown> = {}) {
  const row = sampleRow();
  return {
    data: {
      rows: [row],
      alerts: [],
      alertTotalItems: 0,
      transferRequests: [],
      visibility: {
        supportsExpiration: false,
        hasExpirationProducts: false,
        showExpirationFeatures: false,
      },
    },
    detailRow: row,
    kpis: { activeProducts: 1, lowStock: 0, expiringSoon: 0, outOfStock: 0 },
    rows: [row],
    paginatedRows: [row],
    totalItems: 1,
    totalPages: 1,
    page: 1,
    pageSize: 10,
    apiMode: true,
    branchId: "branch-1",
    currentBranchId: "branch-1",
    activeBranch: { id: "branch-1", name: "Sucursal Centro", tenantId: "tenant-1" },
    branches: [{ id: "branch-1", name: "Sucursal Centro", tenantId: "tenant-1" }],
    categories: [],
    locations: [],
    search: "",
    categoryId: "all",
    status: "all",
    kpiFilter: "all",
    filtersOpen: false,
    loading: false,
    busy: false,
    error: null,
    lastUpdatedAt: new Date(),
    setBranchId: vi.fn(),
    setSearch: vi.fn(),
    setCategoryId: vi.fn(),
    setStatus: vi.fn(),
    setKpiFilter: vi.fn(),
    setFiltersOpen: vi.fn(),
    setPage: vi.fn(),
    setPageSize: vi.fn(),
    loadAlerts: vi.fn(),
    loadProductRow: vi.fn(),
    adjustmentLookup: null,
    supportsMultipleLocations: true,
    countService: {},
    otherBranchesService: {},
    kitAvailabilityService: {},
    applyCount: vi.fn(),
    canAdjustStock: false,
    canManageTransfers: false,
    adjustStock: vi.fn(),
    requestTransfer: vi.fn(),
    cancelTransfer: vi.fn(),
    cancelTransferRequest: vi.fn(),
    approveTransferRequest: vi.fn(),
    rejectTransferRequest: vi.fn(),
    ...overrides,
  };
}

function openPanelActions() {
  fireEvent.click(screen.getAllByRole("button", { name: /^Acciones$/ })[0]);
}

function rowActionsButtons() {
  return screen.queryAllByRole("button", { name: "Acciones de Taladro Percutor" });
}

describe("InventoryAlertsPage permission guards", () => {
  it("oculta las acciones de movimientos y traslados para roles operativos sin permisos", () => {
    state.permissions = [INVENTORY_STOCK_READ_PERMISSION];
    state.alertsState = createAlertsState({
      canAdjustStock: false,
      canManageTransfers: false,
    });

    render(<InventoryAlertsPage />);
    openPanelActions();

    expect(screen.getAllByText("Ver existencias en otras sucursales").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ver historial de movimientos")).not.toBeInTheDocument();
    expect(screen.queryByText("Ver solicitudes y traslados")).not.toBeInTheDocument();
    expect(rowActionsButtons()).toHaveLength(0);
  });

  it("muestra el historial de movimientos y solicitudes cuando el usuario tiene permisos", () => {
    state.permissions = [INVENTORY_STOCK_READ_PERMISSION, INVENTORY_MOVEMENTS_READ_PERMISSION];
    state.alertsState = createAlertsState({
      canAdjustStock: false,
      canManageTransfers: true,
    });

    render(<InventoryAlertsPage />);
    openPanelActions();

    expect(screen.getAllByText("Ver historial de movimientos").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ver solicitudes y traslados").length).toBeGreaterThan(0);

    const [rowActions] = rowActionsButtons();
    expect(rowActions).toBeDefined();
    fireEvent.click(rowActions);

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Historial de movimientos")).toBeInTheDocument();
    expect(within(menu).getByText("Solicitar traslado")).toBeInTheDocument();
    expect(within(menu).queryByText("Ajustar existencias")).not.toBeInTheDocument();

    state.push.mockClear();
    fireEvent.click(within(menu).getByText("Historial de movimientos"));

    expect(state.push).toHaveBeenCalledWith(
      "/inventario/movimientos?productId=prod-1&branchId=branch-1",
    );
  });

  it("navega al historial filtrado por producto y sucursal desde el panel", () => {
    state.push.mockClear();
    state.permissions = [INVENTORY_STOCK_READ_PERMISSION, INVENTORY_MOVEMENTS_READ_PERMISSION];
    state.alertsState = createAlertsState({ canAdjustStock: false, canManageTransfers: false });

    render(<InventoryAlertsPage />);
    openPanelActions();
    fireEvent.click(screen.getAllByText("Ver historial de movimientos")[0]);

    expect(state.push).toHaveBeenCalledWith(
      "/inventario/movimientos?productId=prod-1&branchId=branch-1",
    );
  });

  it("abre las solicitudes y traslados del producto cuando puede gestionar traslados", () => {
    state.permissions = [INVENTORY_STOCK_READ_PERMISSION];
    state.alertsState = createAlertsState({ canAdjustStock: false, canManageTransfers: true });

    render(<InventoryAlertsPage />);
    openPanelActions();
    fireEvent.click(screen.getAllByText("Ver solicitudes y traslados")[0]);

    expect(screen.getByTestId("product-transfers-modal")).toHaveTextContent("prod-1");
  });

  it("ofrece el ajuste en el menu contextual solo con permiso de ajuste", () => {
    state.permissions = [INVENTORY_STOCK_READ_PERMISSION];
    state.alertsState = createAlertsState({ canAdjustStock: true, canManageTransfers: false });

    render(<InventoryAlertsPage />);
    fireEvent.click(rowActionsButtons()[0]);

    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Ajustar existencias")).toBeInTheDocument();
    expect(within(menu).queryByText("Historial de movimientos")).not.toBeInTheDocument();
    expect(within(menu).queryByText("Solicitar traslado")).not.toBeInTheDocument();
  });
});
