import { describe, expect, it, vi } from "vitest";
import { BranchStatus, BranchType, PlanStatus, SaasCapabilityKey, TenantSubscriptionStatus, TenantStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { GetPublicStorefrontConfigService } from "@/modules/storefront/application/services/GetPublicStorefrontConfigService";

const TENANT_ID = "tenant-123";
const SLUG = "ferrepharma-demo";

function createRepositories(overrides?: {
  branches?: Array<{
    id: string;
    tenantId: string;
    code: string;
    name: string;
    type: BranchType;
    status: BranchStatus;
    address?: string;
    phone?: string;
    email?: string;
    createdAt: string;
    updatedAt: string;
  }>;
}) {
  const now = new Date().toISOString();
  const branches = overrides?.branches ?? [
    {
      id: "b-centro",
      tenantId: TENANT_ID,
      code: "CENTRO",
      name: "Sucursal Centro",
      type: BranchType.main,
      status: BranchStatus.active,
      address: "Zona 1, Guatemala",
      phone: "+502 2234-1000",
      email: "centro@ferrepharma.demo",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "b-norte",
      tenantId: TENANT_ID,
      code: "NORTE",
      name: "Sucursal Norte",
      type: BranchType.store,
      status: BranchStatus.active,
      address: "Zona 17, Guatemala",
      phone: "+502 2234-2000",
      email: "norte@ferrepharma.demo",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "b-bodega",
      tenantId: TENANT_ID,
      code: "BODEGA",
      name: "Bodega Central",
      type: BranchType.warehouse,
      status: BranchStatus.active,
      address: "Carretera al Atlántico",
      createdAt: now,
      updatedAt: now,
    },
  ];

  const repos: Pick<
    RepositoryRegistry,
    "tenants" | "businessConfig" | "branches" | "plans" | "tenantSubscriptions" | "shippingConfig"
  > = {
    tenants: {
      getBySlug: vi.fn().mockResolvedValue({
        id: TENANT_ID,
        slug: SLUG,
        name: "FerrePharma",
        status: TenantStatus.active,
      }),
    } as unknown as RepositoryRegistry["tenants"],
    businessConfig: {
      getEcommerceConfig: vi.fn().mockResolvedValue({
        tenantId: TENANT_ID,
        enabled: true,
        storeName: "FerrePharma Tienda Online",
        requireAccountForCheckout: false,
        guestTrackingEnabled: true,
        contactPhone: "+502 2234-0000",
        contactEmail: "contacto@ferrepharma.demo",
      }),
      getHeroBanner: vi.fn().mockResolvedValue({ slides: [] }),
    } as unknown as RepositoryRegistry["businessConfig"],
    branches: {
      getActiveByTenant: vi.fn().mockResolvedValue(branches.filter((b) => b.status === BranchStatus.active)),
    } as unknown as RepositoryRegistry["branches"],
    plans: {
      getById: vi.fn().mockResolvedValue({
        id: "plan-pro",
        status: PlanStatus.active,
        capabilities: [SaasCapabilityKey.ecommerce],
      }),
    } as unknown as RepositoryRegistry["plans"],
    tenantSubscriptions: {
      getByTenantId: vi.fn().mockResolvedValue({
        tenantId: TENANT_ID,
        planId: "plan-pro",
        status: TenantSubscriptionStatus.active,
      }),
    } as unknown as RepositoryRegistry["tenantSubscriptions"],
    shippingConfig: {
      get: vi.fn().mockResolvedValue({
        ecommerce: { enabled: true, flatRate: 25 },
      }),
    } as unknown as RepositoryRegistry["shippingConfig"],
  };

  return repos;
}

describe("GetPublicStorefrontConfigService", () => {
  it("incluye sucursales principales (main) y tiendas (store) con su información de contacto y excluye bodegas (warehouse)", async () => {
    const repos = createRepositories();
    const service = new GetPublicStorefrontConfigService(repos);

    const result = await service.execute(SLUG);

    expect(result.storeName).toBe("FerrePharma Tienda Online");
    expect(result.branches).toHaveLength(2);

    expect(result.branches[0]).toEqual({
      id: "b-centro",
      code: "CENTRO",
      name: "Sucursal Centro",
      address: "Zona 1, Guatemala",
      phone: "+502 2234-1000",
      email: "centro@ferrepharma.demo",
    });

    expect(result.branches[1]).toEqual({
      id: "b-norte",
      code: "NORTE",
      name: "Sucursal Norte",
      address: "Zona 17, Guatemala",
      phone: "+502 2234-2000",
      email: "norte@ferrepharma.demo",
    });

    // Validar que la bodega no figura en la configuración pública
    expect(result.branches.some((b) => b.id === "b-bodega")).toBe(false);
  });

  it("devuelve una lista vacía de sucursales si solo existen bodegas activas", async () => {
    const repos = createRepositories({
      branches: [
        {
          id: "b-solo-bodega",
          tenantId: TENANT_ID,
          code: "BOD",
          name: "Bodega de Distribución",
          type: BranchType.warehouse,
          status: BranchStatus.active,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const service = new GetPublicStorefrontConfigService(repos);

    const result = await service.execute(SLUG);

    expect(result.branches).toEqual([]);
  });
});
