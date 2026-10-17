import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiPublicStorefrontConfigService } from "@/modules/storefront/application/services/ApiPublicStorefrontConfigService";

const TENANT = "11111111-1111-1111-1111-111111111111";
const FILE = "33333333-3333-3333-3333-333333333333";
const SLIDE = "44444444-4444-4444-4444-444444444444";
const managed = (name: string) => `/media/${TENANT}/ecommerce/${TENANT}/${name}.png`;

function stubConfig(body: Record<string, unknown>) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        tenantId: TENANT,
        enabled: true,
        storeName: "FerrePharma",
        requireAccountForCheckout: false,
        guestTrackingEnabled: true,
        ...body,
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ApiPublicStorefrontConfigService: imagenes de la tienda", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resuelve por el proxy same-origin las rutas /media del logo y del carrusel", async () => {
    const fetchMock = stubConfig({
      logoUrl: managed(FILE),
      slides: [
        { title: "Uno", description: "a", imageUrl: managed(SLIDE) },
        { title: "Dos", description: "b", imageUrl: "https://cdn.example.com/dos.png" },
        { title: "Tres", description: "c", imageUrl: null },
      ],
    });

    const { tenantId, config } = await new ApiPublicStorefrontConfigService().execute("ferre pharma");

    expect(fetchMock).toHaveBeenCalledWith("/api/backend/public/ferre%20pharma/config", {
      cache: "no-store",
    });
    expect(tenantId).toBe(TENANT);
    expect(config.logoImageSource).toEqual({
      kind: "url",
      src: `/api/media/${TENANT}/ecommerce/${TENANT}/${FILE}.png`,
    });
    expect(config.heroBanner.slides.map((slide) => slide.imageSource)).toEqual([
      { kind: "url", src: `/api/media/${TENANT}/ecommerce/${TENANT}/${SLIDE}.png` },
      { kind: "url", src: "https://cdn.example.com/dos.png" },
      undefined,
    ]);
  });

  it("sin logo ni carrusel no inventa imagenes y copia el contacto", async () => {
    stubConfig({ logoUrl: null, contactPhone: "+502 1234-5678", contactEmail: "ventas@tienda.com" });

    const { config } = await new ApiPublicStorefrontConfigService().execute("x");

    expect(config.logoImageSource).toBeUndefined();
    expect(config.heroBanner.slides).toEqual([]);
    expect(config.contactPhone).toBe("+502 1234-5678");
    expect(config.contactEmail).toBe("ventas@tienda.com");
    expect(config.storeName).toBe("FerrePharma");
  });

  it("falla si el backend responde con error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));

    await expect(new ApiPublicStorefrontConfigService().execute("x")).rejects.toThrow(
      "No se pudo cargar la configuración de la tienda.",
    );
  });
});
