import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToastProvider, useToast } from "@/shared/components/Toast";
import { describeLocationSaveFailure } from "@/modules/catalog/pages/ProductFormPage";
import { OPERATIONAL_LOCATION_ERROR_MESSAGES } from "@/core/inventory/operationalLocationErrors";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { ProductEditorPartialSaveError } from "@/modules/catalog/application/services/ProductEditorPartialSaveError";

function Trigger({ tone }: { tone: "danger" | "warning" | "info" | "success" }) {
  const { showToast } = useToast();
  return (
    <button
      onClick={() => showToast({ title: "No se pudo guardar", description: "Detalle", tone })}
      type="button"
    >
      abrir
    </button>
  );
}

function open(tone: "danger" | "warning" | "info" | "success") {
  render(
    <ToastProvider>
      <Trigger tone={tone} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "abrir" }));
  return screen.getByText("No se pudo guardar").closest("button") as HTMLElement;
}

describe("Toast legibility", () => {
  it.each(["danger", "warning", "info"] as const)(
    "uses an opaque tinted background for %s toasts instead of a transparent one",
    (tone) => {
      const toast = open(tone);

      expect(toast.className).toContain("color-mix");
      expect(toast.className).not.toMatch(/bg-\[var\(--color-[a-z]+\)\]\/\d+/);
      expect(toast.className).toContain("border-l-4");
    },
  );

  it("renders the description with the main text color and above forms", () => {
    const toast = open("danger");

    expect(screen.getByText("Detalle").className).toContain("text-[var(--color-text)]");
    expect(screen.getByText("Detalle").className).not.toContain("text-muted");
    expect(toast.parentElement?.className).toContain("z-[100]");
    expect(toast.parentElement?.className).toContain("inset-x-4");
  });
});

describe("describeLocationSaveFailure", () => {
  it("explains INVENTORY_LOCATION_REQUIRED and points to the location field", () => {
    const error = new BackendRequestError(
      OPERATIONAL_LOCATION_ERROR_MESSAGES.INVENTORY_LOCATION_REQUIRED,
      400,
      "INVENTORY_LOCATION_REQUIRED",
    );

    const failure = describeLocationSaveFailure(error);

    expect(failure?.title).toBe("Falta la ubicación operativa");
    expect(failure?.description).toContain("Ubicación operativa");
  });

  it("explains INVENTORY_LOCATION_CHANGE_BLOCKED without suggesting the change was saved", () => {
    const error = new BackendRequestError("texto backend", 409, "INVENTORY_LOCATION_CHANGE_BLOCKED");

    const failure = describeLocationSaveFailure(error);

    expect(failure?.title).toBe("No se puede cambiar la ubicación operativa");
    expect(failure?.description).toContain("registros de inventario");
    expect(failure?.description).toContain("Se mantiene la ubicación actual");
    expect(failure?.title).not.toMatch(/guardad/i);
  });

  it("recognizes the rejection inside a partial save", () => {
    const partial = new ProductEditorPartialSaveError("product-1", true, ["inventorySettings"], [
      OPERATIONAL_LOCATION_ERROR_MESSAGES.INVENTORY_LOCATION_CHANGE_BLOCKED,
    ]);

    expect(describeLocationSaveFailure(partial)?.title).toBe(
      "No se puede cambiar la ubicación operativa",
    );
  });

  it.each([
    ["INVENTORY_SETTINGS_LOCATION_NOT_FOUND", "La ubicación ya no existe", 404],
    ["INVENTORY_SETTINGS_PRODUCT_NOT_ELIGIBLE", "El producto no admite ubicación operativa", 409],
    ["INVENTORY_SETTINGS_LOCATION_BRANCH_MISMATCH", "La ubicación es de otra sucursal", 409],
    ["INVENTORY_SETTINGS_LOCATION_NOT_ACTIVE", "La ubicación no está activa", 409],
  ] as const)("explains the settings rejection %s and never says it was saved", (code, title, status) => {
    const error = new BackendRequestError(OPERATIONAL_LOCATION_ERROR_MESSAGES[code], status, code);

    const failure = describeLocationSaveFailure(error);

    expect(failure?.title).toBe(title);
    expect(failure?.description).toBe(OPERATIONAL_LOCATION_ERROR_MESSAGES[code]);
    expect(failure?.title).not.toMatch(/guardad/i);
  });

  it("recognizes a settings rejection inside a partial save", () => {
    const partial = new ProductEditorPartialSaveError("product-1", true, ["inventorySettings"], [
      OPERATIONAL_LOCATION_ERROR_MESSAGES.INVENTORY_SETTINGS_LOCATION_NOT_ACTIVE,
    ]);

    expect(describeLocationSaveFailure(partial)?.title).toBe("La ubicación no está activa");
  });

  it("leaves authorization and unrelated errors untouched", () => {
    expect(describeLocationSaveFailure(new BackendRequestError("Sin acceso", 403, "ACCESS_DENIED"))).toBeNull();
    expect(describeLocationSaveFailure(new BackendRequestError("Sesión vencida", 401))).toBeNull();
    expect(describeLocationSaveFailure(new Error("otro"))).toBeNull();
  });
});
