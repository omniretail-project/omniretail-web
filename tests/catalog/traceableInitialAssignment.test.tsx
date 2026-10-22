import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InventoryBalance, StorageLocation } from "@/core/entities";
import { LocationStatus } from "@/core/enums";
import type { ProductTrackingConfig } from "@/core/types/tracking.types";
import { OperationalLocationField } from "@/modules/catalog/components/OperationalLocationField";
import {
  useProductLocationLock,
  type ProductLocationAssignment,
} from "@/modules/catalog/hooks/useProductLocationLock";

/**
 * Integracion real hook + selector (sin mocks de logica): un producto con lote y vencimiento creado
 * en Sur, con existencias en Sur y ninguna en Norte. Solo el repositorio de balances es simulado y
 * responde por sucursal, como lo hace el backend.
 */
const mocks = vi.hoisted(() => ({ getProductBalances: vi.fn() }));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => ({ inventory: { getProductBalances: mocks.getProductBalances } }),
}));

const SOUTH = "branch-south";
const NORTH = "branch-north";
const traced: ProductTrackingConfig = { stock: true, lot: true, expiration: true, serial: false };

function balance(branchId: string, quantity: number, locationId?: string): InventoryBalance {
  return {
    id: `balance-${branchId}-${quantity}-${locationId ?? "null"}`,
    tenantId: "tenant-1",
    branchId,
    productId: "product-pr",
    locationId,
    quantity,
    reservedQuantity: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function location(id: string, branchId: string): StorageLocation {
  return {
    id,
    tenantId: "tenant-1",
    branchId,
    code: id.toUpperCase(),
    name: `Estante ${id}`,
    type: "shelf",
    status: LocationStatus.active,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function Harness({
  branchId,
  assignment,
  canReadStock = true,
  onChange,
}: {
  branchId: string;
  assignment: ProductLocationAssignment;
  canReadStock?: boolean;
  onChange: (value: string) => void;
}) {
  const lock = useProductLocationLock({
    enabled: true,
    tenantId: "tenant-1",
    productId: "product-pr",
    branchId,
    tracking: traced,
    canReadStock,
    assignment,
  });
  const baseline = assignment.status === "ready" ? assignment.locationId : null;
  return (
    <OperationalLocationField
      baselineLocationId={baseline}
      currentLocation={null}
      disabled={false}
      editorError={null}
      isEdit
      locations={[location("n1", NORTH), location("n2", NORTH)]}
      locationsLoaded
      lock={lock}
      onChange={onChange}
      value={baseline ?? ""}
    />
  );
}

beforeEach(() => {
  mocks.getProductBalances.mockReset();
  // Existencias solo en Sur; el repositorio devuelve unicamente la sucursal consultada.
  mocks.getProductBalances.mockImplementation(async (_product: string, branchId: string) =>
    branchId === SOUTH ? [balance(SOUTH, 40, "s1")] : [],
  );
});

const select = () => screen.getByLabelText("Ubicación operativa") as HTMLSelectElement;

describe("traceable product (lot + expiration) created in South", () => {
  it("lets North choose its FIRST location even though South holds stock", async () => {
    const onChange = vi.fn();
    render(<Harness assignment={{ status: "ready", locationId: null }} branchId={NORTH} onChange={onChange} />);

    await waitFor(() => expect(select()).not.toBeDisabled());
    expect(screen.getByText(/Asignación inicial/)).toBeInTheDocument();
    fireEvent.change(select(), { target: { value: "n1" } });
    expect(onChange).toHaveBeenCalledWith("n1");
    expect(mocks.getProductBalances).toHaveBeenCalledWith("product-pr", NORTH, "tenant-1", { fresh: true });
    expect(mocks.getProductBalances).not.toHaveBeenCalledWith("product-pr", SOUTH, expect.anything(), expect.anything());
  });

  it("keeps CHANGING South's existing location blocked for the traceable product", () => {
    render(<Harness assignment={{ status: "ready", locationId: "s1" }} branchId={SOUTH} onChange={vi.fn()} />);

    expect(select()).toBeDisabled();
    expect(screen.getByText(/lote, serie o vencimiento/)).toBeInTheDocument();
    expect(mocks.getProductBalances).not.toHaveBeenCalled();
  });

  it("blocks the first assignment in a branch that has legacy stock and points to the regularization", async () => {
    mocks.getProductBalances.mockImplementation(async () => [balance(NORTH, 6)]);
    render(<Harness assignment={{ status: "ready", locationId: null }} branchId={NORTH} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("link", { name: /regularización/ })).toBeInTheDocument());
    expect(select()).toBeDisabled();
    expect(screen.queryByText(/Asignación inicial/)).toBeNull();
  });

  it("keeps the selector blocked and says so when the balances cannot be verified", async () => {
    mocks.getProductBalances.mockRejectedValue(new Error("fallo de red"));
    render(<Harness assignment={{ status: "ready", locationId: null }} branchId={NORTH} onChange={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/No se pudo verificar/)).toBeInTheDocument());
    expect(select()).toBeDisabled();
  });

  it("explains the missing permission and never reads the balances", () => {
    render(
      <Harness
        assignment={{ status: "ready", locationId: null }}
        branchId={NORTH}
        canReadStock={false}
        onChange={vi.fn()}
      />,
    );

    expect(select()).toBeDisabled();
    expect(screen.getByText(/No tienes permiso para consultar las existencias/)).toBeInTheDocument();
    expect(mocks.getProductBalances).not.toHaveBeenCalled();
  });

  it("stays blocked while the branch settings are loading or failed", () => {
    const { rerender } = render(
      <Harness assignment={{ status: "loading" }} branchId={NORTH} onChange={vi.fn()} />,
    );
    expect(select()).toBeDisabled();
    expect(screen.getByText(/Verificando las existencias/)).toBeInTheDocument();

    rerender(<Harness assignment={{ status: "error" }} branchId={NORTH} onChange={vi.fn()} />);
    expect(select()).toBeDisabled();
    expect(screen.getByText(/No se pudo verificar/)).toBeInTheDocument();
    expect(mocks.getProductBalances).not.toHaveBeenCalled();
  });

  it("switching from South to North re-evaluates with North's own data", async () => {
    const { rerender } = render(
      <Harness assignment={{ status: "ready", locationId: "s1" }} branchId={SOUTH} onChange={vi.fn()} />,
    );
    expect(select()).toBeDisabled();

    rerender(<Harness assignment={{ status: "ready", locationId: null }} branchId={NORTH} onChange={vi.fn()} />);

    await waitFor(() => expect(select()).not.toBeDisabled());
    expect(screen.getByText(/Asignación inicial/)).toBeInTheDocument();
  });
});
