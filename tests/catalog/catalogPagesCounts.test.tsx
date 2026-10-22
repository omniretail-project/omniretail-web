import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CategoryStatus, LocationStatus } from "@/core/enums";
import type { CategoryListItem } from "@/modules/catalog/application/dto/CategoryEditorDto";
import type { LocationListItem } from "@/modules/catalog/application/dto/LocationEditorDto";
import { CatalogCount } from "@/modules/catalog/components/CatalogCount";
import { CategoriesPage } from "@/modules/catalog/pages/CategoriesPage";
import { LocationsPage } from "@/modules/catalog/pages/LocationsPage";

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  categories: { current: {} as Record<string, unknown> },
  locations: { current: {} as Record<string, unknown> },
  archiveCategory: vi.fn(),
  archiveLocation: vi.fn(),
  restoreCategory: vi.fn(),
  restoreLocation: vi.fn(),
  reloadCategories: vi.fn(),
  reloadLocations: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/shared/components/Toast", () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => ({ user: { tenantId: "tenant-1" }, hasPermission: () => true }),
}));
vi.mock("@/modules/catalog/hooks/useCategories", () => ({
  useCategories: () => mocks.categories.current,
}));
vi.mock("@/modules/catalog/hooks/useLocations", () => ({
  useLocations: () => mocks.locations.current,
}));

function category(overrides: Partial<CategoryListItem> = {}): CategoryListItem {
  return {
    id: "c1",
    tenantId: "tenant-1",
    depth: 0,
    name: "Herramientas",
    code: "HERRAMIENTAS",
    slug: "herramientas",
    status: CategoryStatus.active,
    productCount: 4,
    archivedProductCount: 1,
    ...overrides,
  };
}

function location(overrides: Partial<LocationListItem> = {}): LocationListItem {
  return {
    id: "l1",
    tenantId: "tenant-1",
    branchId: "b1",
    code: "PAS-N",
    name: "Pasillo Norte",
    type: "aisle",
    depth: 0,
    status: LocationStatus.active,
    productCount: 3,
    ...overrides,
  };
}

function categoriesState(items: CategoryListItem[], overrides: Record<string, unknown> = {}) {
  return {
    loading: false,
    busy: false,
    error: null,
    loadError: null,
    reload: mocks.reloadCategories,
    canRead: true,
    canManage: true,
    categories: items,
    filteredCategories: items,
    paginatedCategories: items,
    search: "",
    status: CategoryStatus.active,
    page: 1,
    pageSize: 10,
    totalPages: 1,
    setSearch: vi.fn(),
    setStatus: vi.fn(),
    setPage: vi.fn(),
    setPageSize: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: mocks.archiveCategory,
    restore: mocks.restoreCategory,
    ...overrides,
  };
}

function locationsState(items: LocationListItem[], overrides: Record<string, unknown> = {}) {
  return {
    loading: false,
    busy: false,
    error: null,
    loadError: null,
    reload: mocks.reloadLocations,
    canRead: true,
    canManage: true,
    currentBranchId: "b1",
    locations: items,
    filteredLocations: items,
    paginatedLocations: items,
    search: "",
    status: LocationStatus.active,
    page: 1,
    pageSize: 10,
    totalPages: 1,
    setSearch: vi.fn(),
    setStatus: vi.fn(),
    setPage: vi.fn(),
    setPageSize: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: mocks.archiveLocation,
    restore: mocks.restoreLocation,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.showToast.mockReset();
  mocks.archiveCategory.mockReset();
  mocks.archiveLocation.mockReset();
  mocks.restoreCategory.mockReset();
  mocks.restoreLocation.mockReset();
  mocks.reloadCategories.mockReset();
  mocks.reloadLocations.mockReset();
});

