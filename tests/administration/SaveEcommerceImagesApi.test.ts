import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { EcommerceConfigInputDto } from "@/modules/administration/application/dto/EcommerceConfigDto";
import type { HeroBannerConfigInputDto } from "@/modules/administration/application/dto/HeroBannerConfigDto";
import { SaveEcommerceConfigService } from "@/modules/administration/application/services/SaveEcommerceConfigService";
import { SaveHeroBannerConfigService } from "@/modules/administration/application/services/SaveHeroBannerConfigService";
import { PartialSaveError } from "@/modules/administration/application/services/serviceHelpers";

const state = vi.hoisted(() => ({ apiMode: true }));

vi.mock("@/config/api-mode", () => ({ isApiMode: () => state.apiMode }));
vi.mock(
  "@/modules/administration/application/services/resolveEcommerceConfigAdminContext",
  () => ({
    resolveEcommerceConfigAdminContext: async () => ({ tenantId: "tenant-1", actorUserId: "actor-1" }),
  }),
);

const TENANT = "tenant-1";
const LOGO_URL = { kind: "url", src: "/api/media/t/ecommerce/t/logo-actual.png" } as const;
const NEW_FILE = new Blob(["png"], { type: "image/png" });
const draft = (blob = NEW_FILE) => ({
  blob,
  mimeType: "image/png" as const,
  byteSize: 3,
  width: 10,
  height: 10,
});

function ecommerceConfig(logo: unknown) {
  return {
    tenantId: TENANT,
    enabled: false,
    storeName: "FerrePharma",
    logo,
    requireAccountForCheckout: false,
    guestTrackingEnabled: true,
    allowedDeliveryMethods: [],
    allowedPaymentMethods: [],
    createdAt: "2026-10-09T00:00:00Z",
    updatedAt: "2026-10-09T00:00:00Z",
  };
}

function ecommerceInput(extra: Partial<EcommerceConfigInputDto> = {}): EcommerceConfigInputDto {
  return {
    enabled: false,
    storeName: "FerrePharma",
    requireAccountForCheckout: false,
    guestTrackingEnabled: true,
    allowedDeliveryMethods: [],
    allowedPaymentMethods: [],
    ...extra,
  } as EcommerceConfigInputDto;
}

function createRegistry(overrides: Record<string, unknown> = {}) {
  const businessConfig = {
    updateEcommerceConfig: vi.fn().mockResolvedValue(ecommerceConfig(LOGO_URL)),
    uploadEcommerceLogo: vi
      .fn()
      .mockResolvedValue(ecommerceConfig({ kind: "url", src: "/api/media/t/ecommerce/t/nuevo.png" })),
    updateHeroBanner: vi.fn(),
    uploadHeroBannerImage: vi.fn(),
    ...overrides,
  };
  const catalogImageAssets = { put: vi.fn(), remove: vi.fn() };
  const auditLogs = { append: vi.fn().mockResolvedValue(undefined) };
  const registry = { businessConfig, catalogImageAssets, auditLogs } as unknown as RepositoryRegistry;
  return { registry, businessConfig, catalogImageAssets, auditLogs };
}

