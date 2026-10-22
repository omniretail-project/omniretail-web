import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageLocation } from "@/core/entities";
import { LocationStatus, ProductType } from "@/core/enums";
import { demoSeedDatabase } from "@/infrastructure/mock/seeds/demoSeed";
import type { ProductEditorData } from "@/modules/catalog/application/dto/ProductEditorDto";
import { ProductForm } from "@/modules/catalog/components/ProductForm";
import type { ProductFormOptions } from "@/modules/catalog/types/catalog.types";

/**
 * ProductForm REAL: el cableado entre la configuracion de inventario de la sucursal activa, el
 * bloqueo de ubicacion (useProductLocationLock) y el selector. Se simulan solo el registro de
 * repositorios, la sesion, los entitlements y la carga diferida de ubicaciones.
 */
const mocks = vi.hoisted(() => ({
  getProductInventorySettings: vi.fn(),
  getProductBalances: vi.fn(),
  locations: { current: [] as unknown[] },
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => ({
    inventory: {
      getProductInventorySettings: mocks.getProductInventorySettings,
      getProductBalances: mocks.getProductBalances,
    },
  }),
  useDataEventBus: () => ({ subscribe: () => () => undefined }),
}));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => ({ user: { tenantId: "tenant-1" } }),
}));
vi.mock("@/shared/hooks/useEntitlement", () => ({
  useEntitlement: () => ({ hasCapability: () => true, limits: {} }),
}));
vi.mock("@/modules/catalog/hooks/useProductEditorDeferredData", () => ({
  useProductEditorKitEligibleProducts: () => ({ status: "idle", data: null, error: null, retry: async () => undefined }),
  useProductEditorLocations: ({ enabled }: { enabled: boolean }) => ({
    ...(enabled
      ? {
          status: "loaded",
          data: { branchLocations: mocks.locations.current, storageLocations: mocks.locations.current },
          error: null,
        }
      : { status: "idle", data: null, error: null }),
    retry: async () => undefined,
  }),
}));

const TENANT = "tenant-1";
const NORTH = "branch-north";
const TS = "2026-10-09T12:00:00.000Z";

function location(id: string): StorageLocation {
  return {
    id,
    tenantId: TENANT,
    branchId: NORTH,
    code: id.toUpperCase(),
    name: `Estante ${id}`,
    type: "shelf",
    status: LocationStatus.active,
    createdAt: TS,
    updatedAt: TS,
  };
}

const seedProduct = demoSeedDatabase.products.find((item) => item.productType === ProductType.physical);
const seedCategory = demoSeedDatabase.categories[0];
const seedUnit = demoSeedDatabase.units[0];
const seedCapabilities = demoSeedDatabase.businessCapabilities[0];

const options: ProductFormOptions = {
  categories: [seedCategory],
  units: [seedUnit],
  businessCapabilities: {
    ...seedCapabilities,
    supportsInventory: true,
    supportsLots: true,
    supportsExpiration: true,
    supportsSerials: true,
    supportsMultipleLocations: true,
  },
};

function editorData(overrides: Partial<ProductEditorData["access"]> = {}): ProductEditorData {
  if (!seedProduct) throw new Error("La semilla demo no trae productos fisicos.");
  const product = {
    ...seedProduct,
    id: "product-pr",
    tenantId: TENANT,
    categoryId: seedCategory.id,
    baseUnitId: seedUnit.id,
    inventoryUnitId: seedUnit.id,
    saleUnitId: seedUnit.id,
    // Producto trazable: lote + vencimiento (como el PR del caso real).
    tracking: { stock: true, lot: true, expiration: true, serial: false },
  };
  return {
    access: {
      apiMode: true,
      canUpdateProductRelations: true,
      canReadConversions: false,
      canManageConversions: false,
      canReadAttributes: false,
      canManageAttributes: false,
      canManageSuppliers: false,
      canReadLocations: true,
      canReadInventorySettings: true,
      canReadPromotions: false,
      canManagePromotions: false,
      ...overrides,
    },
    detail: { product, category: seedCategory, unit: seedUnit },
    storageLocations: [],
    branchLocations: [],
    suppliers: [],
    supplierProducts: [],
    media: [],
    kitComponents: [],
    kitEligibleProducts: [],
  };
}

function settings(defaultLocationId: string | undefined) {
  return {
    id: "settings-1",
    tenantId: TENANT,
    productId: "product-pr",
    branchId: NORTH,
    minStock: 2,
    reorderPoint: 5,
    defaultLocationId,
    createdAt: TS,
    updatedAt: TS,
  };
}

function balance(quantity: number, reservedQuantity = 0) {
  return {
    id: `balance-${quantity}`,
    tenantId: TENANT,
    branchId: NORTH,
    productId: "product-pr",
    quantity,
    reservedQuantity,
    updatedAt: TS,
  };
}