describe("CatalogCount", () => {
  it("shows a real zero as 0", () => {
    const { container } = render(<CatalogCount value={0} />);
    expect(container).toHaveTextContent("0");
    expect(container).not.toHaveTextContent("No disponible");
  });

  it("shows a known count", () => {
    const { container } = render(<CatalogCount value={12} />);
    expect(container).toHaveTextContent("12");
  });

  it("shows an unknown count as unavailable, never as zero or a dash", () => {
    const { container } = render(<CatalogCount value={null} />);
    expect(container).toHaveTextContent("No disponible");
    expect(container).not.toHaveTextContent(/^0$/);
    expect(container).not.toHaveTextContent("-");
  });

  it("shows a loading state instead of a stale value", () => {
    render(<CatalogCount loading value={7} />);
    expect(screen.getByLabelText("Cargando conteo")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("7")).toBeNull();
  });
});

describe("CategoriesPage counts and archiving", () => {
  function row(name: string) {
    return screen.getByText(name).closest("tr") as HTMLElement;
  }

  it("shows the real published count and the archived products", () => {
    mocks.categories.current = categoriesState([category()]);
    render(<CategoriesPage />);

    expect(within(row("Herramientas")).getByText("4")).toBeInTheDocument();
    expect(within(row("Herramientas")).getByText(/1 archivado/)).toBeInTheDocument();
  });

  it("shows a real zero as 0", () => {
    mocks.categories.current = categoriesState([
      category({ name: "Vacia", productCount: 0, archivedProductCount: 0 }),
    ]);
    render(<CategoriesPage />);

    expect(within(row("Vacia")).getByText("0")).toBeInTheDocument();
    expect(within(row("Vacia")).queryByText(/archivado/)).toBeNull();
  });

  it("shows an unknown count as unavailable, not as zero", () => {
    mocks.categories.current = categoriesState([
      category({ name: "Sin dato", productCount: null, archivedProductCount: null }),
    ]);
    render(<CategoriesPage />);

    expect(within(row("Sin dato")).getByText("No disponible")).toBeInTheDocument();
    expect(within(row("Sin dato")).queryByText("0")).toBeNull();
  });

  it("does not render the table with stale counts while the list is loading", () => {
    mocks.categories.current = categoriesState([category()], { loading: true });
    render(<CategoriesPage />);

    expect(screen.getByText("Cargando categorías...")).toBeInTheDocument();
    expect(screen.queryByText("Herramientas")).toBeNull();
  });

  function openArchiveDialog(name: string) {
    fireEvent.click(screen.getByLabelText(`Acciones de ${name}`));
    fireEvent.click(screen.getByRole("menuitem", { name: /Archivar/ }));
  }

  it("warns in the confirmation that products must be reassigned first, without blocking the backend", () => {
    mocks.categories.current = categoriesState([category()]);
    render(<CategoriesPage />);

    openArchiveDialog("Herramientas");

    expect(screen.getByText(/Tiene 4 productos asociados directamente/)).toBeInTheDocument();
  });

  it("does not claim the category is empty when the count is unknown", () => {
    mocks.categories.current = categoriesState([
      category({ productCount: null, archivedProductCount: null }),
    ]);
    render(<CategoriesPage />);

    openArchiveDialog("Herramientas");

    expect(screen.getByText(/No pudimos verificar cuántos productos tiene asociados/)).toBeInTheDocument();
    expect(screen.queryByText(/Tiene 0 productos/)).toBeNull();
  });

  it("archives and confirms when the backend accepts", async () => {
    mocks.archiveCategory.mockResolvedValue(null);
    mocks.categories.current = categoriesState([category({ productCount: 0, archivedProductCount: 0 })]);
    render(<CategoriesPage />);

    openArchiveDialog("Herramientas");
    fireEvent.click(screen.getByRole("button", { name: "Archivar" }));

    await waitFor(() => expect(mocks.archiveCategory).toHaveBeenCalledWith("c1"));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Categoría archivada", tone: "success" }),
      ),
    );
  });

  it.each([
    ["CATEGORY_HAS_PRODUCTS", "tiene productos no archivados asociados directamente"],
    ["CATEGORY_HAS_ACTIVE_CHILDREN", "tiene subcategorías activas"],
  ])("shows the %s rejection, keeps the category and never reports success", async (_code, text) => {
    mocks.archiveCategory.mockRejectedValue(new Error(`No se puede archivar la categoría: ${text}.`));
    mocks.categories.current = categoriesState([category({ productCount: 0, archivedProductCount: 0 })]);
    render(<CategoriesPage />);

    openArchiveDialog("Herramientas");
    fireEvent.click(screen.getByRole("button", { name: "Archivar" }));

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "No se pudo archivar la categoría",
          description: expect.stringContaining(text),
          tone: "danger",
        }),
      ),
    );
    expect(mocks.showToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Categoría archivada" }),
    );
    expect(screen.getByText("Herramientas")).toBeInTheDocument();
  });
});

