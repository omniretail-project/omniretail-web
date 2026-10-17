// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INVALID_IMAGE_URL_SUBMIT_MESSAGE } from "@/core/media/resolveImageUrlInput";
import { EcommerceConfigPage } from "@/modules/administration/pages/EcommerceConfigPage";
import { PartialSaveError } from "@/modules/administration/application/services/serviceHelpers";

const OLD_LOGO = "https://cdn.example.com/viejo.png";
const OLD_SLIDE = "https://cdn.example.com/slide.png";

function initialConfig() {
  return {
    enabled: false,
    storeName: "FerrePharma",
    logo: { kind: "url", src: OLD_LOGO },
    requireAccountForCheckout: false,
    guestTrackingEnabled: true,
    allowedDeliveryMethods: [],
    allowedPaymentMethods: [],
  };
}

function initialHeroBanner() {
  return {
    slides: [
      { title: "Uno", description: "A", image: { kind: "url", src: OLD_SLIDE } },
      { title: "Dos", description: "B" },
      { title: "Tres", description: "C" },
    ],
  };
}

// Los hooks reales guardan en su propio estado lo que el backend confirmo (tambien tras un
// PartialSaveError); la pagina se resincroniza desde ese `config`. El mock lo imita con
// `persistConfig`/`persistHeroBanner` y devuelve la misma referencia entre renders.
const state = vi.hoisted(() => ({
  save: vi.fn(),
  saveHeroBanner: vi.fn(),
  showToast: vi.fn(),
  config: null as unknown,
  heroBanner: null as unknown,
}));

vi.mock("@/infrastructure/media/useCatalogImageUrl", () => ({
  useBlobPreviewUrl: () => undefined,
  useCatalogImageUrl: (_tenantId: string | null, image?: { kind: string; src?: string }) =>
    image?.kind === "url" ? image.src : "",
}));
vi.mock("@/shared/application/services/processImageUpload", () => ({
  processImageUpload: vi.fn(),
}));
vi.mock("@/modules/administration/hooks/useStorefrontSlug", () => ({
  useStorefrontSlug: () => null,
}));
vi.mock("@/shared/components/Toast", () => ({
  useToast: () => ({ showToast: state.showToast }),
}));
vi.mock("@/modules/administration/hooks/useEcommerceConfig", () => ({
  useEcommerceConfig: () => ({
    branchOptions: [],
    canManage: true,
    config: state.config,
    error: null,
    loading: false,
    reload: vi.fn(),
    save: state.save,
    saving: false,
    tenantId: "tenant-1",
  }),
}));
vi.mock("@/modules/administration/hooks/useHeroBannerConfig", () => ({
  useHeroBannerConfig: () => ({
    config: state.heroBanner,
    error: null,
    loading: false,
    preset: null,
    reload: vi.fn(),
    save: state.saveHeroBanner,
    saving: false,
  }),
}));

const logoInput = () => screen.getByLabelText("O use una URL pública", {
  selector: "#ecommerce-logo-url",
}) as HTMLInputElement;
const slideInput = (index: number) =>
  document.getElementById(`hero-banner-image-url-${index}`) as HTMLInputElement;
const clickSave = () => fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

async function renderPage() {
  render(<EcommerceConfigPage />);
  await waitFor(() => expect(logoInput().value).toBe(OLD_LOGO));
}

