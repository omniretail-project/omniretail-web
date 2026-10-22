import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductStatus } from "@/core/enums";
import { PRODUCT_ARCHIVE_CONFIRM_MESSAGE } from "@/modules/catalog/components/productLabels";
import type { ProductListItem } from "@/modules/catalog/types/catalog.types";
import { ProductsPage } from "@/modules/catalog/pages/ProductsPage";

/**
 * ProductsPage REAL: lista -> accion Archivar -> confirmacion global -> rechazo del backend. Se
 * simulan los hooks de datos y los componentes de tabla/dialogos ajenos al archivado.
 */
const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  permissions: { canRead: true, canCreate: true, canUpdate: true },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/catalogo/productos",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/shared/components/Toast", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => ({ productDataSource: "api" }),
}));
vi.mock("@/modules/catalog/hooks/useProductPermissions", () => ({
  useProductPermissions: () => ({
    ...mocks.permissions,
    canReadPromotions: false,
    canManagePromotions: false,
  }),
}));
vi.mock("@/modules/catalog/hooks/useProductMutations", () => ({
  useProductMutations: () => ({ archive: mocks.archive, restore: mocks.restore }),
}));
vi.mock("@/modules/catalog/hooks/useProducts", () => ({
  useProducts: () => ({
    loading: false,
    initialLoading: false,
    refreshing: false,
    error: null,
    items: [{ id: "p1", name: "Taladro", status: "published" }],
    categories: [],
    filters: { search: "", status: "all", productType: "all", categoryId: "all", channels: [], promotion: "all" },
    filtersEnabled: true,
    page: 1,
    pageSize: 10,
    totalPages: 1,
    totalItems: 1,
    setPage: vi.fn(),
    setPageSize: vi.fn(),
    updateFilters: vi.fn(),
  }),
}));
vi.mock("@/modules/catalog/components/ProductTable", () => ({
  ProductTable: ({
    products,
    canUpdate,
    onArchive,
    onRestore,
  }: {
    products: ProductListItem[];
    canUpdate: boolean;
    onArchive: (product: ProductListItem) => void;
    onRestore: (product: ProductListItem) => void;
  }) => (
    <ul>
      {products.map((product) => (
        <li key={product.id}>
          {product.name}
          {canUpdate ? (
            <>
              <button onClick={() => onArchive(product)} type="button">
                Archivar {product.name}
              </button>
              <button onClick={() => onRestore(product)} type="button">
                Restaurar {product.name}
              </button>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  ),
}));
vi.mock("@/modules/catalog/components/ProductQuickView", () => ({ ProductQuickView: () => null }));
vi.mock("@/modules/catalog/components/ProductPromotionDialog", () => ({
  ProductPromotionDialog: () => null,
}));
vi.mock("@/modules/catalog/components/ProductPriceHistoryDialog", () => ({
  ProductPriceHistoryDialog: () => null,
}));
vi.mock("@/modules/catalog/components/ProductToolbar", () => ({ ProductToolbar: () => null }));
vi.mock("@/modules/catalog/components/ProductFilters", () => ({ ProductFilters: () => null }));

beforeEach(() => {
  mocks.showToast.mockReset();
  mocks.archive.mockReset();
  mocks.restore.mockReset();
  mocks.permissions.canRead = true;
  mocks.permissions.canCreate = true;
  mocks.permissions.canUpdate = true;
});

function confirmArchive() {
  const buttons = screen.getAllByRole("button", { name: "Archivar" });
  fireEvent.click(buttons[buttons.length - 1]);
}

describe("ProductsPage archive flow", () => {
  it("confirms the archive with the global warning and reports success", async () => {
    mocks.archive.mockResolvedValue({ status: ProductStatus.archived });
    render(<ProductsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Archivar Taladro" }));
    expect(screen.getByText(PRODUCT_ARCHIVE_CONFIRM_MESSAGE)).toBeInTheDocument();
    confirmArchive();

    await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith("p1"));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Producto archivado", tone: "success" }),
      ),
    );
    await waitFor(() => expect(screen.queryByText(PRODUCT_ARCHIVE_CONFIRM_MESSAGE)).toBeNull());
  });

  it("shows the backend's rejection, keeps the dialog open and never reports success", async () => {
    mocks.archive.mockRejectedValue(
      new Error("No se puede archivar: el producto tiene existencias o reservas en al menos una sucursal."),
    );
    render(<ProductsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Archivar Taladro" }));
    confirmArchive();

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "No se pudo archivar",
          description: expect.stringContaining("existencias o reservas en al menos una sucursal"),
          tone: "danger",
        }),
      ),
    );
    expect(mocks.showToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Producto archivado" }),
    );
    expect(screen.getByText(PRODUCT_ARCHIVE_CONFIRM_MESSAGE)).toBeInTheDocument();
  });

  it("cancelling the confirmation archives nothing", () => {
    render(<ProductsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Archivar Taladro" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("restores a product and reports the result", async () => {
    mocks.restore.mockResolvedValueOnce({});
    render(<ProductsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Restaurar Taladro" }));

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Producto restaurado", tone: "success" }),
      ),
    );
  });

  it("reports a rejected restore without claiming success", async () => {
    mocks.restore.mockRejectedValueOnce(new Error("No se pudo restaurar el producto."));
    render(<ProductsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Restaurar Taladro" }));

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "No se pudo restaurar", tone: "danger" }),
      ),
    );
    expect(mocks.showToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Producto restaurado" }),
    );
  });

  it("offers no archive action to a role that cannot update products", () => {
    mocks.permissions.canUpdate = false;
    render(<ProductsPage />);

    expect(screen.queryByRole("button", { name: "Archivar Taladro" })).toBeNull();
  });

  it("shows access denied, and no list, to a role that cannot read products", () => {
    mocks.permissions.canRead = false;
    render(<ProductsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Acceso no autorizado");
    expect(screen.queryByText("Taladro")).toBeNull();
  });
});
