import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductStatus } from "@/core/enums";
import { PRODUCT_ARCHIVE_CONFIRM_MESSAGE } from "@/modules/catalog/components/productLabels";
import { ProductDetailPage } from "@/modules/catalog/pages/ProductDetailPage";

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  archive: vi.fn(),
  restore: vi.fn(),
  reload: vi.fn(),
  canUpdate: { current: true },
  status: { current: "published" as string },
}));

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "product-1" }) }));
vi.mock("@/shared/components/Toast", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("@/modules/catalog/hooks/useProductPermissions", () => ({
  useProductPermissions: () => ({ canUpdate: mocks.canUpdate.current }),
}));
vi.mock("@/modules/catalog/hooks/useProductMutations", () => ({
  useProductMutations: () => ({ archive: mocks.archive, restore: mocks.restore }),
}));
vi.mock("@/modules/catalog/hooks/useProductDetail", () => ({
  useProductDetail: () => ({
    loading: false,
    error: null,
    reload: mocks.reload,
    detail: { product: { id: "product-1", name: "Taladro", status: mocks.status.current } },
  }),
}));
vi.mock("@/modules/catalog/components/ProductDetailCard", () => ({
  ProductDetailCard: () => <div>detalle</div>,
}));

beforeEach(() => {
  mocks.showToast.mockReset();
  mocks.archive.mockReset();
  mocks.restore.mockReset();
  mocks.reload.mockReset();
  mocks.canUpdate.current = true;
  mocks.status.current = ProductStatus.published;
});

describe("product archive and restore permissions", () => {
  it("offers no archive or edit action to a role that cannot update products", () => {
    mocks.canUpdate.current = false;
    render(<ProductDetailPage />);

    expect(screen.queryByRole("button", { name: "Archivar" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Restaurar producto" })).toBeNull();
  });

  it("offers restore, and no archive, for an archived product when the role can update", () => {
    mocks.status.current = ProductStatus.archived;
    render(<ProductDetailPage />);

    expect(screen.getByRole("button", { name: "Restaurar producto" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archivar" })).toBeNull();
  });

  it("does not offer restore to a role that cannot update products", () => {
    mocks.status.current = ProductStatus.archived;
    mocks.canUpdate.current = false;
    render(<ProductDetailPage />);

    expect(screen.queryByRole("button", { name: "Restaurar producto" })).toBeNull();
  });

  it("restores and reloads, or reports the rejection without reloading", async () => {
    mocks.status.current = ProductStatus.archived;
    mocks.restore.mockResolvedValueOnce({});
    const { unmount } = render(<ProductDetailPage />);
    fireEvent.click(screen.getByRole("button", { name: "Restaurar producto" }));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Producto restaurado", tone: "success" }),
      ),
    );
    expect(mocks.reload).toHaveBeenCalledTimes(1);
    unmount();

    mocks.showToast.mockReset();
    mocks.reload.mockReset();
    mocks.restore.mockRejectedValueOnce(new Error("No se pudo restaurar el producto."));
    render(<ProductDetailPage />);
    fireEvent.click(screen.getByRole("button", { name: "Restaurar producto" }));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "No se pudo restaurar", tone: "danger" }),
      ),
    );
    expect(mocks.reload).not.toHaveBeenCalled();
  });
});

function openDialog() {
  render(<ProductDetailPage />);
  fireEvent.click(screen.getByRole("button", { name: "Archivar" }));
}

function confirm() {
  const buttons = screen.getAllByRole("button", { name: "Archivar" });
  fireEvent.click(buttons[buttons.length - 1]);
}

describe("product archive confirmation", () => {
  it("tells the user that archiving is global and lists what can block it", () => {
    openDialog();

    expect(screen.getByText(PRODUCT_ARCHIVE_CONFIRM_MESSAGE)).toBeInTheDocument();
    expect(PRODUCT_ARCHIVE_CONFIRM_MESSAGE).toMatch(/todas las sucursales del negocio/);
    expect(PRODUCT_ARCHIVE_CONFIRM_MESSAGE).toMatch(/existencias o reservas/);
    expect(PRODUCT_ARCHIVE_CONFIRM_MESSAGE).toMatch(/órdenes de compra abiertas/);
    expect(PRODUCT_ARCHIVE_CONFIRM_MESSAGE).toMatch(/traslados despachados/);
    expect(PRODUCT_ARCHIVE_CONFIRM_MESSAGE).toMatch(/kit publicado/);
  });
});

describe("product archive outcomes", () => {
  it("confirms and reloads when the backend accepts", async () => {
    mocks.archive.mockResolvedValue({});
    openDialog();

    confirm();

    await waitFor(() => expect(mocks.archive).toHaveBeenCalledWith("product-1"));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Producto archivado", tone: "success" }),
      ),
    );
    expect(mocks.reload).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["PRODUCT_ARCHIVE_HAS_STOCK", "tiene existencias o reservas en al menos una sucursal"],
    ["PRODUCT_ARCHIVE_HAS_OPEN_PO", "órdenes de compra abiertas"],
    ["PRODUCT_ARCHIVE_IN_TRANSIT", "pendiente de recibir en un traslado ya despachado"],
    ["KIT_COMPONENT_IN_USE", "componente de un kit publicado"],
  ])("shows the %s rejection and does not treat the product as archived", async (_code, text) => {
    mocks.archive.mockRejectedValue(new Error(`No se puede archivar: ${text}.`));
    openDialog();

    confirm();

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "No se pudo archivar",
          description: expect.stringContaining(text),
          tone: "danger",
        }),
      ),
    );
    expect(mocks.showToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Producto archivado" }),
    );
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(screen.getByText(PRODUCT_ARCHIVE_CONFIRM_MESSAGE)).toBeInTheDocument();
  });
});