describe("LocationsPage counts and archiving", () => {
  function row(name: string) {
    return screen.getByText(name).closest("tr") as HTMLElement;
  }

  function openArchive(name: string) {
    fireEvent.click(screen.getByLabelText(`Acciones de ${name}`));
    fireEvent.click(screen.getByRole("menuitem", { name: /Archivar/ }));
  }

  it("shows the assigned product count, including a real zero", () => {
    mocks.locations.current = locationsState([
      location(),
      location({ id: "l2", name: "Estante vacio", code: "EST", productCount: 0 }),
    ]);
    render(<LocationsPage />);

    expect(within(row("Pasillo Norte")).getByText("3")).toBeInTheDocument();
    expect(within(row("Estante vacio")).getByText("0")).toBeInTheDocument();
  });

  it("shows an unknown count as unavailable instead of a dash or zero", () => {
    mocks.locations.current = locationsState([location({ productCount: null })]);
    render(<LocationsPage />);

    expect(within(row("Pasillo Norte")).getByText("No disponible")).toBeInTheDocument();
    expect(within(row("Pasillo Norte")).queryByText("-")).toBeNull();
  });

  it("does not open the archive dialog for a location with assigned products and says how to proceed", () => {
    mocks.locations.current = locationsState([location()]);
    render(<LocationsPage />);

    openArchive("Pasillo Norte");

    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Ubicación con productos asignados",
        description: expect.stringMatching(/3 productos tienen asignada.*aunque no tengan existencias.*Reasígnalos a otra ubicación activa/),
        tone: "danger",
      }),
    );
    expect(screen.queryByText("Archivar ubicacion")).toBeNull();
    expect(mocks.showToast.mock.calls[0][0].description).not.toMatch(/Desasigna/);
  });

  it("uses the singular for a single assigned product", () => {
    mocks.locations.current = locationsState([location({ productCount: 1 })]);
    render(<LocationsPage />);

    openArchive("Pasillo Norte");

    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/1 producto tiene asignada/) }),
    );
  });

  it("lets a confirmed-empty location go to the confirmation dialog", () => {
    mocks.locations.current = locationsState([location({ productCount: 0 })]);
    render(<LocationsPage />);

    openArchive("Pasillo Norte");

    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(screen.getByText("Archivar ubicacion")).toBeInTheDocument();
  });

  it("with an unknown count it does not assume the location is empty and warns that the system may reject it", () => {
    mocks.locations.current = locationsState([location({ productCount: null })]);
    render(<LocationsPage />);

    openArchive("Pasillo Norte");

    expect(screen.getByText(/No pudimos verificar cuantos productos la tienen asignada/)).toBeInTheDocument();
  });

  it("keeps the dialog and reports the LOCATION_ASSIGNED_TO_PRODUCTS rejection without success", async () => {
    mocks.archiveLocation.mockRejectedValue(
      new Error("No se puede archivar ni inactivar una ubicación asignada a productos."),
    );
    mocks.locations.current = locationsState([location({ productCount: null })]);
    render(<LocationsPage />);

    openArchive("Pasillo Norte");
    fireEvent.click(screen.getByRole("button", { name: "Archivar" }));

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "No se pudo archivar la ubicacion",
          description: expect.stringContaining("asignada a productos"),
          tone: "danger",
        }),
      ),
    );
    expect(mocks.showToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: "Ubicacion archivada" }),
    );
    expect(screen.getByText("Archivar ubicacion")).toBeInTheDocument();
  });
});

