import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StorageLocation } from "@/core/entities";
import { LocationStatus, ProductType } from "@/core/enums";
import {
  LOCATION_LOCKED_MESSAGE,
  LOCATION_REQUIRED_MESSAGE,
  OperationalLocationField,
  validateOperationalLocation,
} from "@/modules/catalog/components/OperationalLocationField";
import type { ProductLocationLock } from "@/modules/catalog/hooks/useProductLocationLock";

function location(id: string, status = LocationStatus.active): StorageLocation {
  return {
    id,
    tenantId: "tenant-1",
    branchId: "branch-1",
    code: id.toUpperCase(),
    name: `Estante ${id}`,
    type: "shelf",
    status,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const unlocked: ProductLocationLock = { status: "unlocked" };

function renderField(overrides: Partial<Parameters<typeof OperationalLocationField>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <OperationalLocationField
      baselineLocationId={null}
      currentLocation={null}
      disabled={false}
      editorError={null}
      isEdit={false}
      locations={[location("a"), location("b")]}
      locationsLoaded
      lock={unlocked}
      onChange={onChange}
      value=""
      {...overrides}
    />,
  );
  return { onChange, select: screen.getByLabelText("Ubicación operativa") as HTMLSelectElement };
}

describe("validateOperationalLocation", () => {
  const base = {
    isEdit: false,
    productType: ProductType.physical,
    tracksStock: true,
    selectedLocationId: "",
    activeLocationIds: ["a", "b"],
  };

  it("requires an active location when creating a physical product that controls stock", () => {
    expect(validateOperationalLocation(base)).toBe(LOCATION_REQUIRED_MESSAGE);
    expect(validateOperationalLocation({ ...base, selectedLocationId: "inactive" })).toBe(
      LOCATION_REQUIRED_MESSAGE,
    );
    expect(validateOperationalLocation({ ...base, selectedLocationId: "a" })).toBeNull();
  });

  it("does not apply to services, kits, products without stock control or edits", () => {
    expect(validateOperationalLocation({ ...base, productType: ProductType.service })).toBeNull();
    expect(validateOperationalLocation({ ...base, productType: ProductType.kit })).toBeNull();
    expect(validateOperationalLocation({ ...base, tracksStock: false })).toBeNull();
    expect(validateOperationalLocation({ ...base, isEdit: true })).toBeNull();
  });

  it("uses the exact message requested for the selector", () => {
    expect(LOCATION_REQUIRED_MESSAGE).toBe("Selecciona una ubicación operativa para este producto");
  });
});

describe("OperationalLocationField when creating", () => {
  it("offers only active locations, no administrative option and no preselection", () => {
    const { select } = renderField();

    expect(select.value).toBe("");
    const labels = Array.from(select.options).map((option) => option.textContent);
    expect(labels).toEqual(["Selecciona una ubicación operativa", "Estante a", "Estante b"]);
    expect(screen.queryByText(/alta administrativa/)).toBeNull();
    expect(select).not.toBeDisabled();
  });

  it("shows the required error next to the selector", () => {
    renderField({ error: LOCATION_REQUIRED_MESSAGE });

    expect(screen.getByText(LOCATION_REQUIRED_MESSAGE)).toBeInTheDocument();
  });

  it("reports the chosen location", () => {
    const { onChange, select } = renderField();

    fireEvent.change(select, { target: { value: "b" } });

    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("explains a branch without active locations and links to the locations screen", () => {
    renderField({ locations: [] });

    expect(screen.getByRole("alert")).toHaveTextContent("no tiene ubicaciones activas");
    expect(screen.getByRole("link", { name: "Ir a ubicaciones" })).toHaveAttribute(
      "href",
      "/catalogo/ubicaciones",
    );
  });

  it("does not claim the branch has no locations while they are still loading", () => {
    renderField({ locations: [], locationsLoaded: false, disabled: true });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("OperationalLocationField when editing", () => {
  const editing = { isEdit: true, baselineLocationId: "a", value: "a" };

  it("locks the selector with an explanation when the product has stock or reservations", () => {
    const { select } = renderField({ ...editing, lock: { status: "locked", reason: "stock" } });

    expect(select).toBeDisabled();
    expect(select.value).toBe("a");
    expect(screen.getByRole("note")).toHaveTextContent(LOCATION_LOCKED_MESSAGE);
  });

  it("lets the user pick another active location when there is no stock or blocker", () => {
    const { onChange, select } = renderField(editing);

    expect(select).not.toBeDisabled();
    fireEvent.change(select, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByText(LOCATION_LOCKED_MESSAGE, { exact: false })).toBeNull();
  });

  it("keeps the selector locked while the inventory check is loading", () => {
    const { select } = renderField({ ...editing, lock: { status: "loading" } });

    expect(select).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("Verificando");
  });

  it("keeps the selector locked and says why when the check could not be verified", () => {
    const { select } = renderField({
      ...editing,
      lock: { status: "locked", reason: "unverified" },
    });

    expect(select).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("No se pudo verificar");
  });

  it("explains the conservative lock for lot, serial and expiration products", () => {
    renderField({ ...editing, lock: { status: "locked", reason: "traceability" } });

    expect(screen.getByRole("note")).toHaveTextContent("lote, serie o vencimiento");
  });

  it("shows a legacy product without assignment and links to the regularization when stock blocks it", () => {
    const { select } = renderField({
      isEdit: true,
      baselineLocationId: null,
      value: "",
      lock: { status: "locked", reason: "stock" },
    });

    expect(select.value).toBe("");
    expect(screen.getByRole("option", { name: /producto heredado/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /regularización/ })).toHaveAttribute(
      "href",
      "/inventario/regularizacion",
    );
  });

  it("does not fabricate a location for a legacy product without stock", () => {
    const { select } = renderField({
      isEdit: true,
      baselineLocationId: null,
      value: "",
    });

    expect(select.value).toBe("");
    expect(select).not.toBeDisabled();
    expect(screen.getByText(/no podrá recibir, reservar ni vender/)).toBeInTheDocument();
  });

  it("explains an assigned location that is no longer active", () => {
    const inactive = location("old", LocationStatus.inactive);
    renderField({ ...editing, value: "old", baselineLocationId: "old", currentLocation: inactive });

    expect(screen.getByText(/esta inactiva/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Estante old (inactiva)" })).toBeDisabled();
  });
});

describe("OperationalLocationField initial assignment and permission states", () => {
  it("offers the first assignment of a branch without location, even for a traceable product", () => {
    const { onChange, select } = renderField({
      isEdit: true,
      baselineLocationId: null,
      value: "",
      lock: { status: "unlocked" },
    });

    expect(select).not.toBeDisabled();
    expect(screen.getByText(/Asignación inicial/)).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("does not announce an initial assignment when the product already has a location", () => {
    renderField({ isEdit: true, baselineLocationId: "a", value: "a", lock: { status: "unlocked" } });

    expect(screen.queryByText(/Asignación inicial/)).toBeNull();
  });

  it("does not announce an initial assignment while the verification is still locked", () => {
    renderField({
      isEdit: true,
      baselineLocationId: null,
      value: "",
      lock: { status: "loading" },
    });

    expect(screen.queryByText(/Asignación inicial/)).toBeNull();
  });

  it("explains the missing permission instead of a generic verification failure", () => {
    const { select } = renderField({
      isEdit: true,
      baselineLocationId: "a",
      value: "a",
      lock: { status: "locked", reason: "permission" },
    });

    expect(select).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("No tienes permiso para consultar las existencias");
    expect(screen.getByRole("note")).not.toHaveTextContent("No se pudo verificar");
  });

  it("says that only an ALREADY assigned traceable product is conservatively locked", () => {
    renderField({
      isEdit: true,
      baselineLocationId: "a",
      value: "a",
      lock: { status: "locked", reason: "traceability" },
    });

    expect(screen.getByRole("note")).toHaveTextContent("ya tienen una ubicación asignada");
  });

  it("links to the regularization when the branch has legacy stock and no location", () => {
    renderField({
      isEdit: true,
      baselineLocationId: null,
      value: "",
      lock: { status: "locked", reason: "stock" },
    });

    expect(screen.getByRole("link", { name: /regularización/ })).toHaveAttribute(
      "href",
      "/inventario/regularizacion",
    );
  });
});

describe("OperationalLocationField initial assignment note and disabled field", () => {
  it("does not announce an initial assignment when the field is disabled (for example, no permission)", () => {
    const { select } = renderField({
      isEdit: true,
      baselineLocationId: null,
      value: "",
      disabled: true,
      lock: { status: "unlocked" },
    });

    expect(select).toBeDisabled();
    expect(screen.queryByText(/Asignación inicial/)).toBeNull();
  });
});
