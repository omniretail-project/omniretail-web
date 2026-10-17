import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LegacyBalanceRegularizationPreview,
  LocationRegularizationResult,
} from "@/core/repositories";
import { InventoryRegularizationPage } from "@/modules/inventory/pages/InventoryRegularizationPage";

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  actions: {
    selectBranch: vi.fn(),
    searchProducts: vi.fn(),
    selectProduct: vi.fn(),
    selectLocation: vi.fn(),
    clearProduct: vi.fn(),
    refreshPreview: vi.fn(),
    setReason: vi.fn(),
    submit: vi.fn(),
    retryUncertain: vi.fn(),
    discardUncertain: vi.fn(),
    dismissResult: vi.fn(),
  },
}));

vi.mock("@/modules/inventory/hooks/useInventoryRegularization", () => ({
  useInventoryRegularization: () => ({ ...mocks.state, ...mocks.actions }),
}));

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const KEY = "40000000-0000-4000-8000-000000000001";
const P = "INVENTORY_REGULARIZATION_";

function previewData(
  overrides: Partial<LegacyBalanceRegularizationPreview> = {},
): LegacyBalanceRegularizationPreview {
  return {
    branchId: "10000000-0000-4000-8000-000000000001",
    productId: "20000000-0000-4000-8000-000000000001",
    productName: "Pintura bronce",
    sku: "PIN-BRO-001",
    locationId: "30000000-0000-4000-8000-000000000001",
    locationName: "Estante 1",
    eligible: true,
    blockers: [],
    sourceQuantity: 20,
    sourceReservedQuantity: 2.5,
    destinationQuantity: 5,
    destinationReservedQuantity: 0,
    resultingQuantity: 25,
    resultingReservedQuantity: 2.5,
    activeReservations: 1,
    emptyAllocationReservations: 0,
    lotBalances: 0,
    serials: 0,
    snapshotFingerprint: "a".repeat(64),
    assignedLocationId: "30000000-0000-4000-8000-000000000001",
    assignmentRequired: false,
    assignmentAllowed: false,
    ...overrides,
  };
}

function resultData(overrides: Partial<LocationRegularizationResult> = {}): LocationRegularizationResult {
  return {
    regularizationId: "50000000-0000-4000-8000-000000000001",
    idempotent: false,
    createdAt: "2026-10-10T12:00:00Z",
    branchId: "10000000-0000-4000-8000-000000000001",
    productId: "20000000-0000-4000-8000-000000000001",
    toLocationId: "30000000-0000-4000-8000-000000000001",
    movedQuantity: 20,
    movedReservedQuantity: 2.5,
    destinationQuantityBefore: 5,
    destinationQuantityAfter: 25,
    destinationReservedQuantityAfter: 2.5,
    reservationsReassigned: 1,
    lotBalancesMerged: 0,
    serialsRelocated: 0,
    movementId: "60000000-0000-4000-8000-000000000001",
    assignmentApplied: false,
    ...overrides,
  };
}

const summary = { productName: "Pintura bronce", sku: "PIN-BRO-001", locationName: "Estante 1" };
const request = {
  branchId: "10000000-0000-4000-8000-000000000001",
  productId: "20000000-0000-4000-8000-000000000001",
  locationId: "30000000-0000-4000-8000-000000000001",
  idempotencyKey: KEY,
  reason: "Saldo heredado",
  expectedSourceQuantity: 20,
  expectedSourceReservedQuantity: 2.5,
  expectedDestinationQuantity: 5,
  snapshotFingerprint: "a".repeat(64),
};

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    apiMode: true,
    apiOnlyMessage: "Solo con backend.",
    canPreview: true,
    canExecute: true,
    canAssign: true,
    assignMode: false,
    selectedLocationId: null,
    branches: [{ id: "10000000-0000-4000-8000-000000000001", name: "Centro" }],
    branchId: "10000000-0000-4000-8000-000000000001",
    locked: false,
    search: null,
    product: { id: "20000000-0000-4000-8000-000000000001", name: "Pintura bronce", sku: "PIN-BRO-001" },
    destination: {
      key: "k",
      status: "ready",
      data: {
        kind: "assigned",
        locationId: "30000000-0000-4000-8000-000000000001",
        locationName: "Estante 1",
        locationCode: "ES-01",
        active: true,
      },
      error: null,
    },
    preview: { key: "k", status: "ready", data: previewData(), error: null, stale: false },
    reason: "Saldo heredado",
    execution: { phase: "idle" },
    gate: { allowed: true, blockedBy: null },
    canSubmit: true,
    ...overrides,
  };
}

