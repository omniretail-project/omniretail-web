import { describe, expect, it, vi } from "vitest";
import {
  GetInicioBusinessIdentityService,
  type PublicIdentityReader,
} from "@/modules/auth/application/services/GetInicioBusinessIdentityService";

const TENANT = "tenant-1";

function createRepositories(options: {
  tenant?: { name: string; slug?: string } | "fail";
  ecommerce?: { enabled: boolean; storeName: string; logo?: unknown } | "fail";
}) {
  const { tenant = { name: "Ferre Demo", slug: "ferre-demo" }, ecommerce = "fail" } = options;
  return {
    tenants: {
      getById: vi.fn().mockImplementation(async () => {
        if (tenant === "fail") throw new Error("tenant");
        return tenant;
      }),
    },
    businessConfig: {
      getEcommerceConfig: vi.fn().mockImplementation(async () => {
        if (ecommerce === "fail") throw new Error("ecommerce");
        return ecommerce;
      }),
    },
  } as never;
}

const logo = { kind: "url", src: "https://cdn.example.com/logo.png" } as const;

describe("GetInicioBusinessIdentityService", () => {
  it("usa la identidad publica del negocio cuando el empleado no puede leer la config e-commerce", async () => {
    const reader: PublicIdentityReader = vi.fn().mockResolvedValue({
      tenantId: TENANT,
      enabled: true,
      storeName: "FerrePharma Demo",
      logo,
    });
    const service = new GetInicioBusinessIdentityService(
      createRepositories({ ecommerce: { enabled: false, storeName: "mock" } }),
      reader,
    );

    await expect(service.execute(TENANT)).resolves.toEqual({
      businessName: "FerrePharma Demo",
      logo,
    });
    expect(reader).toHaveBeenCalledWith("ferre-demo");
  });

  it("descarta la identidad publica si pertenece a otro tenant", async () => {
    const reader: PublicIdentityReader = vi
      .fn()
      .mockResolvedValue({ tenantId: "otro", enabled: true, storeName: "Ajena", logo });
    const service = new GetInicioBusinessIdentityService(
      createRepositories({ ecommerce: { enabled: true, storeName: "Propia" } }),
      reader,
    );

    await expect(service.execute(TENANT)).resolves.toEqual({
      businessName: "Propia",
      logo: undefined,
    });
  });

  it("si la tienda publica esta deshabilitada cae al nombre del tenant y sin logo", async () => {
    const reader: PublicIdentityReader = vi
      .fn()
      .mockResolvedValue({ tenantId: TENANT, enabled: false, storeName: "Cerrada", logo });
    const service = new GetInicioBusinessIdentityService(createRepositories({}), reader);

    await expect(service.execute(TENANT)).resolves.toEqual({
      businessName: "Ferre Demo",
      logo: undefined,
    });
  });

  it("si el fetch publico falla degrada a la config autenticada sin romper el inicio", async () => {
    const reader: PublicIdentityReader = vi.fn().mockRejectedValue(new Error("503"));
    const service = new GetInicioBusinessIdentityService(
      createRepositories({ ecommerce: { enabled: true, storeName: "Propia", logo } }),
      reader,
    );

    await expect(service.execute(TENANT)).resolves.toEqual({ businessName: "Propia", logo });
  });

  it("sin lector publico (modo mock) usa solo la config e-commerce", async () => {
    const service = new GetInicioBusinessIdentityService(
      createRepositories({ tenant: { name: "Ferre Demo" }, ecommerce: { enabled: true, storeName: "Mock", logo } }),
    );

    await expect(service.execute(TENANT)).resolves.toEqual({ businessName: "Mock", logo });
  });

  it("falla solo si no se pudo obtener ninguna fuente", async () => {
    const reader: PublicIdentityReader = vi.fn().mockRejectedValue(new Error("503"));
    const service = new GetInicioBusinessIdentityService(
      createRepositories({ tenant: "fail", ecommerce: "fail" }),
      reader,
    );

    await expect(service.execute(TENANT)).rejects.toThrow("No se pudo cargar la identidad");
  });
});
