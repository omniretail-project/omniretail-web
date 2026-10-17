import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { ApiBusinessConfigRepository } from "@/infrastructure/api/ApiBusinessConfigRepository";
import { backendFetch } from "@/infrastructure/api/backendClient";
import { MockBusinessConfigRepository } from "@/infrastructure/mock/repositories/MockBusinessConfigRepository";

vi.mock("@/infrastructure/api/backendClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/infrastructure/api/backendClient")>()),
  backendFetch: vi.fn(),
}));

const TENANT = "11111111-1111-1111-1111-111111111111";
const FILE_ID = "33333333-3333-3333-3333-333333333333";
const mediaPath = `/media/${TENANT}/ecommerce/${TENANT}/${FILE_ID}.png`;

function createRepository() {
  const eventBus = { emit: vi.fn(), subscribe: vi.fn() } as unknown as DataEventBus;
  return { repository: new ApiBusinessConfigRepository(eventBus), eventBus };
}

const apiEcommerce = (logoUrl: string | null) => ({
  tenantId: TENANT,
  enabled: false,
  storeName: "FerrePharma",
  logoUrl,
  contactPhone: null,
  contactEmail: null,
  requireAccountForCheckout: false,
  guestTrackingEnabled: true,
  allowedDeliveryMethods: null,
  allowedPaymentMethods: null,
  defaultBranchId: null,
});

describe("ApiBusinessConfigRepository: subida de imagenes", () => {
  beforeEach(() => {
    vi.mocked(backendFetch).mockReset();
  });

  it("sube el logo como multipart al endpoint del backend y resuelve la ruta relativa por el proxy", async () => {
    vi.mocked(backendFetch).mockResolvedValue(apiEcommerce(mediaPath));
    const { repository, eventBus } = createRepository();
    const file = new Blob(["png"], { type: "image/png" });

    const config = await repository.uploadEcommerceLogo(TENANT, file);

    const [path, options] = vi.mocked(backendFetch).mock.calls[0] as [string, { method: string; body: FormData }];
    expect(path).toBe("/administration/ecommerce-config/logo");
    expect(options.method).toBe("POST");
    const sent = options.body.get("file") as File;
    expect(sent.name).toBe("logo.png");
    expect(sent.type).toBe("image/png");
    expect(config.logo).toEqual({ kind: "url", src: `/api/media/${TENANT}/ecommerce/${TENANT}/${FILE_ID}.png` });
    expect(eventBus.emit).toHaveBeenCalledWith("business-config.changed", {
      tenantId: TENANT,
      action: "updated",
    });
  });

  it("usa un nombre coherente con el tipo del archivo", async () => {
    vi.mocked(backendFetch).mockResolvedValue(apiEcommerce(null));
    const { repository } = createRepository();

    await repository.uploadEcommerceLogo(TENANT, new Blob(["w"], { type: "image/webp" }));
    await repository.uploadEcommerceLogo(TENANT, new Blob(["x"], { type: "application/octet-stream" }));

    const names = vi
      .mocked(backendFetch)
      .mock.calls.map(([, options]) => ((options as { body: FormData }).body.get("file") as File).name);
    expect(names).toEqual(["logo.webp", "logo.jpg"]);
  });

  it("sube la imagen de una diapositiva por su indice", async () => {
    vi.mocked(backendFetch).mockResolvedValue({
      slides: [
        { title: "A", description: "a", imageUrl: null },
        { title: "B", description: "b", imageUrl: mediaPath },
        { title: "C", description: "c", imageUrl: null },
      ],
    });
    const { repository, eventBus } = createRepository();

    const banner = await repository.uploadHeroBannerImage(
      TENANT,
      1,
      new Blob(["png"], { type: "image/png" }),
    );

    const [path, options] = vi.mocked(backendFetch).mock.calls[0] as [string, { method: string; body: FormData }];
    expect(path).toBe("/administration/hero-banner/slides/1/image");
    expect(options.method).toBe("POST");
    expect((options.body.get("file") as File).name).toBe("slide-2.png");
    expect(banner.slides[1].image).toEqual({
      kind: "url",
      src: `/api/media/${TENANT}/ecommerce/${TENANT}/${FILE_ID}.png`,
    });
    expect(banner.slides[0].image).toBeUndefined();
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
  });

  it("rechaza un indice de diapositiva invalido sin llamar al backend", async () => {
    const { repository } = createRepository();

    await expect(repository.uploadHeroBannerImage(TENANT, -1, new Blob(["x"]))).rejects.toThrow(
      "Diapositiva no válida.",
    );
    await expect(repository.uploadHeroBannerImage(TENANT, 1.5, new Blob(["x"]))).rejects.toThrow();
    expect(backendFetch).not.toHaveBeenCalled();
  });

  it("propaga el error del backend (por ejemplo tipo o tamano invalido)", async () => {
    vi.mocked(backendFetch).mockRejectedValue(new Error("415"));
    const { repository, eventBus } = createRepository();

    await expect(repository.uploadEcommerceLogo(TENANT, new Blob(["x"]))).rejects.toThrow("415");
    expect(eventBus.emit).not.toHaveBeenCalled();
  });
});

describe("MockBusinessConfigRepository", () => {
  it("no ofrece la subida al servidor: solo existe en modo api", async () => {
    const repository = new MockBusinessConfigRepository({} as never, {} as never);

    await expect(repository.uploadEcommerceLogo()).rejects.toThrow("solo está disponible en modo API");
    await expect(repository.uploadHeroBannerImage()).rejects.toThrow("solo está disponible en modo API");
  });
});
