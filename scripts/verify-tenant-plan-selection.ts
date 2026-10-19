/**
 * Harness de compatibilidad para la pantalla de plan, ahora estrictamente de solo lectura.
 *
 * El nombre del archivo se conserva para no romper invocaciones manuales existentes. Ya no
 * valida selección ni mutaciones de plan: comprueba permisos de lectura, ausencia de efectos,
 * lectura histórica de un plan archivado y aislamiento entre tenants.
 */
import assert from "node:assert/strict";
import { SaasCapabilityKey } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import {
  MockBranchRepository,
  MockBusinessConfigRepository,
  MockPlanRepository,
  MockTenantSubscriptionRepository,
  MockUserRepository,
} from "@/infrastructure/mock/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { LocalStorageAdapter } from "@/infrastructure/storage/LocalStorageAdapter";
import { GetTenantSubscriptionDetailsService } from "@/modules/administration/application/services/GetTenantSubscriptionDetailsService";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";

class MemoryStorageAdapter extends LocalStorageAdapter {
  private readonly values = new Map<string, string>();

  override get<T>(key: string): T | null {
    const value = this.values.get(key);
    return value === undefined ? null : (JSON.parse(value) as T);
  }

  override set<T>(key: string, value: T): void {
    this.values.set(key, JSON.stringify(value));
  }

  override remove(key: string): void {
    this.values.delete(key);
  }
}

async function main() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  store.mutate((db) => {
    const demoSubscription = db.tenantSubscriptions[0];
    const demoUser = db.users.find((user) => user.id === "user-admin");
    const demoBranch = db.branches.find((branch) => branch.id === "branch-centro");
    assert.ok(demoSubscription);
    assert.ok(demoUser);
    assert.ok(demoBranch);

    db.tenantSubscriptions.push(
      {
        ...demoSubscription,
        id: "subscription-plan-read-a",
        tenantId: "tenant-plan-read-a",
        addonCodes: ["advanced_reports"],
      },
      {
        ...demoSubscription,
        id: "subscription-plan-read-b",
        tenantId: "tenant-plan-read-b",
        addonCodes: [],
      },
      {
        ...demoSubscription,
        id: "subscription-plan-history",
        tenantId: "tenant-plan-history",
        planId: "plan-enterprise",
        addonCodes: [],
      },
    );
    db.users.push({
      ...demoUser,
      id: "user-plan-read-a",
      tenantId: "tenant-plan-read-a",
      email: "admin-a@plan-read.test",
    });
    db.branches.push({
      ...demoBranch,
      id: "branch-plan-read-a",
      tenantId: "tenant-plan-read-a",
      code: "PLAN-A",
    });
  });

  const events = new DataEventBus();
  const repositories = {
    plans: new MockPlanRepository(store, events),
    tenantSubscriptions: new MockTenantSubscriptionRepository(store, events),
    users: new MockUserRepository(store, events),
    branches: new MockBranchRepository(store, events),
    businessConfig: new MockBusinessConfigRepository(store, events),
  } as unknown as RepositoryRegistry;
  const service = new GetTenantSubscriptionDetailsService(repositories);

  await assert.rejects(
    service.execute("tenant-demo", []),
    AdministrationServiceError,
    "la lectura exige admin.plans.read",
  );

  const demoBefore = await repositories.tenantSubscriptions.getByTenantId("tenant-demo");
  const demoDetails = await service.execute("tenant-demo", ["admin.plans.read"]);
  const demoAfter = await repositories.tenantSubscriptions.getByTenantId("tenant-demo");
  assert.deepEqual(demoAfter, demoBefore, "consultar el plan no debe mutar la suscripción");
  assert.equal(demoDetails.plan.id, "plan-basic");
  assert.ok(
    demoDetails.capabilities.some(
      (capability) => capability.key === SaasCapabilityKey.inventory && capability.included,
    ),
  );

  const tenantA = await service.execute("tenant-plan-read-a", ["admin.plans.read"]);
  const tenantB = await service.execute("tenant-plan-read-b", ["admin.plans.read"]);
  assert.deepEqual(tenantA.addonCodes, ["advanced_reports"]);
  assert.deepEqual(tenantB.addonCodes, []);
  assert.equal(tenantA.usage.find((item) => item.key === "maxEmployees")?.current, 1);
  assert.equal(tenantB.usage.find((item) => item.key === "maxEmployees")?.current, 0);

  const historical = await service.execute("tenant-plan-history", ["admin.plans.read"]);
  assert.equal(historical.plan.id, "plan-enterprise");
  assert.ok(
    historical.capabilities.some(
      (capability) => capability.key === SaasCapabilityKey.ecommerce && capability.included,
    ),
    "la vista conserva la descripción histórica aunque el plan ya esté archivado",
  );

  console.log("verify-tenant-plan-selection: read-only plan, history and tenant isolation PASS");
}

void main();