beforeEach(() => {
  Object.values(mocks.actions).forEach((fn) => fn.mockReset());
  mocks.state = baseState();
});

describe("InventoryRegularizationPage layout", () => {
  it("uses the same container pattern as the other administrative screens", () => {
    const { container } = render(<InventoryRegularizationPage />);
    const root = container.firstElementChild as HTMLElement;

    for (const className of ["mx-auto", "w-full", "min-w-0", "max-w-7xl", "space-y-5"]) {
      expect(root.classList.contains(className)).toBe(true);
    }
  });

  it("keeps the navy header with white text on the preview table", () => {
    const { container } = render(<InventoryRegularizationPage />);
    const heads = [...container.querySelectorAll("thead")];

    expect(heads.length).toBeGreaterThan(0);
    for (const head of heads) {
      expect(head.className).toContain("bg-[var(--color-structure)]");
      expect(head.className).toContain("text-white");
    }
  });

  it("shows quantity and reservation cards with readable labels", () => {
    render(<InventoryRegularizationPage />);

    // Cada etiqueta aparece en su tarjeta y, ademas, en el encabezado o fila de la tabla.
    expect(screen.getAllByText("Sin ubicación").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Reservado").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("En el destino hoy").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Quedará en el destino").length).toBeGreaterThanOrEqual(1);
    // La ubicacion destino aparece en dos lugares validos: la nota de la ubicacion asignada y el
    // encabezado de la vista previa ("Se consolidara en").
    const labels = screen.getAllByText("ES-01 · Estante 1");
    expect(labels).toHaveLength(2);
    const contexts = labels.map((label) => label.parentElement?.textContent ?? "");
    expect(contexts.some((text) => text.includes("Ubicación asignada:"))).toBe(true);
    expect(contexts.some((text) => text.includes("Se consolidará en:"))).toBe(true);
  });
});

