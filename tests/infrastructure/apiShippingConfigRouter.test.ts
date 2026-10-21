import { describe, expect, it, vi } from "vitest";
import type { ShippingConfigRepository } from "@/core/repositories";
import type { CurrentSessionClient } from "@/infrastructure/api/CurrentSessionClient";
import { apiShippingConfigForEmployees } from "@/infrastructure/api/withApiSession";

const TENANT = "tenant-1";
const input = {
  ecommerce: { enabled: true, deliveryFee: 25, freeShippingThreshold: 300 },
  pos: { enabled: false, deliveryFee: 0 },
};

function session(permissions: string[], type = "employee") {
  return {
    get: vi.fn().mockResolvedValue({ user: { type, tenantId: TENANT }, role: { permissions } }),
  } as unknown as CurrentSessionClient;
}

const repository = (name: string) =>
  ({
    get: vi.fn().mockResolvedValue(`${name}-config`),
    save: vi.fn().mockResolvedValue(`${name}-saved`),
  }) as unknown as ShippingConfigRepository;

describe("apiShippingConfigForEmployees", () => {
  it("con el permiso de envíos lee y guarda en el backend", async () => {
    const mock = repository("mock");
    const api = repository("api");
    const router = apiShippingConfigForEmployees(
      mock,
      api,
      session(["admin.shipping_config.manage"]),
    );

    await expect(router.get(TENANT)).resolves.toBe("api-config");
    await expect(router.save(TENANT, input)).resolves.toBe("api-saved");
    expect(api.save).toHaveBeenCalledWith(TENANT, input);
    expect(mock.get).not.toHaveBeenCalled();
  });

  it("sin el permiso, o fuera de sesión de empleado, usa el mock", async () => {
    const mock = repository("mock");
    const api = repository("api");

    await expect(apiShippingConfigForEmployees(mock, api, session([])).get(TENANT)).resolves.toBe(
      "mock-config",
    );
    await expect(
      apiShippingConfigForEmployees(
        mock,
        api,
        session(["admin.shipping_config.manage"], "customer"),
      ).save(TENANT, input),
    ).resolves.toBe("mock-saved");
    expect(api.get).not.toHaveBeenCalled();
    expect(api.save).not.toHaveBeenCalled();
  });
});
