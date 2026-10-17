import { describe, expect, it, vi } from "vitest";
import type { BusinessConfigRepository } from "@/core/repositories";
import type { CurrentSessionClient } from "@/infrastructure/api/CurrentSessionClient";
import { apiBusinessConfigForEmployees } from "@/infrastructure/api/withApiSession";

const TENANT = "tenant-1";

function session(permissions: string[], type = "employee") {
  return {
    get: vi.fn().mockResolvedValue({ user: { type, tenantId: TENANT }, role: { permissions } }),
  } as unknown as CurrentSessionClient;
}

const repository = (name: string) =>
  ({
    uploadEcommerceLogo: vi.fn().mockResolvedValue(`${name}-logo`),
    uploadHeroBannerImage: vi.fn().mockResolvedValue(`${name}-slide`),
  }) as unknown as BusinessConfigRepository;

describe("apiBusinessConfigForEmployees: subida de imagenes", () => {
  it("con el permiso de e-commerce la subida va al backend", async () => {
    const mock = repository("mock");
    const api = repository("api");
    const router = apiBusinessConfigForEmployees(
      mock,
      api,
      session(["admin.ecommerce_config.manage"]),
    );
    const file = new Blob(["x"]);

    await expect(router.uploadEcommerceLogo(TENANT, file)).resolves.toBe("api-logo");
    await expect(router.uploadHeroBannerImage(TENANT, 2, file)).resolves.toBe("api-slide");

    expect(api.uploadEcommerceLogo).toHaveBeenCalledWith(TENANT, file);
    expect(api.uploadHeroBannerImage).toHaveBeenCalledWith(TENANT, 2, file);
    expect(mock.uploadEcommerceLogo).not.toHaveBeenCalled();
  });

  it("sin el permiso la subida no llega al backend", async () => {
    const mock = repository("mock");
    const api = repository("api");
    const router = apiBusinessConfigForEmployees(mock, api, session([]));

    await expect(router.uploadEcommerceLogo(TENANT, new Blob(["x"]))).resolves.toBe("mock-logo");

    expect(api.uploadEcommerceLogo).not.toHaveBeenCalled();
  });
});