describe("SaveEcommerceConfigService (modo api)", () => {
  beforeEach(() => {
    state.apiMode = true;
  });

  it("sin archivo nuevo guarda el formulario conservando el logo y no sube nada", async () => {
    const { registry, businessConfig, auditLogs } = createRegistry();

    const result = await new SaveEcommerceConfigService(registry).execute(
      ecommerceInput({ logo: LOGO_URL }),
    );

    expect(businessConfig.updateEcommerceConfig).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ logo: LOGO_URL, storeName: "FerrePharma" }),
    );
    expect(businessConfig.uploadEcommerceLogo).not.toHaveBeenCalled();
    expect(auditLogs.append).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ecommerce_config.updated" }),
    );
    expect(result.logo).toEqual(LOGO_URL);
  });

  it("con archivo pendiente guarda primero el formulario y despues sube el logo al backend", async () => {
    const { registry, businessConfig, catalogImageAssets } = createRegistry();

    const result = await new SaveEcommerceConfigService(registry).execute(
      ecommerceInput({ logo: LOGO_URL, pendingLogo: draft() }),
    );

    expect(businessConfig.updateEcommerceConfig).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ logo: LOGO_URL }),
    );
    expect(businessConfig.uploadEcommerceLogo).toHaveBeenCalledWith(TENANT, NEW_FILE);
    expect(businessConfig.updateEcommerceConfig.mock.invocationCallOrder[0]).toBeLessThan(
      businessConfig.uploadEcommerceLogo.mock.invocationCallOrder[0],
    );
    expect(result.logo).toEqual({ kind: "url", src: "/api/media/t/ecommerce/t/nuevo.png" });
    expect(catalogImageAssets.put).not.toHaveBeenCalled();
  });

  it("al eliminar el logo lo quita del guardado y no sube archivos", async () => {
    const { registry, businessConfig } = createRegistry({
      updateEcommerceConfig: vi.fn().mockResolvedValue(ecommerceConfig(undefined)),
    });

    const result = await new SaveEcommerceConfigService(registry).execute(
      ecommerceInput({ logo: LOGO_URL, removeLogo: true }),
    );

    expect(businessConfig.updateEcommerceConfig).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ logo: undefined }),
    );
    expect(businessConfig.uploadEcommerceLogo).not.toHaveBeenCalled();
    expect(result.logo).toBeUndefined();
  });

  it("si falla el logo devuelve lo persistido, conserva el logo anterior y audita el guardado parcial", async () => {
    const { registry, businessConfig, auditLogs } = createRegistry({
      uploadEcommerceLogo: vi.fn().mockRejectedValue(new BackendRequestError("La imagen supera el tamaño máximo.", 413)),
    });

    const failure = await new SaveEcommerceConfigService(registry)
      .execute(ecommerceInput({ logo: LOGO_URL, storeName: "FerrePharma", pendingLogo: draft() }))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PartialSaveError);
    const partial = failure as PartialSaveError<{ logo?: unknown; storeName: string }>;
    expect(partial.message).toBe(
      "Se guardaron los datos de la tienda, pero no se pudo subir el logo: La imagen supera el tamaño máximo. El logo anterior se conserva; vuelve a seleccionar la imagen y guarda de nuevo.",
    );
    // Lo persistido es lo que devolvió el guardado del formulario (con el logo anterior).
    expect(partial.persisted).toMatchObject({ storeName: "FerrePharma", logo: LOGO_URL });
    expect(businessConfig.updateEcommerceConfig).toHaveBeenCalledTimes(1);
    expect(auditLogs.append).toHaveBeenCalledTimes(1);
    expect(auditLogs.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ecommerce_config.updated",
        metadata: expect.objectContaining({ logoUploaded: false, partial: true }),
      }),
    );
  });

  it("si falla el guardado del formulario no sube el logo ni audita", async () => {
    const { registry, businessConfig, auditLogs } = createRegistry({
      updateEcommerceConfig: vi.fn().mockRejectedValue(new Error("Sin conexión")),
    });

    const failure = await new SaveEcommerceConfigService(registry)
      .execute(ecommerceInput({ pendingLogo: draft() }))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(PartialSaveError);
    expect(businessConfig.uploadEcommerceLogo).not.toHaveBeenCalled();
    expect(auditLogs.append).not.toHaveBeenCalled();
  });

  it("un logo subido correctamente queda registrado en la auditoría", async () => {
    const { registry, auditLogs } = createRegistry();
    await new SaveEcommerceConfigService(registry).execute(ecommerceInput({ pendingLogo: draft() }));
    expect(auditLogs.append).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ logoUploaded: true }) }),
    );
    expect(auditLogs.append.mock.calls[0][0].metadata).not.toHaveProperty("partial");
  });

  it("en modo mock sigue guardando el logo como asset local y no usa la subida", async () => {
    state.apiMode = false;
    const { registry, businessConfig, catalogImageAssets } = createRegistry();

    await new SaveEcommerceConfigService(registry).execute(ecommerceInput({ pendingLogo: draft() }));

    expect(catalogImageAssets.put).toHaveBeenCalledTimes(1);
    expect(businessConfig.uploadEcommerceLogo).not.toHaveBeenCalled();
    expect(businessConfig.updateEcommerceConfig).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ logo: expect.objectContaining({ kind: "mockAsset" }) }),
    );
  });
});

