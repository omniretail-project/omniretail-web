// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEcommerceConfig } from "@/modules/administration/hooks/useEcommerceConfig";
import { useHeroBannerConfig } from "@/modules/administration/hooks/useHeroBannerConfig";
import { PartialSaveError } from "@/modules/administration/application/services/serviceHelpers";

const state = vi.hoisted(() => ({
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  getHero: vi.fn(),
  saveHero: vi.fn(),
  getBusinessConfig: vi.fn(),
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => {
  const repositories = {
    branches: {
      getActive: vi.fn().mockResolvedValue([{ id: "b1", name: "Centro", tenantId: "tenant-1" }]),
    },
  };
  return { useRepositories: () => repositories };
});
vi.mock("@/modules/auth/hooks/useCurrentSession", () => ({
  useCurrentSession: () => ({
    user: { tenantId: "tenant-1" },
    hasPermission: () => true,
    loading: false,
  }),
}));
vi.mock("@/shared/providers/EntitlementProvider", () => ({
  useEntitlementContext: () => ({ hasCapability: () => true }),
}));
vi.mock("@/shared/hooks/useDataEvent", () => ({ useDataEvent: () => undefined }));
vi.mock("@/modules/administration/application/services/GetEcommerceConfigService", () => ({
  GetEcommerceConfigService: class {
    execute = state.getConfig;
  },
}));
vi.mock("@/modules/administration/application/services/SaveEcommerceConfigService", () => ({
  SaveEcommerceConfigService: class {
    execute = state.saveConfig;
  },
}));
vi.mock("@/modules/administration/application/services/GetHeroBannerConfigService", () => ({
  GetHeroBannerConfigService: class {
    execute = state.getHero;
  },
}));
vi.mock("@/modules/administration/application/services/SaveHeroBannerConfigService", () => ({
  SaveHeroBannerConfigService: class {
    execute = state.saveHero;
  },
}));
vi.mock("@/modules/administration/application/services/GetBusinessConfigService", () => ({
  GetBusinessConfigService: class {
    execute = state.getBusinessConfig;
  },
}));

const imageError = new Error("El backend aún no admite subir imágenes; usa una imagen con URL pública.");

describe("useEcommerceConfig", () => {
  beforeEach(() => {
    state.getConfig.mockReset().mockResolvedValue({ storeName: "FerrePharma" });
    state.saveConfig.mockReset();
  });

  it("carga la configuracion y las sucursales del tenant", async () => {
    const { result } = renderHook(() => useEcommerceConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config).toEqual({ storeName: "FerrePharma" });
    expect(result.current.branchOptions).toEqual([{ id: "b1", name: "Centro" }]);
    expect(result.current.error).toBeNull();
  });

  it("un fallo de guardado se relanza y NO activa el banner de error de carga", async () => {
    state.saveConfig.mockRejectedValue(imageError);
    const { result } = renderHook(() => useEcommerceConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.save({} as never)).rejects.toThrow();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.saving).toBe(false);
  });

  it("un fallo de carga si se expone en error", async () => {
    state.getConfig.mockRejectedValue(new Error("sin acceso"));

    const { result } = renderHook(() => useEcommerceConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.config).toBeNull();
  });

  it("un guardado parcial muestra lo persistido y relanza el error con ese estado", async () => {
    const persisted = { storeName: "Guardada", logo: { kind: "url", src: "/api/media/viejo.png" } };
    state.saveConfig.mockRejectedValue(new PartialSaveError("No se pudo subir el logo.", persisted));
    const { result } = renderHook(() => useEcommerceConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let failure: unknown;
    await act(async () => {
      failure = await result.current.save({} as never).catch((error: unknown) => error);
    });

    expect(failure).toBeInstanceOf(PartialSaveError);
    expect(result.current.config).toEqual(persisted);
    expect(result.current.error).toBeNull();
    expect(result.current.saving).toBe(false);
  });

  it("guardar con exito actualiza la configuracion", async () => {
    state.saveConfig.mockResolvedValue({ storeName: "Nueva" });
    const { result } = renderHook(() => useEcommerceConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.save({} as never);
    });

    expect(result.current.config).toEqual({ storeName: "Nueva" });
  });
});

describe("useHeroBannerConfig", () => {
  beforeEach(() => {
    state.getHero.mockReset().mockResolvedValue({ slides: [] });
    state.saveHero.mockReset();
    state.getBusinessConfig.mockReset().mockResolvedValue({ preset: "hardware" });
  });

  it("carga el carrusel y el preset del negocio", async () => {
    const { result } = renderHook(() => useHeroBannerConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.config).toEqual({ slides: [] });
    expect(result.current.preset).toBe("hardware");
  });

  it("un fallo de guardado se relanza y NO activa el banner de error de carga", async () => {
    state.saveHero.mockRejectedValue(imageError);
    const { result } = renderHook(() => useHeroBannerConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.save({ slides: [] } as never)).rejects.toThrow();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.saving).toBe(false);
  });

  it("un guardado parcial del carrusel muestra las diapositivas persistidas", async () => {
    const persisted = { slides: [{ title: "Uno", description: "A", image: { kind: "url", src: "/api/media/a.png" } }] };
    state.saveHero.mockRejectedValue(new PartialSaveError("No se pudo subir la diapositiva 2.", persisted));
    const { result } = renderHook(() => useHeroBannerConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.save({ slides: [] } as never)).rejects.toBeInstanceOf(PartialSaveError);
    });

    expect(result.current.config).toEqual(persisted);
    expect(result.current.error).toBeNull();
  });

  it("guardar con exito actualiza el carrusel", async () => {
    state.saveHero.mockResolvedValue({ slides: [{ title: "Hola" }] });
    const { result } = renderHook(() => useHeroBannerConfig());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.save({ slides: [] } as never);
    });

    expect(result.current.config).toEqual({ slides: [{ title: "Hola" }] });
  });

  it("un fallo de carga si se expone en error", async () => {
    state.getHero.mockRejectedValue(new Error("sin acceso"));

    const { result } = renderHook(() => useHeroBannerConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeTruthy();
  });
});