describe("CategoriesPage list states", () => {
  const EMPTY = "Aún no hay categorías registradas.";

  it("shows a load error with its reason and a retry, and NEVER claims there are no categories", () => {
    mocks.categories.current = categoriesState([], {
      loadError: "Error interno del servidor",
      paginatedCategories: [],
      filteredCategories: [],
    });
    render(<CategoriesPage />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No se pudieron cargar las categorías.");
    expect(alert).toHaveTextContent("Error interno del servidor");
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("retries the query from the error state", () => {
    mocks.categories.current = categoriesState([], { loadError: "Sin conexión" });
    render(<CategoriesPage />);

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(mocks.reloadCategories).toHaveBeenCalledTimes(1);
  });

  it("shows the empty message only when the load succeeded and there are really no categories", () => {
    mocks.categories.current = categoriesState([], { paginatedCategories: [], filteredCategories: [] });
    render(<CategoriesPage />);

    expect(screen.getByText(EMPTY)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the no-match message, not the empty one, when filters hide existing categories", () => {
    mocks.categories.current = categoriesState([category()], {
      paginatedCategories: [],
      filteredCategories: [],
      search: "zzz",
    });
    render(<CategoriesPage />);

    expect(screen.getByText("No hay categorías que coincidan con los filtros.")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it("shows loading instead of the empty or error states while the query is in flight", () => {
    mocks.categories.current = categoriesState([], { loading: true });
    render(<CategoriesPage />);

    expect(screen.getByText("Cargando categorías...")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows access denied, and no table or error, for a role that cannot read", () => {
    mocks.categories.current = categoriesState([], { canRead: false, canManage: false });
    render(<CategoriesPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Acceso no autorizado");
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it("hides the write actions from a read-only role but still shows the counts", () => {
    mocks.categories.current = categoriesState([category()], { canManage: false });
    render(<CategoriesPage />);

    expect(screen.queryByRole("button", { name: "Nueva categoría" })).toBeNull();
    expect(screen.queryByLabelText("Acciones de Herramientas")).toBeNull();
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});

describe("LocationsPage list states", () => {
  const EMPTY = "Aun no hay ubicaciones registradas.";

  it("shows a load error with its reason and a retry, and NEVER claims there are no locations", () => {
    mocks.locations.current = locationsState([], {
      loadError: "Sin acceso a la sucursal",
      paginatedLocations: [],
      filteredLocations: [],
    });
    render(<LocationsPage />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("No se pudieron cargar las ubicaciones.");
    expect(alert).toHaveTextContent("Sin acceso a la sucursal");
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("retries the query from the error state", () => {
    mocks.locations.current = locationsState([], { loadError: "Sin conexión" });
    render(<LocationsPage />);

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(mocks.reloadLocations).toHaveBeenCalledTimes(1);
  });

  it("shows the empty message only when the load succeeded and the branch really has no locations", () => {
    mocks.locations.current = locationsState([], { paginatedLocations: [], filteredLocations: [] });
    render(<LocationsPage />);

    expect(screen.getByText(EMPTY)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows loading instead of the empty or error states while the query is in flight", () => {
    mocks.locations.current = locationsState([], { loading: true });
    render(<LocationsPage />);

    expect(screen.getByText("Cargando ubicaciones...")).toBeInTheDocument();
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows access denied for a role that cannot read", () => {
    mocks.locations.current = locationsState([], { canRead: false, canManage: false });
    render(<LocationsPage />);

    expect(screen.getByRole("alert")).toHaveTextContent("Acceso no autorizado");
    expect(screen.queryByText(EMPTY)).toBeNull();
  });

  it("hides the write actions from a read-only role but still shows the counts", () => {
    mocks.locations.current = locationsState([location()], { canManage: false });
    render(<LocationsPage />);

    expect(screen.queryByRole("button", { name: /Nueva ubicaci/ })).toBeNull();
    expect(screen.queryByLabelText("Acciones de Pasillo Norte")).toBeNull();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});

describe("CategoriesPage detail panel and restore", () => {
  function openDetail(name: string) {
    fireEvent.click(screen.getByText(name).closest("tr") as HTMLElement);
  }

  it("shows the published and archived counts in the detail panel, and unavailable counts as such", () => {
    mocks.categories.current = categoriesState([
      category({ name: "Conocida", productCount: 4, archivedProductCount: 1 }),
      category({ id: "c2", name: "Sin dato", productCount: null, archivedProductCount: null }),
    ]);
    render(<CategoriesPage />);

    openDetail("Conocida");
    const panel = screen.getByRole("complementary");
    expect(within(panel).getByText("Cantidad de productos").nextElementSibling).toHaveTextContent("4");
    expect(within(panel).getByText("Productos archivados").nextElementSibling).toHaveTextContent("1");
    fireEvent.click(within(panel).getAllByRole("button", { name: "Cerrar" })[0]);

    openDetail("Sin dato");
    const second = screen.getByRole("complementary");
    expect(within(second).getByText("Cantidad de productos").nextElementSibling).toHaveTextContent(
      "No disponible",
    );
    expect(within(second).getByText("Productos archivados").nextElementSibling).toHaveTextContent(
      "No disponible",
    );
  });

  it("keeps the detail panel open on the archived category after a successful archive", async () => {
    mocks.archiveCategory.mockResolvedValue(null);
    mocks.categories.current = categoriesState([category({ productCount: 0, archivedProductCount: 0 })]);
    render(<CategoriesPage />);
    openDetail("Herramientas");

    fireEvent.click(screen.getByLabelText("Acciones de Herramientas"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Archivar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Archivar" }));

    await waitFor(() => expect(mocks.archiveCategory).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(screen.getByRole("complementary")).toBeInTheDocument());
  });

  it("restores an archived category and confirms it", async () => {
    mocks.restoreCategory.mockResolvedValue(null);
    mocks.categories.current = categoriesState(
      [category({ status: CategoryStatus.archived })],
      { status: CategoryStatus.archived },
    );
    render(<CategoriesPage />);

    fireEvent.click(screen.getByLabelText("Acciones de Herramientas"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Restaurar/ }));

    await waitFor(() => expect(mocks.restoreCategory).toHaveBeenCalledWith("c1"));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Categoría restaurada", tone: "success" }),
      ),
    );
  });
});

describe("LocationsPage detail panel and restore", () => {
  function openDetail(name: string) {
    fireEvent.click(screen.getByText(name).closest("tr") as HTMLElement);
  }

  it("shows the assigned product count in the detail panel, and unavailable as such", () => {
    mocks.locations.current = locationsState([
      location(),
      location({ id: "l2", name: "Sin dato", code: "SD", productCount: null }),
    ]);
    render(<LocationsPage />);

    openDetail("Pasillo Norte");
    const panel = screen.getByRole("complementary");
    expect(within(panel).getByText(/Productos asociados/i).nextElementSibling).toHaveTextContent("3");
    fireEvent.click(within(panel).getAllByRole("button", { name: "Cerrar" })[0]);

    openDetail("Sin dato");
    expect(
      within(screen.getByRole("complementary")).getByText(/Productos asociados/i).nextElementSibling,
    ).toHaveTextContent("No disponible");
  });

  it("keeps the detail panel open on the archived location after a successful archive", async () => {
    mocks.archiveLocation.mockResolvedValue(null);
    mocks.locations.current = locationsState([location({ productCount: 0 })]);
    render(<LocationsPage />);
    openDetail("Pasillo Norte");

    fireEvent.click(screen.getByLabelText("Acciones de Pasillo Norte"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Archivar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Archivar" }));

    await waitFor(() => expect(mocks.archiveLocation).toHaveBeenCalledWith("l1"));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Ubicacion archivada", tone: "success" }),
      ),
    );
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("reactivates an archived location and confirms it", async () => {
    mocks.restoreLocation.mockResolvedValue(null);
    mocks.locations.current = locationsState(
      [location({ status: LocationStatus.archived })],
      { status: LocationStatus.archived },
    );
    render(<LocationsPage />);

    fireEvent.click(screen.getByLabelText("Acciones de Pasillo Norte"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Reactivar/ }));

    await waitFor(() => expect(mocks.restoreLocation).toHaveBeenCalledWith("l1"));
    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Ubicacion reactivada", tone: "success" }),
      ),
    );
  });
});