async function openInventoryTab(data: ProductEditorData = editorData()) {
  const onSubmit = vi.fn(async () => undefined);
  render(
    <ProductForm branchId={NORTH} editorData={data} mode="edit" onSubmit={onSubmit} options={options} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Inventario y trazabilidad/ }));
  return { onSubmit };
}

const select = () => screen.getByLabelText("Ubicación operativa") as HTMLSelectElement;

beforeEach(() => {
  mocks.getProductInventorySettings.mockReset();
  mocks.getProductBalances.mockReset();
  mocks.locations.current = [location("n1"), location("n2")];
});

describe("ProductForm with a lot + expiration product (real form wiring)", () => {
  it("offers the FIRST location in a branch without one when that branch holds no stock", async () => {
    mocks.getProductInventorySettings.mockResolvedValue(null);
    mocks.getProductBalances.mockResolvedValue([]);

    await openInventoryTab();

    await waitFor(() => expect(select()).not.toBeDisabled());
    expect(screen.getByText(/Asignación inicial/)).toBeInTheDocument();
    expect(mocks.getProductInventorySettings).toHaveBeenCalledWith("product-pr", NORTH);
    expect(mocks.getProductBalances).toHaveBeenCalledWith("product-pr", NORTH, TENANT, { fresh: true });
  });

  it("submits the chosen location together with the existing minimum and reorder point", async () => {
    mocks.getProductInventorySettings.mockResolvedValue(settings(undefined));
    mocks.getProductBalances.mockResolvedValue([balance(0)]);
    const { onSubmit } = await openInventoryTab();
    await waitFor(() => expect(select()).not.toBeDisabled());

    fireEvent.change(select(), { target: { value: "n2" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const dto = (onSubmit.mock.calls[0] as unknown as [{ inventorySettings: Record<string, unknown> }])[0];
    expect(dto.inventorySettings).toMatchObject({
      branchId: NORTH,
      minStock: 2,
      reorderPoint: 5,
      defaultLocationId: "n2",
    });
  });

  it("blocks the first assignment when THIS branch has stock or reservations", async () => {
    mocks.getProductInventorySettings.mockResolvedValue(null);
    mocks.getProductBalances.mockResolvedValue([balance(4)]);

    await openInventoryTab();

    await waitFor(() => expect(screen.getByRole("link", { name: /regularización/ })).toBeInTheDocument());
    expect(select()).toBeDisabled();
  });

  it("keeps changing an EXISTING location blocked for the traceable product, without reading balances", async () => {
    mocks.getProductInventorySettings.mockResolvedValue(settings("n1"));

    await openInventoryTab();

    await waitFor(() => expect(select().value).toBe("n1"));
    expect(select()).toBeDisabled();
    expect(screen.getByText(/lote, serie o vencimiento/)).toBeInTheDocument();
    expect(mocks.getProductBalances).not.toHaveBeenCalled();
  });

  it("locks safely when the branch settings cannot be read", async () => {
    mocks.getProductInventorySettings.mockRejectedValue(new Error("fallo de red"));

    await openInventoryTab();

    await waitFor(() => expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument());
    expect(screen.queryByLabelText("Ubicación operativa")).toBeNull();
    expect(mocks.getProductBalances).not.toHaveBeenCalled();
  });

  it("does not show the selector, nor read anything, when the user cannot read inventory", async () => {
    mocks.getProductInventorySettings.mockResolvedValue(null);

    await openInventoryTab(editorData({ canReadInventorySettings: false }));

    expect(screen.queryByLabelText("Ubicación operativa")).toBeNull();
    expect(mocks.getProductBalances).not.toHaveBeenCalled();
    expect(mocks.getProductInventorySettings).not.toHaveBeenCalled();
  });

  it("locks safely when the balances cannot be verified", async () => {
    mocks.getProductInventorySettings.mockResolvedValue(null);
    mocks.getProductBalances.mockRejectedValue(new Error("fallo de red"));

    await openInventoryTab();

    await waitFor(() => expect(screen.getByText(/No se pudo verificar/)).toBeInTheDocument());
    expect(select()).toBeDisabled();
  });

  it("does not announce an initial assignment when the user lacks permission to edit the settings", async () => {
    mocks.getProductInventorySettings.mockResolvedValue(null);
    mocks.getProductBalances.mockResolvedValue([]);

    await openInventoryTab(editorData({ canUpdateProductRelations: false }));

    await waitFor(() => expect(select()).toBeDisabled());
    await waitFor(() => expect(mocks.getProductBalances).toHaveBeenCalled());
    expect(screen.queryByText(/Asignación inicial/)).toBeNull();
  });
});
