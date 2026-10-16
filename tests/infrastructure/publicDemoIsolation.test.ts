import { afterEach, describe, expect, it, vi } from "vitest";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { createMockDatabase } from "@/infrastructure/mock/database/createMockDatabase";
import { MockAuthRepository } from "@/infrastructure/mock/repositories/MockAuthRepository";
import { demoSeedDatabase } from "@/infrastructure/mock/seeds/demoSeed";
import {
  MOCK_DATABASE_STORAGE_KEY,
  MOCK_SESSION_STORAGE_KEY,
  PUBLIC_DEMO_DATABASE_STORAGE_KEY,
  PUBLIC_DEMO_SESSION_STORAGE_KEY,
} from "@/infrastructure/storage/storageKeys";
import { MemoryStorageAdapter } from "../inventory/mockInventoryFixtures";

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubMode(demo: boolean) {
  vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
  vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", demo ? "true" : "false");
}

describe("mock storage outside the public demo", () => {
  it("keeps the original v1 key and session key", () => {
    expect(MOCK_DATABASE_STORAGE_KEY).toBe("omniretail.mock.database.v1");
    expect(MOCK_SESSION_STORAGE_KEY).toBe("omniretail.mock.session.v1");
  });

  it("loads existing persisted data under the v1 key unchanged", () => {
    stubMode(false);
    const persisted = createMockDatabase();
    persisted.tenants[0] = { ...persisted.tenants[0], name: "Marcador Local Persistido" };
    const storage = new MemoryStorageAdapter();
    storage.set(MOCK_DATABASE_STORAGE_KEY, persisted);

    const store = new MockDatabaseStore(storage);

    expect(store.getSnapshot().tenants[0].name).toBe("Marcador Local Persistido");
    expect(storage.get(PUBLIC_DEMO_DATABASE_STORAGE_KEY)).toBeNull();
    expect(storage.get(MOCK_DATABASE_STORAGE_KEY)).not.toBeNull();
  });

  it("builds exactly the base seed, with no demo layer", () => {
    stubMode(false);
    const db = createMockDatabase();
    const emails = db.users.map((user) => user.email);
    expect(emails).toContain("admin@ferrepharma.demo");
    expect(emails.some((email) => email.endsWith("@marjym.demo"))).toBe(false);
    expect(db.authAccounts.map((account) => account.email)).toEqual(
      demoSeedDatabase.authAccounts.map((account) => account.email),
    );
    expect(db).toEqual(demoSeedDatabase);
    expect(db.tenants[0].name).toBe("Ferretería Los Simpson");
    expect(db.sales).toEqual(demoSeedDatabase.sales);
    expect(db.inventoryBalances.every((balance) => balance.branchId === "branch-centro")).toBe(true);
  });

  it("does not enable the demo layer in api mode even with the flag on", () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "api");
    vi.stubEnv("NEXT_PUBLIC_PUBLIC_DEMO", "true");
    expect(createMockDatabase().users.some((user) => user.email.endsWith("@marjym.demo"))).toBe(false);
  });
});

describe("mock storage in the public demo", () => {
  it("uses its own database key and the demo dataset", () => {
    stubMode(true);
    const storage = new MemoryStorageAdapter();
    storage.set(MOCK_DATABASE_STORAGE_KEY, { tenants: [{ id: "tenant-demo", name: "No tocar" }] });

    const store = new MockDatabaseStore(storage);
    const snapshot = store.getSnapshot();

    expect(PUBLIC_DEMO_DATABASE_STORAGE_KEY).not.toBe(MOCK_DATABASE_STORAGE_KEY);
    expect(PUBLIC_DEMO_SESSION_STORAGE_KEY).not.toBe(MOCK_SESSION_STORAGE_KEY);
    expect(snapshot.tenants[0].name).toBe("Ferretería Demo");
    expect(snapshot.users.some((user) => user.email === "admin@marjym.demo")).toBe(true);
    expect(snapshot.users.some((user) => user.email === "admin@ferrepharma.demo")).toBe(false);
    expect(snapshot.sales.length).toBeGreaterThan(0);
    expect(storage.get(PUBLIC_DEMO_DATABASE_STORAGE_KEY)).not.toBeNull();
    // La base mock normal no se toca.
    expect(storage.get<{ tenants: Array<{ name: string }> }>(MOCK_DATABASE_STORAGE_KEY)?.tenants[0].name).toBe(
      "No tocar",
    );
  });

  it("resetToSeeds restores the demo dataset", () => {
    stubMode(true);
    const store = new MockDatabaseStore(new MemoryStorageAdapter());
    store.mutate((database) => {
      database.sales.length = 0;
      database.tenants[0].name = "Cambiado";
    });
    const reset = store.resetToSeeds();
    expect(reset.sales.length).toBeGreaterThan(0);
    expect(reset.tenants[0].name).toBe("Ferretería Demo");
  });

  it("stores the mock session under the demo session key", async () => {
    stubMode(true);
    const storage = new MemoryStorageAdapter();
    const store = new MockDatabaseStore(storage);
    const auth = new MockAuthRepository(store, new DataEventBus(), storage);
    const result = await auth.login({ email: "admin@marjym.demo", passwordMock: "AdminDemo123" });
    expect(result.status).toBe("authenticated");
    expect(storage.get(PUBLIC_DEMO_SESSION_STORAGE_KEY)).not.toBeNull();
    expect(storage.get(MOCK_SESSION_STORAGE_KEY)).toBeNull();
  });
});
