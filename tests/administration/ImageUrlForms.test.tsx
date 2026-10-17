// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EcommerceConfigForm } from "@/modules/administration/components/EcommerceConfigForm";
import { HeroBannerConfigForm } from "@/modules/administration/components/HeroBannerConfigForm";

vi.mock("@/infrastructure/media/useCatalogImageUrl", () => ({
  useBlobPreviewUrl: () => undefined,
  useCatalogImageUrl: (_tenantId: string | null, image?: { kind: string; src?: string }) =>
    image?.kind === "url" ? image.src : "",
}));
vi.mock("@/shared/application/services/processImageUpload", () => ({
  processImageUpload: vi.fn().mockResolvedValue({ blob: new Blob(), mimeType: "image/png" }),
}));

const ecommerceValue = {
  enabled: true,
  storeName: "FerrePharma",
  requireAccountForCheckout: false,
  guestTrackingEnabled: true,
  allowedDeliveryMethods: [],
  allowedPaymentMethods: [],
} as never;

function renderEcommerce(value: Record<string, unknown> = {}) {
  const onChange = vi.fn();
  render(
    <EcommerceConfigForm
      branchOptions={[]}
      onChange={onChange}
      saving={false}
      tenantId="tenant-1"
      value={{ ...(ecommerceValue as object), ...value } as never}
    />,
  );
  return { onChange, input: screen.getByLabelText("O use una URL pública") as HTMLInputElement };
}

describe("EcommerceConfigForm: logo por URL publica", () => {
  afterEach(cleanup);

  it("una URL valida se guarda como logo de tipo url y descarta el archivo pendiente", () => {
    const { onChange, input } = renderEcommerce();

    fireEvent.change(input, { target: { value: "https://cdn.example.com/logo.png" } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        logo: { kind: "url", src: "https://cdn.example.com/logo.png" },
        pendingLogo: undefined,
        removeLogo: false,
      }),
    );
  });

  it("muestra la URL actual del logo", () => {
    const { input } = renderEcommerce({ logo: { kind: "url", src: "https://cdn.example.com/a.png" } });

    expect(input.value).toBe("https://cdn.example.com/a.png");
  });

  it("vaciar el campo con un logo existente lo marca para eliminar", () => {
    const { onChange, input } = renderEcommerce({
      logo: { kind: "url", src: "https://cdn.example.com/a.png" },
    });

    fireEvent.change(input, { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ logo: undefined, removeLogo: true }),
    );
  });

  it("vaciar el campo sin logo previo no marca eliminacion", () => {
    const { onChange, input } = renderEcommerce();
    // Un borrador invalido no llega al formulario; al vaciarlo no hay logo que eliminar.
    fireEvent.change(input, { target: { value: "htt" } });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "" } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ logo: undefined, removeLogo: false }),
    );
  });

  it("el boton Eliminar quita el logo", () => {
    const { onChange } = renderEcommerce({ logo: { kind: "url", src: "https://cdn.example.com/a.png" } });

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ logo: undefined, removeLogo: true }),
    );
  });
});

const heroValue = {
  slides: [
    { title: "Uno", description: "A" },
    { title: "Dos", description: "B", image: { kind: "url", src: "https://cdn.example.com/dos.png" } },
    { title: "Tres", description: "C" },
  ],
} as never;

function renderHero() {
  const onChange = vi.fn();
  render(
    <HeroBannerConfigForm
      onChange={onChange}
      preset={null}
      saving={false}
      tenantId="tenant-1"
      value={heroValue}
    />,
  );
  return { onChange };
}

describe("HeroBannerConfigForm: imagen de diapositiva por URL publica", () => {
  afterEach(cleanup);

  it("una URL valida se guarda en la diapositiva elegida", () => {
    const { onChange } = renderHero();

    fireEvent.change(screen.getAllByLabelText("O use una URL pública")[0], {
      target: { value: "https://cdn.example.com/uno.png" },
    });

    const slides = onChange.mock.calls[0][0].slides;
    expect(slides[0].image).toEqual({ kind: "url", src: "https://cdn.example.com/uno.png" });
    expect(slides[0].removeImage).toBe(false);
    expect(slides[1].image).toEqual({ kind: "url", src: "https://cdn.example.com/dos.png" });
  });

  it("vaciar la URL de una diapositiva con imagen la marca para eliminar", () => {
    const { onChange } = renderHero();

    fireEvent.change(screen.getAllByLabelText("O use una URL pública")[1], { target: { value: "" } });

    const slide = onChange.mock.calls[0][0].slides[1];
    expect(slide.image).toBeUndefined();
    expect(slide.removeImage).toBe(true);
  });

  it("muestra la URL actual de cada diapositiva", () => {
    renderHero();

    const inputs = screen.getAllByLabelText("O use una URL pública") as HTMLInputElement[];
    expect(inputs.map((input) => input.value)).toEqual(["", "https://cdn.example.com/dos.png", ""]);
  });
});

