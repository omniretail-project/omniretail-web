// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PendingSaleBanner } from "@/modules/pos/components/PendingSaleBanner";

function renderBanner(overrides: Partial<Parameters<typeof PendingSaleBanner>[0]> = {}) {
  const onRetry = vi.fn();
  const onDiscard = vi.fn();
  render(
    <PendingSaleBanner
      createdAt="2026-10-10T12:30:00.000Z"
      error={null}
      itemCount={2}
      loading={false}
      onDiscard={onDiscard}
      onRetry={onRetry}
      total={150}
      {...overrides}
    />,
  );
  return { onRetry, onDiscard };
}

describe("PendingSaleBanner", () => {
  afterEach(() => vi.restoreAllMocks());

  it("explica la venta pendiente y permite verificarla", () => {
    const { onRetry } = renderBanner({ error: "Sin conexión." });

    expect(screen.getByText("Hay una venta pendiente de verificar")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Sin conexión.");
    fireEvent.click(screen.getByRole("button", { name: "Verificar resultado" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("descartar exige confirmar la advertencia de doble cobro", () => {
    const { onDiscard } = renderBanner();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(onDiscard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]?.[0]).toContain("cobrarla dos veces");
  });

  it("mientras verifica deshabilita ambas acciones", () => {
    renderBanner({ loading: true });

    expect((screen.getByRole("button", { name: "Verificando..." }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Descartar" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
