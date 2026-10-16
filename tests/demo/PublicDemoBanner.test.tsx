import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resetMockData = vi.fn();
const clearLocalSession = vi.fn(async () => undefined);

vi.mock("@/infrastructure/providers/RepositoryProvider", () => ({
  useRepositories: () => ({ auth: { clearLocalSession } }),
  useResetMockData: () => resetMockData,
}));

import { clearCatalogImageAssets } from "@/infrastructure/media/IndexedDbCatalogImageAssetRepository";
import { PublicDemoBanner } from "@/modules/auth/components/PublicDemoBanner";

const assign = vi.fn();
const originalLocation = window.location;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, assign },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("PublicDemoBanner", () => {
  it("no renderiza nada fuera de la demo publica", () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "");
    const { container } = render(<PublicDemoBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("muestra la franja con contratar y contacto cuando estan configurados", () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");
    vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", "https://marjym.example/");
    vi.stubEnv("NEXT_PUBLIC_SALES_CONTACT_URL", "https://wa.me/50200000000");
    render(<PublicDemoBanner />);

    expect(screen.getByText(/Estás en una demo con datos de ejemplo/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Contratar MARJYM/ })).toHaveAttribute(
      "href",
      "https://marjym.example/contratar",
    );
    expect(screen.getByRole("link", { name: /contactemos/ })).toHaveAttribute(
      "href",
      "https://wa.me/50200000000",
    );
  });

  it("cancelar la confirmacion no reinicia la demo", () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");
    render(<PublicDemoBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Reiniciar demo" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(resetMockData).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("al confirmar restaura los datos, cierra la sesion y vuelve al login", async () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");
    render(<PublicDemoBanner />);

    fireEvent.click(screen.getByRole("button", { name: "Reiniciar demo" }));
    const confirmButtons = screen.getAllByRole("button", { name: "Reiniciar demo" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/iniciar-sesion"));
    expect(resetMockData).toHaveBeenCalledTimes(1);
    expect(clearLocalSession).toHaveBeenCalledTimes(1);
  });

  function confirmReset() {
    fireEvent.click(screen.getByRole("button", { name: "Reiniciar demo" }));
    const confirmButtons = screen.getAllByRole("button", { name: "Reiniciar demo" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
  }

  it("respeta el orden: imagenes, datos, sesion y redireccion", async () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");
    const calls: string[] = [];
    const deleteDatabase = vi.fn(() => {
      calls.push("images");
      const request: Record<string, unknown> = { error: null };
      queueMicrotask(() => (request.onsuccess as () => void)());
      return request;
    });
    vi.stubGlobal("indexedDB", { deleteDatabase });
    resetMockData.mockImplementation(() => calls.push("data"));
    clearLocalSession.mockImplementation(async () => {
      calls.push("session");
    });
    assign.mockImplementation(() => calls.push("redirect"));
    render(<PublicDemoBanner />);

    confirmReset();

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/iniciar-sesion"));
    expect(calls).toEqual(["images", "data", "session", "redirect"]);
  });

  it("si otra pestana bloquea el borrado espera, sin tocar datos ni redirigir, y termina al liberarse", async () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");
    const request: Record<string, unknown> = { error: null };
    vi.stubGlobal("indexedDB", {
      deleteDatabase: vi.fn(() => {
        queueMicrotask(() => (request.onblocked as () => void)());
        return request;
      }),
    });
    resetMockData.mockClear();
    clearLocalSession.mockClear();
    assign.mockClear();
    render(<PublicDemoBanner />);

    confirmReset();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Esperando a que cierres las otras pestañas de la demo para terminar el reinicio…",
    );
    expect(screen.getByRole("button", { name: "Reiniciando…" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(resetMockData).not.toHaveBeenCalled();
    expect(clearLocalSession).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();

    // La otra pestana cierra su conexion: el navegador completa el borrado pendiente.
    (request.onsuccess as () => void)();

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/iniciar-sesion"));
    expect(resetMockData).toHaveBeenCalledTimes(1);
    expect(clearLocalSession).toHaveBeenCalledTimes(1);
  });

  it("si el borrado falla de verdad no redirige, no toca datos y avisa", async () => {
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");
    vi.stubGlobal("indexedDB", {
      deleteDatabase: vi.fn(() => {
        const request: Record<string, unknown> = { error: null };
        queueMicrotask(() => (request.onerror as () => void)());
        return request;
      }),
    });
    resetMockData.mockClear();
    clearLocalSession.mockClear();
    assign.mockClear();
    render(<PublicDemoBanner />);

    confirmReset();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo reiniciar la demo. Recarga la página y vuelve a intentarlo.",
    );
    expect(screen.getByRole("button", { name: "Reiniciar demo" })).toBeEnabled();
    expect(resetMockData).not.toHaveBeenCalled();
    expect(clearLocalSession).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("clearCatalogImageAssets", () => {
  function stubIndexedDb(outcome: "success" | "error" | "blocked") {
    const deleteDatabase = vi.fn(() => {
      const request: Partial<IDBOpenDBRequest> & Record<string, unknown> = { error: null };
      queueMicrotask(() => {
        const handler = request[`on${outcome}`] as (() => void) | undefined;
        handler?.();
      });
      return request;
    });
    vi.stubGlobal("indexedDB", { deleteDatabase });
    return deleteDatabase;
  }

  it("resuelve sin hacer nada si IndexedDB no existe", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(clearCatalogImageAssets()).resolves.toBeUndefined();
  });

  it("borra la base de imagenes del catalogo", async () => {
    const deleteDatabase = stubIndexedDb("success");
    await expect(clearCatalogImageAssets()).resolves.toBeUndefined();
    expect(deleteDatabase).toHaveBeenCalledWith("omniretail.catalog.assets.v1");
  });

  it("si otra pestana bloquea, avisa y sigue esperando la finalizacion real del borrado", async () => {
    const request: Record<string, unknown> = { error: null };
    vi.stubGlobal("indexedDB", { deleteDatabase: vi.fn(() => request) });
    const onBlocked = vi.fn();
    let settled = false;
    const pending = clearCatalogImageAssets({ onBlocked }).then(() => {
      settled = true;
    });

    (request.onblocked as () => void)();
    await Promise.resolve();
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    (request.onsuccess as () => void)();
    await pending;
    expect(settled).toBe(true);
  });

  it("las conexiones abiertas por el repositorio ceden la base si otra pestana la borra", async () => {
    const database = {
      close: vi.fn(),
      onversionchange: null as null | (() => void),
      transaction: () => ({
        objectStore: () => ({
          get: () => {
            const getRequest: Record<string, unknown> = { result: undefined };
            queueMicrotask(() => (getRequest.onsuccess as () => void)());
            return getRequest;
          },
        }),
      }),
    };
    vi.stubGlobal("indexedDB", {
      open: vi.fn(() => {
        const openRequest: Record<string, unknown> = { result: database };
        queueMicrotask(() => (openRequest.onsuccess as () => void)());
        return openRequest;
      }),
    });

    const { IndexedDbCatalogImageAssetRepository } = await import(
      "@/infrastructure/media/IndexedDbCatalogImageAssetRepository"
    );
    await new IndexedDbCatalogImageAssetRepository().get("tenant-demo", "asset-1");
    database.close.mockClear();

    database.onversionchange?.();
    expect(database.close).toHaveBeenCalledTimes(1);
  });

  it("rechaza si el borrado falla", async () => {
    stubIndexedDb("error");
    await expect(clearCatalogImageAssets()).rejects.toThrow("No se pudo borrar IndexedDB.");
  });
});
