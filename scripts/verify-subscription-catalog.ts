/**
 * Verificación focalizada del catálogo SaaS y del read model de suscripción.
 *
 * La contratación y la facturación simuladas ya no forman parte del frontend. Este harness solo
 * comprueba migración de datos legados, composición de entitlements, lectura tenant-scoped y
 * ausencia de cupos inventados.
 */
import assert from "node:assert/strict";
import { PlanCode, SaasCapabilityKey, TenantSubscriptionStatus } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { createMockDatabase } from "@/infrastructure/mock/database/createMockDatabase";
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
import { MOCK_DATABASE_STORAGE_KEY } from "@/infrastructure/storage/storageKeys";
import { GetTenantSubscriptionDetailsService } from "@/modules/administration/application/services/GetTenantSubscriptionDetailsService";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";

class MemoryStorage extends LocalStorageAdapter {
  private readonly values = new Map<string, unknown>();

  override get<T>(key: string): T | null {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  override set<T>(key: string, value: T): void {
    this.values.set(key, structuredClone(value));
  }

  override remove(key: string): void {
    this.values.delete(key);
  }
}

async function main() {
  const fresh = createMockDatabase();
  const freshBasicPlan = fresh.planDefinitions.find((plan) => plan.code === PlanCode.basic);
  assert.ok(freshBasicPlan);
  assert.ok(freshBasicPlan.capabilities.includes(SaasCapabilityKey.inventory));
  assert.ok(freshBasicPlan.capabilities.includes(SaasCapabilityKey.pos));
  assert.ok(freshBasicPlan.capabilities.includes(SaasCapabilityKey.traceabilityLots));
  assert.ok(!freshBasicPlan.capabilities.includes(SaasCapabilityKey.ecommerce));
  assert.ok(!freshBasicPlan.capabilities.includes(SaasCapabilityKey.advancedReports));

  const storage = new MemoryStorage();
  const legacy = createMockDatabase();
  const legacyBasicPlan = legacy.planDefinitions.find((plan) => plan.code === PlanCode.basic);
  assert.ok(legacyBasicPlan);
  legacyBasicPlan.limits = { maxEmployees: 3, maxBranches: 1 };
  legacyBasicPlan.capabilities = [SaasCapabilityKey.inventory, SaasCapabilityKey.inventory];
  legacy.tenantSubscriptions[0].planId = "plan-enterprise";
  legacy.tenantSubscriptions[0].addonCodes = undefined;
  storage.set(MOCK_DATABASE_STORAGE_KEY, legacy);

  const store = new MockDatabaseStore(storage);
  const migrated = store.getSnapshot();
  const migratedSubscription = migrated.tenantSubscriptions.find(
    (subscription) => subscription.tenantId === "tenant-demo",
  );
  assert.equal(migratedSubscription?.planId, "plan-basic");
  assert.deepEqual(migratedSubscription?.addonCodes, [
    "ecommerce_delivery",
    "advanced_reports",
  ]);
  assert.deepEqual(
    migrated.planDefinitions.find((plan) => plan.code === PlanCode.basic)?.limits,
    {},
  );

  store.mutate((db) => {
    db.tenantSubscriptions.push({
      ...db.tenantSubscriptions[0],
      id: "subscription-readonly-other",
      tenantId: "tenant-readonly-other",
      addonCodes: [],
    });
    db.tenantSubscriptions.push({
      ...db.tenantSubscriptions[0],
      id: "subscription-readonly-suspended",
      tenantId: "tenant-readonly-suspended",
      status: TenantSubscriptionStatus.suspended,
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

  const details = await new GetTenantSubscriptionDetailsService(repositories).execute(
    "tenant-demo",
    ["admin.plans.read"],
  );
  assert.equal(details.plan.id, "plan-basic");
  assert.deepEqual(details.addonCodes, ["ecommerce_delivery", "advanced_reports"]);
  assert.equal(details.usage.find((item) => item.key === "maxEmployees")?.limit, null);
  assert.equal(details.usage.find((item) => item.key === "maxBranches")?.limit, null);

  const entitlements = new ResolveTenantEntitlementsService(repositories);
  const demo = await entitlements.execute("tenant-demo");
  assert.ok(demo.effectiveCapabilities.includes(SaasCapabilityKey.ecommerce));
  assert.ok(demo.effectiveCapabilities.includes(SaasCapabilityKey.advancedReports));

  const other = await entitlements.execute("tenant-readonly-other");
  assert.ok(other.effectiveCapabilities.includes(SaasCapabilityKey.inventory));
  assert.ok(!other.effectiveCapabilities.includes(SaasCapabilityKey.ecommerce));
  assert.ok(!other.effectiveCapabilities.includes(SaasCapabilityKey.advancedReports));

  const suspended = await entitlements.execute("tenant-readonly-suspended");
  assert.deepEqual(suspended.effectiveCapabilities, []);

  console.log("verify-subscription-catalog: read-only catalog, isolation and entitlements PASS");
}

void main();
