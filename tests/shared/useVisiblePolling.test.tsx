import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVisiblePolling } from "@/shared/hooks/useVisiblePolling";

let visibility: DocumentVisibilityState = "visible";

function changeVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useVisiblePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  });

  afterEach(() => {
    vi.useRealTimers();
    visibility = "visible";
  });

  it("ejecuta la consulta en cada intervalo mientras la pestana esta visible", async () => {
    const callback = vi.fn();
    renderHook(() => useVisiblePolling(callback, { intervalMs: 1000, enabled: true }));

    await advance(999);
    expect(callback).not.toHaveBeenCalled();
    await advance(1);
    expect(callback).toHaveBeenCalledTimes(1);
    await advance(2000);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("no programa nada cuando esta deshabilitado", async () => {
    const callback = vi.fn();
    renderHook(() => useVisiblePolling(callback, { intervalMs: 1000, enabled: false }));

    await advance(5000);

    expect(callback).not.toHaveBeenCalled();
  });

  it("se suspende con la pestana oculta y al volver consulta de inmediato y reanuda el ciclo", async () => {
    const callback = vi.fn();
    renderHook(() => useVisiblePolling(callback, { intervalMs: 1000, enabled: true }));
    await advance(1000);
    expect(callback).toHaveBeenCalledTimes(1);

    act(() => changeVisibility("hidden"));
    await advance(10_000);
    expect(callback).toHaveBeenCalledTimes(1);

    act(() => changeVisibility("visible"));
    await advance(0);
    expect(callback).toHaveBeenCalledTimes(2);
    await advance(1000);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it("puede omitir la consulta inmediata al volver a la pestana", async () => {
    const callback = vi.fn();
    renderHook(() => useVisiblePolling(callback, { intervalMs: 1000, enabled: true, runOnVisible: false }));
    act(() => changeVisibility("hidden"));

    act(() => changeVisibility("visible"));
    await advance(0);

    expect(callback).not.toHaveBeenCalled();
  });

  it("nunca solapa dos ejecuciones: espera a que termine la anterior", async () => {
    let finish!: () => void;
    const callback = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    renderHook(() => useVisiblePolling(callback, { intervalMs: 1000, enabled: true }));

    await advance(3500);
    expect(callback).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
    });
    await advance(1000);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("un fallo de la consulta no detiene el respaldo", async () => {
    const callback = vi.fn().mockRejectedValueOnce(new Error("Red caida")).mockResolvedValue(undefined);
    renderHook(() => useVisiblePolling(callback, { intervalMs: 1000, enabled: true }));

    await advance(2000);

    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("se cancela al desmontar y al cambiar a deshabilitado", async () => {
    const callback = vi.fn();
    const view = renderHook(
      ({ enabled }) => useVisiblePolling(callback, { intervalMs: 1000, enabled }),
      { initialProps: { enabled: true } },
    );
    await advance(1000);
    expect(callback).toHaveBeenCalledTimes(1);

    view.rerender({ enabled: false });
    await advance(5000);
    expect(callback).toHaveBeenCalledTimes(1);

    view.rerender({ enabled: true });
    await advance(1000);
    expect(callback).toHaveBeenCalledTimes(2);

    view.unmount();
    await advance(5000);
    act(() => changeVisibility("hidden"));
    act(() => changeVisibility("visible"));
    await advance(5000);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("usa siempre la ultima version de la consulta sin reiniciar el temporizador", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = renderHook(
      ({ callback }) => useVisiblePolling(callback, { intervalMs: 1000, enabled: true }),
      { initialProps: { callback: first } },
    );
    await advance(500);

    view.rerender({ callback: second });
    await advance(500);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
