import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleStatus, TenantStatus, UserStatus } from "@/core/enums";
import { DEFAULT_ECOMMERCE_SHIPPING, DEFAULT_POS_SHIPPING } from "@/config/shipping-policy";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockShippingConfigRepository } from "@/infrastructure/mock/repositories/MockShippingConfigRepository";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { GetShippingConfigService } from "@/modules/administration/application/services/GetShippingConfigService";
import { SaveShippingConfigService } from "@/modules/administration/application/services/SaveShippingConfigService";
import { resolveShippingConfigAdminContext } from "@/modules/administration/application/services/resolveShippingConfigAdminContext";
import type { ShippingConfigFormValue } from "@/modules/administration/application/dto/ShippingConfigDto";
import { MemoryStorageAdapter } from "../inventory/mockInventoryFixtures";

const backend = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/infrastructure/api/backendClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/infrastructure/api/backendClient")>()),
  backendFetch: backend.fetch,
}));

const TENANT = "tenant-1";

function harness(options: { permissions?: string[]; sessionId?: string | null } = {}) {
  const eventBus = new DataEventBus();
  const shippingConfig = new MockShippingConfigRepository(
    new MockDatabaseStore(new MemoryStorageAdapter()),
    eventBus,
  );
  const auditLogs = { append: vi.fn().mockResolvedValue(undefined) };
  const repositories = {
    auth: {
      getCurrentSessionId: vi
        .fn()
        .mockResolvedValue(options.sessionId === undefined ? "session-1" : options.sessionId),
      getSession: vi.fn().mockResolvedValue({ id: "session-1", userId: "user-1" }),
    },
    users: {
      getById: vi.fn().mockResolvedValue({
        id: "user-1",
        tenantId: TENANT,
        roleId: "role-1",
        status: UserStatus.active,
      }),
    },
    tenants: { getById: vi.fn().mockResolvedValue({ id: TENANT, status: TenantStatus.active }) },
    roles: {
      getByIdScoped: vi.fn().mockResolvedValue({
        id: "role-1",
        status: RoleStatus.active,
        permissions: options.permissions ?? ["admin.shipping_config.manage"],
      }),
    },
    shippingConfig,
    auditLogs,
  } as unknown as RepositoryRegistry;
  return { repositories, shippingConfig, auditLogs, eventBus };
}

const formValue: ShippingConfigFormValue = {
  ecommerce: { enabled: true, deliveryFee: "30", freeShippingThreshold: "400" },
  pos: { enabled: true, deliveryFee: "15", freeShippingThreshold: "" },
};

describe("MockShippingConfigRepository", () => {
  it("sin configuración guardada devuelve los valores por defecto del backend", async () => {
    const { shippingConfig } = harness();

    await expect(shippingConfig.get(TENANT)).resolves.toEqual({
      tenantId: TENANT,
      ecommerce: DEFAULT_ECOMMERCE_SHIPPING,
      pos: DEFAULT_POS_SHIPPING,
    });
  });

  it("guarda, reemplaza y avisa el cambio sin compartir referencias", async () => {
    const { shippingConfig, eventBus } = harness();
    const listener = vi.fn();
    eventBus.subscribe("shipping-config.changed", listener);

    await shippingConfig.save(TENANT, {
      ecommerce: { enabled: true, deliveryFee: 30 },
      pos: { enabled: false, deliveryFee: 0 },
    });
    const saved = await shippingConfig.save(TENANT, {
      ecommerce: { enabled: true, deliveryFee: 35, freeShippingThreshold: 500 },
      pos: { enabled: true, deliveryFee: 10 },
    });
    saved.pos.deliveryFee = 999;

    expect(await shippingConfig.get(TENANT)).toEqual({
      tenantId: TENANT,
      ecommerce: { enabled: true, deliveryFee: 35, freeShippingThreshold: 500 },
      pos: { enabled: true, deliveryFee: 10 },
    });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledWith({ tenantId: TENANT });
  });
});

describe("ApiShippingConfigRepository", () => {
  beforeEach(() => backend.fetch.mockReset());

  it("lee la config del backend y guarda con PUT emitiendo el cambio", async () => {
    const { ApiShippingConfigRepository } =
      await import("@/infrastructure/api/ApiShippingConfigRepository");
    const eventBus = new DataEventBus();
    const listener = vi.fn();
    eventBus.subscribe("shipping-config.changed", listener);
    const repository = new ApiShippingConfigRepository(eventBus);
    backend.fetch.mockResolvedValue({
      ecommerce: { enabled: true, deliveryFee: 30, freeShippingThreshold: 400 },
      pos: { enabled: true, deliveryFee: 15, freeShippingThreshold: null },
    });

    const read = await repository.get(TENANT);
    const saved = await repository.save(TENANT, {
      ecommerce: { enabled: true, deliveryFee: 30, freeShippingThreshold: 400 },
      pos: { enabled: true, deliveryFee: 15 },
    });

    expect(read.pos).toEqual({ enabled: true, deliveryFee: 15, freeShippingThreshold: undefined });
    expect(saved.tenantId).toBe(TENANT);
    expect(backend.fetch).toHaveBeenNthCalledWith(1, "/administration/shipping-config");
    expect(backend.fetch).toHaveBeenNthCalledWith(2, "/administration/shipping-config", {
      method: "PUT",
      body: {
        ecommerce: { enabled: true, deliveryFee: 30, freeShippingThreshold: 400 },
        pos: { enabled: true, deliveryFee: 15, freeShippingThreshold: null },
      },
    });
    expect(listener).toHaveBeenCalledWith({ tenantId: TENANT });
  });
});

describe("servicios de costo de envío", () => {
  it("lee la configuración del tenant de la sesión", async () => {
    const { repositories } = harness();

    await expect(new GetShippingConfigService(repositories).execute()).resolves.toEqual({
      ecommerce: DEFAULT_ECOMMERCE_SHIPPING,
      pos: DEFAULT_POS_SHIPPING,
    });
  });

  it("guarda la configuración validada y registra la auditoría", async () => {
    const { repositories, shippingConfig, auditLogs } = harness();

    const saved = await new SaveShippingConfigService(repositories).execute(formValue);

    expect(saved).toEqual({
      ecommerce: { enabled: true, deliveryFee: 30, freeShippingThreshold: 400 },
      pos: { enabled: true, deliveryFee: 15, freeShippingThreshold: undefined },
    });
    expect((await shippingConfig.get(TENANT)).ecommerce.deliveryFee).toBe(30);
    expect(auditLogs.append).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        actorUserId: "user-1",
        action: "shipping_config.updated",
        entityType: "ShippingConfig",
      }),
    );
  });

  it("rechaza montos inválidos sin guardar", async () => {
    const { repositories, auditLogs } = harness();

    await expect(
      new SaveShippingConfigService(repositories).execute({
        ...formValue,
        ecommerce: { enabled: true, deliveryFee: "-1", freeShippingThreshold: "" },
      }),
    ).rejects.toThrow(/tarifa de envío/);
    expect(auditLogs.append).not.toHaveBeenCalled();
  });

  it("exige el permiso de envíos y una sesión activa", async () => {
    await expect(
      resolveShippingConfigAdminContext(
        harness({ permissions: ["admin.ecommerce_config.manage"] }).repositories,
      ),
    ).rejects.toThrow(/costo de envío/);
    await expect(
      resolveShippingConfigAdminContext(harness({ sessionId: null }).repositories),
    ).rejects.toThrow(/sesion actual/);
    await expect(resolveShippingConfigAdminContext(harness().repositories)).resolves.toEqual({
      tenantId: TENANT,
      actorUserId: "user-1",
    });
  });
});
