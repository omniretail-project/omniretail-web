import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogisticsPickingPage } from "@/modules/logistics/pages/LogisticsPickingPage";
import { pickingDetail, pickingIds, plainLine, queueItem } from "./pickingFixtures";

const mocks = vi.hoisted(() => ({ picking: {} as Record<string, unknown> }));

vi.mock("@/modules/logistics/hooks/useLogisticsPicking", () => ({ useLogisticsPicking: () => mocks.picking }));
vi.mock("@/shared/components/Toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/modules/logistics/hooks/usePickingFefoPreview", () => ({
  usePickingFefoPreview: () => ({ status: "idle", data: null, error: null, canQuery: false, reload: vi.fn() }),
}));

const initial = pickingDetail([plainLine("1"), plainLine("2"), plainLine("3")]);
const saved = pickingDetail([plainLine("1", { pickedQuantity: 10 }), plainLine("2"), plainLine("3")]);

function hookState(overrides: Record<string, unknown> = {}) {
  return {
    currentBranchName: "Central",
    currentUserId: pickingIds.user,
    hasBranchAccess: true,
    canRead: true,
    canStart: true,
    canComplete: true,
    commandsReadOnly: false,
    autoFefoEnabled: false,
    queue: [queueItem(initial)],
    search: "",
    setSearch: vi.fn(),
    loading: false,
    detailLoading: false,
    submitting: false,
    detail: initial,
    selectedPickingOrderId: pickingIds.picking,
    workspaceOpen: true,
    queueError: null,
    workspaceError: null,
    reload: vi.fn(),
    openPicking: vi.fn(),
    closePicking: vi.fn(),
    assign: vi.fn(),
    updateLine: vi.fn(),
    registerIncident: vi.fn(),
    resolveIncident: vi.fn(),
    release: vi.fn(),
    complete: vi.fn(),
    ...overrides,
  };
}

describe("Mesa de Picking: registrar una cantidad no reconstruye la pantalla", () => {
  beforeEach(() => {
    mocks.picking = hookState();
  });

  it("durante la carga inicial muestra el aviso y todavia no la mesa", () => {
    mocks.picking = hookState({ loading: true });
    render(<LogisticsPickingPage />);

    expect(screen.getByText("Consultando pedidos pendientes...")).toBeInTheDocument();
    expect(screen.queryByText("Cola de pedidos")).not.toBeInTheDocument();
  });

  it("guardar y recibir la respuesta conserva los mismos nodos de la cola y de las tarjetas", () => {
    const view = render(<LogisticsPickingPage />);
    const queueColumn = screen.getByText("Cola de pedidos").closest("aside");
    const firstCard = screen.getAllByRole("article")[0]!;
    const lastCard = screen.getAllByRole("article")[2]!;

    // 1) Operacion en curso.
    mocks.picking = hookState({ submitting: true });
    view.rerender(<LogisticsPickingPage />);
    expect(screen.getByText("Guardando cambios...")).toBeInTheDocument();
    expect(screen.getByText("Cola de pedidos").closest("aside")).toBe(queueColumn);

    // 2) Respuesta confirmada + refresco de la cola en segundo plano (sin loading global).
    mocks.picking = hookState({ detail: saved, queue: [queueItem(saved)] });
    view.rerender(<LogisticsPickingPage />);

    expect(screen.queryByText("Consultando pedidos pendientes...")).not.toBeInTheDocument();
    expect(screen.getByText("Cola de pedidos").closest("aside")).toBe(queueColumn);
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(3);
    // La linea completada se movio al final del mismo contenedor, sin remontarse; las demas siguen ahi.
    expect(articles).toContain(firstCard);
    expect(articles).toContain(lastCard);
    expect(articles[2]).toBe(firstCard);
    expect(screen.getByText("Productos completados (1)")).toBeInTheDocument();
    expect(screen.getByText("10 de 30 unidades recolectadas")).toBeInTheDocument();
  });

  it("un refresco del detalle con la hoja visible no la reemplaza por el cargando", () => {
    const view = render(<LogisticsPickingPage />);
    const firstCard = screen.getAllByRole("article")[0]!;

    mocks.picking = hookState({ detailLoading: true });
    view.rerender(<LogisticsPickingPage />);

    expect(screen.queryByText("Cargando workspace de picking...")).not.toBeInTheDocument();
    expect(screen.getByText("Actualizando...")).toBeInTheDocument();
    expect(screen.getAllByRole("article")[0]).toBe(firstCard);
  });

  it("al abrir un pedido sin detalle sigue mostrando el cargando del workspace", () => {
    mocks.picking = hookState({ detail: null, detailLoading: true });
    render(<LogisticsPickingPage />);

    expect(screen.getByText("Cargando workspace de picking...")).toBeInTheDocument();
  });

  it("un error de guardado conserva el estado valido anterior y muestra el mensaje", () => {
    const view = render(<LogisticsPickingPage />);
    const firstCard = screen.getAllByRole("article")[0]!;

    mocks.picking = hookState({ workspaceError: "La cantidad supera la reserva." });
    view.rerender(<LogisticsPickingPage />);

    expect(screen.getByText("La cantidad supera la reserva.")).toBeInTheDocument();
    expect(screen.getAllByRole("article")[0]).toBe(firstCard);
    expect(screen.getByText("Pendientes de preparar (3)")).toBeInTheDocument();
  });
});
