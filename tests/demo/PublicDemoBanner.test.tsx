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

  it("no bloquea el reinicio si otra pestana tiene la base abierta", async () => {
    stubIndexedDb("blocked");
    await expect(clearCatalogImageAssets()).resolves.toBeUndefined();
  });

  it("rechaza si el borrado falla", async () => {
    stubIndexedDb("error");
    await expect(clearCatalogImageAssets()).rejects.toThrow("No se pudo borrar IndexedDB.");
  });
});
