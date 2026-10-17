import { describe, expect, it, vi } from "vitest";
import type { PlanDefinition, TenantSubscription } from "@/core/entities";
import type { PlanRepository, TenantSubscriptionRepository } from "@/core/repositories";
import type { ApiSessionEntitlements, ApiSessionEntitlementsClient } from "@/infrastructure/api/ApiSessionEntitlementsClient";
import type { CurrentSessionClient } from "@/infrastructure/api/CurrentSessionClient";
import { apiPlansForEmployees, apiSubscriptionsForEmployees } from "@/infrastructure/api/withApiSession";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";

const TENANT = "tenant-1";

const ENTITLEMENTS: ApiSessionEntitlements = {
  tenantId: TENANT,
  planCode: "basic",
  planStatus: "active",
  subscriptionStatus: "active",
  isEntitlementActive: true,
  capabilities: ["pos", "inventory"],
  effectiveCapabilities: ["pos", "inventory"],
  limits: {},
};

function session(type: string, permissions: string[], tenantId = TENANT) {
  return {
    get: vi.fn().mockResolvedValue({ user: { type, tenantId }, role: { permissions } }),
  } as unknown as CurrentSessionClient;
}

function createRepositories() {
  const mockSubscription = { id: "mock-sub", tenantId: TENANT, planId: "mock-plan" } as TenantSubscription;
  const apiSubscription = { id: "api-sub", tenantId: TENANT, planId: "api-plan" } as TenantSubscription;
  const mockPlan = { id: "mock-plan", capabilities: [] } as unknown as PlanDefinition;
  const apiPlan = { id: "api-plan", capabilities: ["pos"] } as unknown as PlanDefinition;
  const mockSubscriptions = {
    getByTenantId: vi.fn().mockResolvedValue(mockSubscription),
  } as unknown as TenantSubscriptionRepository;
  const apiSubscriptions = {
    getByTenantId: vi.fn().mockResolvedValue(apiSubscription),
  } as unknown as TenantSubscriptionRepository;
  const mockPlans = { getById: vi.fn().mockResolvedValue(mockPlan) } as unknown as PlanRepository;
  const apiPlans = { getById: vi.fn().mockResolvedValue(apiPlan) } as unknown as PlanRepository;
  const entitlements = {
    get: vi.fn().mockResolvedValue(ENTITLEMENTS),
  } as unknown as ApiSessionEntitlementsClient;
  return { mockSubscriptions, apiSubscriptions, mockPlans, apiPlans, entitlements };
}

function build(currentSession: CurrentSessionClient, entitlementsResponse?: ApiSessionEntitlements | null) {
  const repositories = createRepositories();
  if (entitlementsResponse !== undefined) {
    vi.mocked(repositories.entitlements.get).mockResolvedValue(entitlementsResponse);
  }
  return {
    ...repositories,
    subscriptions: apiSubscriptionsForEmployees(
      repositories.mockSubscriptions,
      repositories.apiSubscriptions,
      currentSession,
      repositories.entitlements,
    ),
    plans: apiPlansForEmployees(
      repositories.mockPlans,
      repositories.apiPlans,
      currentSession,
      repositories.entitlements,
    ),
  };
}

describe("entitlements de empleados sin admin.plans.read", () => {
  it("un cajero obtiene suscripcion y plan derivados, sin tocar /admin ni el mock", async () => {
    const { subscriptions, plans, apiSubscriptions, apiPlans, mockSubscriptions, mockPlans } = build(
      session("employee", ["pos.cash.open"]),
    );

    const subscription = await subscriptions.getByTenantId(TENANT);
    const plan = await plans.getById(subscription?.planId ?? "");

    expect(subscription).toMatchObject({ tenantId: TENANT, status: "active", addonCodes: [] });
    expect(plan).toMatchObject({ code: "basic", capabilities: ["pos", "inventory"] });
    expect(apiSubscriptions.getByTenantId).not.toHaveBeenCalled();
    expect(apiPlans.getById).not.toHaveBeenCalled();
    expect(mockSubscriptions.getByTenantId).not.toHaveBeenCalled();
    expect(mockPlans.getById).not.toHaveBeenCalled();
  });

  it("alimenta al resolver: el cajero tiene la capacidad pos", async () => {
    const { subscriptions, plans } = build(session("employee", ["pos.cash.open"]));
    const service = new ResolveTenantEntitlementsService({
      tenantSubscriptions: subscriptions,
      plans,
    } as unknown as Pick<RepositoryRegistry, "plans" | "tenantSubscriptions">);

    const result = await service.execute(TENANT);

    expect(result.isEntitlementActive).toBe(true);
    expect(result.effectiveCapabilities).toEqual(["pos", "inventory"]);
  });

  it("suscripcion suspendida: el resolver no concede capacidades efectivas", async () => {
    const { subscriptions, plans } = build(session("employee", []), {
      ...ENTITLEMENTS,
      subscriptionStatus: "suspended",
      isEntitlementActive: false,
      effectiveCapabilities: [],
    });
    const service = new ResolveTenantEntitlementsService({
      tenantSubscriptions: subscriptions,
      plans,
    } as unknown as Pick<RepositoryRegistry, "plans" | "tenantSubscriptions">);

    const result = await service.execute(TENANT);

    expect(result.isEntitlementActive).toBe(false);
    expect(result.effectiveCapabilities).toEqual([]);
  });

  it("sin suscripcion en el backend (404) no hay suscripcion ni plan: falla cerrado", async () => {
    const { subscriptions, plans } = build(session("employee", []), null);

    expect(await subscriptions.getByTenantId(TENANT)).toBeNull();
    expect(await plans.getById(`session-plan:${TENANT}`)).toBeNull();
  });

  it("con admin.plans.read conserva el flujo administrativo", async () => {
    const { subscriptions, plans, apiSubscriptions, apiPlans, entitlements } = build(
      session("employee", ["admin.plans.read"]),
    );

    expect((await subscriptions.getByTenantId(TENANT))?.id).toBe("api-sub");
    expect((await plans.getById("api-plan"))?.id).toBe("api-plan");
    expect(apiSubscriptions.getByTenantId).toHaveBeenCalled();
    expect(apiPlans.getById).toHaveBeenCalled();
    expect(entitlements.get).not.toHaveBeenCalled();
  });

  it("clientes y empleados de otra tienda siguen leyendo el mock", async () => {
    const customer = build(session("customer", []));
    expect((await customer.subscriptions.getByTenantId(TENANT))?.id).toBe("mock-sub");
    expect(customer.entitlements.get).not.toHaveBeenCalled();

    const foreign = build(session("employee", [], "tenant-2"));
    expect((await foreign.subscriptions.getByTenantId(TENANT))?.id).toBe("mock-sub");
    expect(foreign.entitlements.get).not.toHaveBeenCalled();
  });

  it("un plan sintetico de otra tienda no se resuelve", async () => {
    const { plans, entitlements } = build(session("employee", []));

    expect(await plans.getById("session-plan:tenant-2")).toBeNull();
    expect(entitlements.get).not.toHaveBeenCalled();
  });

  it("sin cliente de entitlements conserva el comportamiento anterior (mock sin permiso)", async () => {
    const repositories = createRepositories();
    const subscriptions = apiSubscriptionsForEmployees(
      repositories.mockSubscriptions,
      repositories.apiSubscriptions,
      session("employee", []),
    );

    expect((await subscriptions.getByTenantId(TENANT))?.id).toBe("mock-sub");
  });
});
