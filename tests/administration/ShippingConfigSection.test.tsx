// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShippingConfigSection } from "@/modules/administration/components/ShippingConfigSection";
import { useShippingConfig } from "@/modules/administration/hooks/useShippingConfig";
import { ToastProvider } from "@/shared/components/Toast";

const state = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  hasPermission: true,
  listeners: new Map<string, () => void>(),
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({ useRepositories: () => ({}) }));
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => ({
    user: { tenantId: "tenant-1" },
    hasPermission: () => state.hasPermission,
    loading: false,
  }),
}));
vi.mock("@/shared/hooks/useDataEvent", () => ({
  useDataEvent: (event: string, listener: () => void) => state.listeners.set(event, listener),
}));
vi.mock("@/modules/administration/application/services/GetShippingConfigService", () => ({
  GetShippingConfigService: class {
    execute = state.get;
  },
}));
vi.mock("@/modules/administration/application/services/SaveShippingConfigService", () => ({
  SaveShippingConfigService: class {
    execute = state.save;
  },
}));

const config = {
  ecommerce: { enabled: true, deliveryFee: 25, freeShippingThreshold: 300 },
  pos: { enabled: false, deliveryFee: 0 },
};

function renderSection() {
  return render(
    <ToastProvider>
      <ShippingConfigSection />
    </ToastProvider>,
  );
}

describe("useShippingConfig", () => {
  beforeEach(() => {
    state.hasPermission = true;
    state.get.mockReset().mockResolvedValue(config);
    state.save.mockReset();
  });

  it("carga la configuración y la recarga cuando cambia", async () => {
    const { result } = renderHook(() => useShippingConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config).toEqual(config);
    expect(result.current.canManage).toBe(true);

    state.get.mockResolvedValue({ ...config, pos: { enabled: true, deliveryFee: 15 } });
    await act(async () => state.listeners.get("shipping-config.changed")?.());
    expect(result.current.config?.pos.deliveryFee).toBe(15);
  });

  it("sin permiso no carga nada", async () => {
    state.hasPermission = false;
    const { result } = renderHook(() => useShippingConfig());

    expect(result.current.loading).toBe(false);
    expect(result.current.canManage).toBe(false);
    expect(state.get).not.toHaveBeenCalled();
  });

  it("muestra el error de carga y relanza el error de guardado", async () => {
    state.get.mockRejectedValue(new Error("x"));
    const { result } = renderHook(() => useShippingConfig());
    await waitFor(() => expect(result.current.error).not.toBeNull());

    state.save.mockRejectedValue(new Error("x"));
    await expect(
      act(async () =>
        result.current.save({
          ecommerce: { enabled: true, deliveryFee: "25", freeShippingThreshold: "" },
          pos: { enabled: false, deliveryFee: "0", freeShippingThreshold: "" },
        }),
      ),
    ).rejects.toThrow();
    expect(result.current.saving).toBe(false);
  });
});

describe("ShippingConfigSection", () => {
  beforeEach(() => {
    state.hasPermission = true;
    state.get.mockReset().mockResolvedValue(config);
    state.save.mockReset();
  });

  it("no se muestra sin permiso", () => {
    state.hasPermission = false;
    const { container } = renderSection();

    expect(container.querySelector("section")).toBeNull();
  });

  it("muestra el resumen de cada canal y guarda los cambios", async () => {
    state.save.mockImplementation(async () => ({
      ...config,
      pos: { enabled: true, deliveryFee: 15, freeShippingThreshold: 200 },
    }));
    renderSection();
    await screen.findByText("Se cobra Q25.00; gratis desde Q300.00.");
    expect(screen.getByText("No se cobra envío.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Guardar costo de envío" })).toHaveProperty(
      "disabled",
      true,
    );

    const posCharge = screen.getAllByLabelText("Cobrar envío a domicilio")[1]!;
    fireEvent.click(posCharge);
    fireEvent.change(document.getElementById("shipping-pos-fee")!, { target: { value: "15" } });
    fireEvent.change(document.getElementById("shipping-pos-threshold")!, {
      target: { value: "200" },
    });
    expect(screen.getByText("Se cobra Q15.00; gratis desde Q200.00.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Guardar costo de envío" }));

    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
    expect(state.save.mock.calls[0]?.[0].pos).toEqual({
      enabled: true,
      deliveryFee: "15",
      freeShippingThreshold: "200",
    });
    expect(await screen.findByText("Costo de envío guardado")).toBeTruthy();
  });

  it("muestra los errores de validación y permite descartar cambios", async () => {
    renderSection();
    await screen.findByText("Se cobra Q25.00; gratis desde Q300.00.");
    const fee = document.getElementById("shipping-ecommerce-fee") as HTMLInputElement;

    fireEvent.change(fee, { target: { value: "abc" } });
    expect(screen.getByText("Se cobra la tarifa; gratis desde Q300.00.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Guardar costo de envío" }));

    expect(
      await screen.findByText(
        "La tarifa de envío debe ser un monto positivo con hasta 2 decimales.",
      ),
    ).toBeTruthy();
    expect(state.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));
    expect(fee.value).toBe("25.00");
  });

  it("describe un canal sin umbral y avisa si el guardado falla", async () => {
    state.save.mockRejectedValue(new Error("Sin conexión"));
    renderSection();
    await screen.findByText("Se cobra Q25.00; gratis desde Q300.00.");

    fireEvent.change(document.getElementById("shipping-ecommerce-threshold")!, {
      target: { value: "" },
    });
    expect(screen.getByText("Se cobra Q25.00 en todos los pedidos.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Guardar costo de envío" }));

    expect(await screen.findByText("No se pudo guardar el costo de envío")).toBeTruthy();
  });

  it("muestra el error si no se puede cargar", async () => {
    state.get.mockRejectedValue(new Error("Sin conexión"));
    renderSection();

    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