describe("InventoryRegularizationPage user messages", () => {
  it("translates backend blockers and keeps technical codes only inside a collapsed detail", () => {
    mocks.state = baseState({
      preview: {
        key: "k",
        status: "ready",
        stale: false,
        error: null,
        data: previewData({
          eligible: false,
          blockers: [
            { code: `${P}PICKING_CONFLICT`, message: "Un Picking en curso (raw) com.omniretail" },
            { code: "UNKNOWN_FUTURE_CODE", message: "mensaje crudo desconocido" },
          ],
        }),
      },
      gate: { allowed: false, blockedBy: "La regularización tiene bloqueos." },
      canSubmit: false,
    });
    const { container } = render(<InventoryRegularizationPage />);

    expect(
      screen.getByText(
        "Este producto tiene pedidos en preparación que impiden realizar la regularización.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Hay una condición del inventario que impide realizar la regularización."),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("com.omniretail");
    expect(container.textContent).not.toContain("mensaje crudo desconocido");

    const code = screen.getByText(`Código: ${P}PICKING_CONFLICT`);
    expect(code.closest("details")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Regularizar ubicación" })).toBeDisabled();
  });

  it("never shows UUIDs or raw technical text on the screen", () => {
    mocks.state = baseState({
      execution: {
        phase: "uncertain",
        recovered: true,
        request,
        summary,
        failure: {
          kind: "uncertain",
          status: 503,
          code: "SERVICE_UNAVAILABLE",
          message: "java.net.ConnectException: connect refused",
        },
      },
      locked: true,
      canSubmit: false,
    });
    const { container } = render(<InventoryRegularizationPage />);

    expect(container.textContent).not.toMatch(UUID);
    expect(container.textContent).not.toContain("java.net");
    expect(container.textContent).toContain("Pintura bronce");
    expect(container.textContent).toContain("PIN-BRO-001");
  });
});

describe("InventoryRegularizationPage states", () => {
  it("shows an uncertain result without claiming it failed and allows manual retry", () => {
    mocks.state = baseState({
      execution: {
        phase: "uncertain",
        recovered: false,
        request,
        summary,
        failure: { kind: "uncertain", status: 0, message: "No fue posible completar la solicitud." },
      },
      locked: true,
      canSubmit: false,
    });
    const { container } = render(<InventoryRegularizationPage />);

    expect(
      screen.getByText(/No pudimos confirmar si la regularización se aplicó/),
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/no se realizó ningún cambio/i);
    const retry = screen.getByRole("button", { name: "Reintentar la misma solicitud" });
    expect(retry).toBeEnabled();
    expect(screen.getByRole("button", { name: "Descartar este intento" })).toBeInTheDocument();
    // Mientras hay un intento incierto no se puede cambiar de sucursal.
    expect(screen.getByLabelText("Sucursal")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Regularizar ubicación" })).toBeDisabled();
  });

  it("shows a translated message after a stale snapshot rejection", () => {
    mocks.state = baseState({
      execution: {
        phase: "failed",
        failure: {
          kind: "definitive",
          status: 409,
          code: `${P}STALE_SNAPSHOT`,
          message: "El inventario cambió desde la vista previa. Vuelva a cargar la vista previa.",
        },
      },
    });
    render(<InventoryRegularizationPage />);

    expect(
      screen.getByText(
        "El inventario cambió desde la última consulta. Actualiza la información antes de continuar.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Vuelva a cargar la vista previa/)).toBeNull();
  });

  it("differentiates a new regularization from an idempotent replay", () => {
    mocks.state = baseState({
      execution: { phase: "succeeded", summary, result: resultData() },
    });
    const first = render(<InventoryRegularizationPage />);
    expect(screen.getByText("Regularización realizada")).toBeInTheDocument();
    expect(first.container.textContent).not.toMatch(UUID);
    first.unmount();

    mocks.state = baseState({
      execution: { phase: "succeeded", summary, result: resultData({ idempotent: true }) },
    });
    const second = render(<InventoryRegularizationPage />);
    expect(screen.getByText("La regularización ya estaba registrada")).toBeInTheDocument();
    expect(second.container.textContent).not.toMatch(UUID);
  });

  const unassignedDestination = (assignableLocations: Array<{ id: string; code: string; name: string }>) => ({
    key: "k",
    status: "ready",
    data: { kind: "unassigned", assignableLocations },
    error: null,
  });
  const twoLocations = [
    { id: "30000000-0000-4000-8000-000000000001", code: "ES-01", name: "Estante 1" },
    { id: "30000000-0000-4000-8000-000000000002", code: "ES-02", name: "Estante 2" },
  ];

  it("asks to choose a location for an unassigned product and offers no execution yet", () => {
    mocks.state = baseState({
      destination: unassignedDestination(twoLocations),
      assignMode: true,
      preview: null,
      gate: { allowed: false, blockedBy: "Elige la ubicación que se asignará al producto." },
      canSubmit: false,
    });
    render(<InventoryRegularizationPage />);

    expect(
      screen.getByText("Este producto todavía no tiene una ubicación de inventario asignada."),
    ).toBeInTheDocument();
    const select = screen.getByLabelText("Ubicación que se asignará");
    expect(
      within(select).getByRole("option", { name: "ES-01 · Estante 1" }),
    ).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "ES-02 · Estante 2" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regularizar ubicación" })).toBeNull();
  });

  it("notifies the hook when a location is chosen", () => {
    mocks.state = baseState({
      destination: unassignedDestination(twoLocations),
      assignMode: true,
      preview: null,
      canSubmit: false,
    });
    render(<InventoryRegularizationPage />);

    fireEvent.change(screen.getByLabelText("Ubicación que se asignará"), {
      target: { value: twoLocations[1].id },
    });

    expect(mocks.actions.selectLocation).toHaveBeenCalledWith(twoLocations[1].id);
  });

  it("explains the initial assignment once a location is chosen and the preview is ready", () => {
    mocks.state = baseState({
      destination: unassignedDestination(twoLocations),
      assignMode: true,
      selectedLocationId: twoLocations[1].id,
      preview: {
        key: "k",
        status: "ready",
        stale: false,
        error: null,
        data: previewData({
          locationId: twoLocations[1].id,
          locationName: "Estante 2",
          assignedLocationId: undefined,
          assignmentRequired: true,
          assignmentAllowed: true,
        }),
      },
    });
    render(<InventoryRegularizationPage />);

    expect(
      screen.getByText("Se asignará ES-02 · Estante 2 como ubicación de inventario."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regularizar ubicación" })).toBeEnabled();
  });

  it("does not allow confirming when the assignment is not allowed", () => {
    mocks.state = baseState({
      destination: unassignedDestination(twoLocations),
      assignMode: true,
      selectedLocationId: twoLocations[1].id,
      preview: {
        key: "k",
        status: "ready",
        stale: false,
        error: null,
        data: previewData({
          locationId: twoLocations[1].id,
          eligible: false,
          assignedLocationId: undefined,
          assignmentRequired: true,
          assignmentAllowed: false,
          blockers: [
            { code: `${P}ASSIGNMENT_PERMISSION`, message: "Asignar la ubicación inicial exige..." },
          ],
        }),
      },
      gate: { allowed: false, blockedBy: "No es posible asignar esta ubicación." },
      canSubmit: false,
    });
    const { container } = render(<InventoryRegularizationPage />);

    expect(
      screen.getByText("No es posible asignar esta ubicación al producto en este momento."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Faltan permisos para asignar ubicaciones de inventario. Necesitas poder registrar ajustes y actualizar productos.",
      ),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("exige...");
    expect(screen.getByRole("button", { name: "Regularizar ubicación" })).toBeDisabled();
  });

  it("warns when the user can read but not assign", () => {
    mocks.state = baseState({
      destination: unassignedDestination(twoLocations),
      assignMode: true,
      canAssign: false,
      preview: null,
      canSubmit: false,
    });
    render(<InventoryRegularizationPage />);

    expect(screen.getByText("No tienes permisos para asignar ubicaciones.")).toBeInTheDocument();
  });

  it("explains when there are no active locations to assign", () => {
    mocks.state = baseState({
      destination: unassignedDestination([]),
      assignMode: true,
      preview: null,
      canSubmit: false,
    });
    render(<InventoryRegularizationPage />);

    expect(
      screen.getByText("No hay ubicaciones activas disponibles en esta sucursal."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Ubicación que se asignará")).toBeNull();
  });

  it("uses the assigned location without offering a selector", () => {
    render(<InventoryRegularizationPage />);

    expect(screen.queryByLabelText("Ubicación que se asignará")).toBeNull();
    expect(screen.getByText(/Una ubicación ya asignada no se cambia desde aquí/)).toBeInTheDocument();
  });

  it("explains disabled location control", () => {
    mocks.state = baseState({
      destination: {
        key: "k",
        status: "ready",
        data: { kind: "locations_disabled" },
        error: null,
      },
      preview: null,
      canSubmit: false,
    });
    render(<InventoryRegularizationPage />);

    expect(
      screen.getByText("El control de ubicaciones está desactivado en este negocio."),
    ).toBeInTheDocument();
  });

  it("shows a retry that could not be sent while keeping the previous attempt", () => {
    mocks.state = baseState({
      execution: {
        phase: "uncertain",
        recovered: false,
        request,
        summary,
        failure: { kind: "uncertain", status: 0, message: "No fue posible completar la solicitud." },
        retryFailure: {
          kind: "definitive",
          status: 403,
          code: "ACCESS_DENIED",
          message: "Asignar la ubicación inicial exige los permisos ...",
        },
      },
      locked: true,
      canSubmit: false,
    });
    const { container } = render(<InventoryRegularizationPage />);

    expect(
      screen.getByText(/No se pudo reintentar la solicitud ahora/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No tienes los permisos necesarios para asignar una ubicación inicial."),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("exige los permisos");
    expect(screen.getByRole("button", { name: "Reintentar la misma solicitud" })).toBeEnabled();
  });

  it("tells that the location was assigned in the result", () => {
    mocks.state = baseState({
      execution: {
        phase: "succeeded",
        summary,
        result: resultData({ assignmentApplied: true }),
      },
    });
    render(<InventoryRegularizationPage />);

    expect(screen.getByText(/quedó con Estante 1 como ubicación de inventario/)).toBeInTheDocument();
  });

  it("shows loading, empty search and friendly load errors", () => {
    mocks.state = baseState({
      product: null,
      destination: null,
      preview: null,
      search: { branchId: "b", term: "x", status: "ready", items: [], error: null },
    });
    const first = render(<InventoryRegularizationPage />);
    expect(
      screen.getByText(/No encontramos productos físicos con control de inventario/),
    ).toBeInTheDocument();
    first.unmount();

    mocks.state = baseState({
      preview: { key: "k", status: "loading", data: null, error: null, stale: false },
    });
    const second = render(<InventoryRegularizationPage />);
    expect(within(second.container).getByRole("status")).toHaveTextContent(
      "Calculando la vista previa...",
    );
    second.unmount();

    mocks.state = baseState({
      preview: {
        key: "k",
        status: "error",
        data: null,
        stale: false,
        error: { status: 500, message: "NullPointerException at com.omniretail" },
      },
    });
    const third = render(<InventoryRegularizationPage />);
    expect(
      screen.getByText("No pudimos cargar la información en este momento."),
    ).toBeInTheDocument();
    expect(third.container.textContent).not.toContain("NullPointerException");
  });

  it("explains the local-mode limitation without showing the workflow", () => {
    mocks.state = baseState({ apiMode: false });
    render(<InventoryRegularizationPage />);

    expect(screen.getByText("Esta función no está disponible en modo local")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Regularizar ubicación" })).toBeNull();
  });
});