const slideUrl = (name: string) => ({ kind: "url", src: `/api/media/t/ecommerce/t/${name}.png` }) as const;

function heroInput(slides: HeroBannerConfigInputDto["slides"]): HeroBannerConfigInputDto {
  return { slides };
}

function heroConfig(images: (string | undefined)[]) {
  return {
    tenantId: TENANT,
    updatedAt: "2026-10-09T00:00:00Z",
    slides: images.map((name, index) => ({
      title: `Slide ${index + 1}`,
      description: "desc",
      image: name ? slideUrl(name) : undefined,
    })),
  };
}

describe("SaveHeroBannerConfigService (modo api)", () => {
  beforeEach(() => {
    state.apiMode = true;
  });

  it("guarda el carrusel conservando las URL actuales y descarta lo que no es una URL del backend", async () => {
    const { registry, businessConfig, catalogImageAssets } = createRegistry({
      updateHeroBanner: vi.fn().mockResolvedValue(heroConfig(["uno", undefined, undefined])),
    });

    const result = await new SaveHeroBannerConfigService(registry).execute(
      heroInput([
        { title: "A", description: "a", image: slideUrl("uno") },
        { title: "B", description: "b", image: { kind: "mockAsset", assetId: "x" } },
        { title: "C", description: "c", image: slideUrl("tres"), removeImage: true },
      ]),
    );

    const sent = businessConfig.updateHeroBanner.mock.calls[0][1].slides;
    expect(sent.map((slide: { image?: unknown }) => slide.image)).toEqual([
      slideUrl("uno"),
      undefined,
      undefined,
    ]);
    expect(businessConfig.uploadHeroBannerImage).not.toHaveBeenCalled();
    expect(catalogImageAssets.put).not.toHaveBeenCalled();
    expect(result.slides).toHaveLength(3);
  });

  it("sube cada imagen pendiente por su indice, en orden, despues de guardar el carrusel", async () => {
    const first = new Blob(["a"], { type: "image/png" });
    const third = new Blob(["c"], { type: "image/png" });
    const upload = vi
      .fn()
      .mockResolvedValueOnce(heroConfig(["a", undefined, undefined]))
      .mockResolvedValueOnce(heroConfig(["a", undefined, "c"]));
    const { registry, businessConfig } = createRegistry({
      updateHeroBanner: vi.fn().mockResolvedValue(heroConfig([undefined, undefined, undefined])),
      uploadHeroBannerImage: upload,
    });

    const result = await new SaveHeroBannerConfigService(registry).execute(
      heroInput([
        { title: "A", description: "a", pendingImage: draft(first) },
        { title: "B", description: "b" },
        { title: "C", description: "c", pendingImage: draft(third) },
      ]),
    );

    expect(upload.mock.calls).toEqual([
      [TENANT, 0, first],
      [TENANT, 2, third],
    ]);
    expect(businessConfig.updateHeroBanner.mock.invocationCallOrder[0]).toBeLessThan(
      upload.mock.invocationCallOrder[0],
    );
    expect(result.slides.map((slide) => slide.image)).toEqual([slideUrl("a"), undefined, slideUrl("c")]);
  });

  it("si falla una diapositiva intermedia devuelve lo persistido, no sigue y audita lo confirmado", async () => {
    const upload = vi
      .fn()
      .mockResolvedValueOnce(heroConfig(["a", undefined, undefined]))
      .mockRejectedValueOnce(new BackendRequestError("Formato no permitido.", 415));
    const { registry, auditLogs } = createRegistry({
      updateHeroBanner: vi.fn().mockResolvedValue(heroConfig([undefined, undefined, undefined])),
      uploadHeroBannerImage: upload,
    });

    const failure = await new SaveHeroBannerConfigService(registry)
      .execute(
        heroInput([
          { title: "A", description: "a", pendingImage: draft() },
          { title: "B", description: "b", pendingImage: draft() },
          { title: "C", description: "c", pendingImage: draft() },
        ]),
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PartialSaveError);
    const partial = failure as PartialSaveError<{ slides: Array<{ image?: unknown }> }>;
    expect(partial.message).toBe(
      "Se guardaron los textos del carrusel y la imagen de la diapositiva 1, pero no se pudo subir la imagen de la diapositiva 2: Formato no permitido. Tampoco se subieron las imágenes de la diapositiva 3. Vuelve a seleccionar las imágenes pendientes y guarda de nuevo.",
    );
    // La diapositiva 1 quedó con su imagen nueva; la 2 y la 3 sin imagen.
    expect(partial.persisted.slides.map((slide) => slide.image)).toEqual([slideUrl("a"), undefined, undefined]);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(auditLogs.append).toHaveBeenCalledTimes(1);
    expect(auditLogs.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "hero_banner.updated",
        metadata: { partial: true, uploadedSlides: [1], failedSlide: 2, skippedSlides: [3] },
      }),
    );
  });

  it("si falla la primera imagen informa que no se subió ninguna y devuelve los textos guardados", async () => {
    const upload = vi.fn().mockRejectedValueOnce(new BackendRequestError("Timeout", 504));
    const { registry, auditLogs } = createRegistry({
      updateHeroBanner: vi.fn().mockResolvedValue(heroConfig(["uno", undefined, undefined])),
      uploadHeroBannerImage: upload,
    });

    const failure = (await new SaveHeroBannerConfigService(registry)
      .execute(
        heroInput([
          { title: "A", description: "a", image: slideUrl("uno") },
          { title: "B", description: "b", pendingImage: draft() },
          { title: "C", description: "c" },
        ]),
      )
      .catch((error: unknown) => error)) as PartialSaveError<{ slides: Array<{ image?: unknown }> }>;

    expect(failure.message).toBe(
      "Se guardaron los textos del carrusel, pero no se pudo subir la imagen de la diapositiva 2: Timeout Vuelve a seleccionar las imágenes pendientes y guarda de nuevo.",
    );
    expect(failure.persisted.slides.map((slide) => slide.image)).toEqual([slideUrl("uno"), undefined, undefined]);
    expect(auditLogs.append.mock.calls[0][0].metadata).toEqual({
      partial: true,
      uploadedSlides: [],
      failedSlide: 2,
      skippedSlides: [],
    });
  });

  it("si falla el guardado del carrusel no sube imágenes ni audita", async () => {
    const { registry, businessConfig, auditLogs } = createRegistry({
      updateHeroBanner: vi.fn().mockRejectedValue(new Error("Sin conexión")),
    });

    await expect(
      new SaveHeroBannerConfigService(registry).execute(
        heroInput([{ title: "A", description: "a", pendingImage: draft() }]),
      ),
    ).rejects.not.toBeInstanceOf(PartialSaveError);
    expect(businessConfig.uploadHeroBannerImage).not.toHaveBeenCalled();
    expect(auditLogs.append).not.toHaveBeenCalled();
  });

  it("en modo mock sigue usando assets locales", async () => {
    state.apiMode = false;
    const { registry, businessConfig, catalogImageAssets } = createRegistry({
      updateHeroBanner: vi.fn().mockResolvedValue(heroConfig([undefined, undefined, undefined])),
    });

    await new SaveHeroBannerConfigService(registry).execute(
      heroInput([
        { title: "A", description: "a", pendingImage: draft() },
        { title: "B", description: "b" },
        { title: "C", description: "c" },
      ]),
    );

    expect(catalogImageAssets.put).toHaveBeenCalledTimes(1);
    expect(businessConfig.uploadHeroBannerImage).not.toHaveBeenCalled();
  });
});