describe("EcommerceConfigPage: URLs de imagen invalidas", () => {
  beforeEach(() => {
    cleanup();
    state.config = initialConfig();
    state.heroBanner = initialHeroBanner();
    state.save.mockReset().mockImplementation(async (value) => value);
    state.saveHeroBanner.mockReset().mockImplementation(async (value) => value);
    state.showToast.mockReset();
  });

  it("con una URL de logo invalida NO guarda y avisa que se conserva la imagen anterior", async () => {
    await renderPage();

    fireEvent.change(logoInput(), { target: { value: "htt" } });
    clickSave();

    expect(await screen.findByText(INVALID_IMAGE_URL_SUBMIT_MESSAGE)).toBeTruthy();
    expect(state.save).not.toHaveBeenCalled();
    expect(state.saveHeroBanner).not.toHaveBeenCalled();
  });

  it("con una URL invalida en una diapositiva del carrusel tampoco guarda", async () => {
    await renderPage();

    fireEvent.change(slideInput(1), { target: { value: "no-es-url" } });
    clickSave();

    expect(await screen.findByText(INVALID_IMAGE_URL_SUBMIT_MESSAGE)).toBeTruthy();
    expect(state.save).not.toHaveBeenCalled();
    expect(state.saveHeroBanner).not.toHaveBeenCalled();
  });

  it("al corregir la URL del logo guarda la nueva, no la anterior", async () => {
    await renderPage();
    fireEvent.change(logoInput(), { target: { value: "htt" } });
    fireEvent.change(logoInput(), { target: { value: "https://cdn.example.com/nuevo.png" } });

    clickSave();

    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
    expect(state.save.mock.calls[0][0].logo).toEqual({
      kind: "url",
      src: "https://cdn.example.com/nuevo.png",
    });
    expect(state.saveHeroBanner).toHaveBeenCalledTimes(1);
  });

  it("al eliminar el logo se descarta el borrador invalido y se guarda la eliminacion", async () => {
    await renderPage();
    fireEvent.change(logoInput(), { target: { value: "htt" } });
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[0]);
    expect(logoInput().value).toBe("");

    clickSave();

    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
    expect(state.save.mock.calls[0][0]).toMatchObject({ logo: undefined, removeLogo: true });
  });

  it("al eliminar la imagen de una diapositiva con URL invalida pendiente se puede guardar", async () => {
    await renderPage();
    fireEvent.change(slideInput(0), { target: { value: "htt" } });
    clickSave();
    expect(await screen.findByText(INVALID_IMAGE_URL_SUBMIT_MESSAGE)).toBeTruthy();

    // Los botones "Eliminar" son: logo (0) y diapositiva 1 (1).
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar" })[1]);
    clickSave();

    await waitFor(() => expect(state.saveHeroBanner).toHaveBeenCalledTimes(1));
    expect(state.saveHeroBanner.mock.calls[0][0].slides[0]).toMatchObject({
      image: undefined,
      removeImage: true,
    });
  });

  it("sin URLs invalidas guarda normalmente", async () => {
    await renderPage();

    clickSave();

    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
    expect(state.saveHeroBanner).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(INVALID_IMAGE_URL_SUBMIT_MESSAGE)).toBeNull();
  });
});

describe("EcommerceConfigPage: guardado parcial de imágenes", () => {
  beforeEach(() => {
    cleanup();
    state.config = initialConfig();
    state.heroBanner = initialHeroBanner();
    state.showToast.mockReset();
    state.save.mockReset().mockImplementation(async (value) => value);
    state.saveHeroBanner.mockReset().mockImplementation(async (value) => value);
  });

  it("si falla el logo muestra el motivo, sincroniza el formulario con lo guardado y no anuncia éxito", async () => {
    const persistedLogo = "https://cdn.example.com/guardado.png";
    state.save.mockImplementation(async (value) => {
      const persisted = {
        ...value,
        storeName: "FerrePharma Guardada",
        logo: { kind: "url", src: persistedLogo },
      };
      state.config = persisted;
      throw new PartialSaveError(
        "Se guardaron los datos de la tienda, pero no se pudo subir el logo.",
        persisted,
      );
    });
    await renderPage();

    clickSave();

    await waitFor(() =>
      expect(
        screen.getByText("Se guardaron los datos de la tienda, pero no se pudo subir el logo."),
      ).toBeInTheDocument(),
    );
    await waitFor(() => expect(logoInput().value).toBe(persistedLogo));
    expect(state.saveHeroBanner).toHaveBeenCalledTimes(1);
    expect(state.showToast).not.toHaveBeenCalled();
  });

  it("si falla una diapositiva intermedia conserva el guardado del logo y refleja el carrusel persistido", async () => {
    const savedSlide = "https://cdn.example.com/slide-guardada.png";
    state.saveHeroBanner.mockImplementation(async () => {
      const persisted = {
        slides: [
          { title: "Uno", description: "A", image: { kind: "url", src: savedSlide } },
          { title: "Dos", description: "B" },
          { title: "Tres", description: "C" },
        ],
      };
      state.heroBanner = persisted;
      throw new PartialSaveError("No se pudo subir la imagen de la diapositiva 2.", persisted);
    });
    await renderPage();

    clickSave();

    await waitFor(() =>
      expect(screen.getByText("No se pudo subir la imagen de la diapositiva 2.")).toBeInTheDocument(),
    );
    await waitFor(() => expect(slideInput(0).value).toBe(savedSlide));
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(state.showToast).not.toHaveBeenCalled();
  });

  it("si una parte falla sin guardar nada, muestra el error y conserva lo que el usuario editó", async () => {
    state.saveHeroBanner.mockRejectedValue(new Error("Sin conexión con el servidor."));
    await renderPage();
    fireEvent.change(slideInput(1), { target: { value: "https://cdn.example.com/nueva.png" } });

    clickSave();

    await waitFor(() => expect(screen.getByText("Sin conexión con el servidor.")).toBeInTheDocument());
    expect(slideInput(1).value).toBe("https://cdn.example.com/nueva.png");
    expect(state.showToast).not.toHaveBeenCalled();
  });

  it("si todo se guarda anuncia el éxito", async () => {
    await renderPage();
    clickSave();
    await waitFor(() => expect(state.showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: "success" })));
  });
});