describe("Formularios: aviso de URL de imagen invalida al padre", () => {
  afterEach(cleanup);

  const renderLogo = (value: Record<string, unknown>, onInvalid = vi.fn()) => {
    const props = (next: Record<string, unknown>) => ({
      branchOptions: [],
      onChange: vi.fn(),
      onImageUrlInvalidChange: onInvalid,
      saving: false,
      tenantId: "tenant-1",
      value: { ...(ecommerceValue as object), ...next } as never,
    });
    const view = render(<EcommerceConfigForm {...props(value)} />);
    return {
      onInvalid,
      input: () => screen.getByLabelText("O use una URL pública") as HTMLInputElement,
      update: (next: Record<string, unknown>) =>
        view.rerender(<EcommerceConfigForm {...props(next)} />),
    };
  };

  it("logo: avisa True con un borrador invalido y False al corregir", () => {
    const { onInvalid, input } = renderLogo({});

    fireEvent.change(input(), { target: { value: "htt" } });
    expect(onInvalid).toHaveBeenLastCalledWith(true);

    fireEvent.change(input(), { target: { value: "https://cdn.example.com/a.png" } });
    expect(onInvalid).toHaveBeenLastCalledWith(false);
  });

  it("logo: si se elimina o reemplaza la imagen se descarta el error pendiente", () => {
    const current = { logo: { kind: "url", src: "https://cdn.example.com/a.png" } };
    const { onInvalid, input, update } = renderLogo(current);
    fireEvent.change(input(), { target: { value: "htt" } });
    expect(onInvalid).toHaveBeenLastCalledWith(true);

    update({ logo: undefined, removeLogo: true });

    expect(onInvalid).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input().value).toBe("");

    // Reemplazo por un archivo: el borrador invalido tambien se descarta.
    fireEvent.change(input(), { target: { value: "otra" } });
    expect(onInvalid).toHaveBeenLastCalledWith(true);
    update({ logo: undefined, removeLogo: false, pendingLogo: { blob: new Blob() } });
    expect(onInvalid).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  const renderHeroWithCallback = (slides = heroValue) => {
    const onInvalid = vi.fn();
    const props = (value: unknown) => ({
      onChange: vi.fn(),
      onImageUrlInvalidChange: onInvalid,
      preset: null,
      saving: false,
      tenantId: "tenant-1",
      value: value as never,
    });
    const view = render(<HeroBannerConfigForm {...props(slides)} />);
    return {
      onInvalid,
      inputs: () => screen.getAllByLabelText("O use una URL pública") as HTMLInputElement[],
      update: (value: unknown) => view.rerender(<HeroBannerConfigForm {...props(value)} />),
    };
  };

  it("carrusel: sigue avisando mientras quede alguna diapositiva invalida", () => {
    const { onInvalid, inputs } = renderHeroWithCallback();

    fireEvent.change(inputs()[0], { target: { value: "x" } });
    fireEvent.change(inputs()[2], { target: { value: "y" } });
    expect(onInvalid).toHaveBeenLastCalledWith(true);

    fireEvent.change(inputs()[0], { target: { value: "https://cdn.example.com/uno.png" } });
    expect(onInvalid).toHaveBeenLastCalledWith(true);

    fireEvent.change(inputs()[2], { target: { value: "" } });
    expect(onInvalid).toHaveBeenLastCalledWith(false);
  });

  it("carrusel: eliminar o reemplazar la imagen descarta el error de esa diapositiva", () => {
    const { onInvalid, inputs, update } = renderHeroWithCallback();
    fireEvent.change(inputs()[1], { target: { value: "x" } });
    expect(onInvalid).toHaveBeenLastCalledWith(true);

    update({
      slides: (heroValue as { slides: object[] }).slides.map((slide, index) =>
        index === 1 ? { ...slide, image: undefined, removeImage: true } : slide,
      ),
    });

    expect(onInvalid).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(inputs()[1].value).toBe("");
  });
});
