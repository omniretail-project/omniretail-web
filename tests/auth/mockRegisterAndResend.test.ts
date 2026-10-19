import { describe, expect, it } from "vitest";
import { AccountStatus, UserType } from "@/core/enums";
import type { AuthRepository } from "@/core/repositories";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockAuthRepository } from "@/infrastructure/mock/repositories/MockAuthRepository";
import { MemoryStorageAdapter } from "../inventory/mockInventoryFixtures";

const TENANT_SLUG = "ferrepharma-demo";

function createHarness() {
  const storage = new MemoryStorageAdapter();
  const store = new MockDatabaseStore(storage);
  const events: string[] = [];
  const eventBus = new DataEventBus();
  eventBus.subscribe("auth.changed", () => events.push("auth.changed"));
  eventBus.subscribe("customer.changed", () => events.push("customer.changed"));
  const auth: AuthRepository = new MockAuthRepository(store, eventBus, storage);
  return { auth, store, events };
}

const newCustomer = {
  tenantSlug: TENANT_SLUG,
  name: "Cliente Nuevo",
  email: "cliente.nuevo@tienda.test",
  passwordMock: "ClienteNuevo1!",
};

describe("MockAuthRepository.registerCustomer: misma respuesta para correo nuevo o repetido", () => {
  it("un correo nuevo crea la cuenta pendiente y devuelve el token demo", async () => {
    const { auth, store, events } = createHarness();

    const result = await auth.registerCustomer(newCustomer);

    expect(result.user).toMatchObject({ name: "Cliente Nuevo", email: "cliente.nuevo@tienda.test", type: UserType.customer });
    expect(result.emailVerificationToken).toEqual(expect.any(String));
    const account = store.getSnapshot().authAccounts.find((item) => item.email === newCustomer.email);
    expect(account?.status).toBe(AccountStatus.pending_verification);
    expect(events).toEqual(["auth.changed", "customer.changed"]);
  });

  it("un correo repetido (con otras mayusculas) no lanza, no crea nada y no expone token", async () => {
    const { auth, store, events } = createHarness();
    await auth.registerCustomer(newCustomer);
    const before = store.getSnapshot();
    events.length = 0;

    const result = await auth.registerCustomer({ ...newCustomer, email: "Cliente.Nuevo@Tienda.TEST", name: "Otro" });

    expect(result.emailVerificationToken).toBeNull();
    expect(result.user.type).toBe(UserType.customer);
    const after = store.getSnapshot();
    expect(after.users).toHaveLength(before.users.length);
    expect(after.authAccounts).toHaveLength(before.authAccounts.length);
    expect(after.customers).toHaveLength(before.customers.length);
    expect(after.emailVerifications).toHaveLength(before.emailVerifications.length);
    expect(events).toEqual([]);
  });

  it("la politica de contraseña se sigue aplicando antes de mirar el correo", async () => {
    const { auth } = createHarness();
    await expect(auth.registerCustomer({ ...newCustomer, passwordMock: "debil" })).rejects.toThrow();
  });
});

describe("MockAuthRepository.resendEmailVerification", () => {
  it("una cuenta pendiente recibe un token nuevo que no se expone", async () => {
    const { auth, store } = createHarness();
    const { emailVerificationToken } = await auth.registerCustomer(newCustomer);
    const before = store.getSnapshot().emailVerifications.length;

    await expect(
      auth.resendEmailVerification({ email: "  CLIENTE.nuevo@tienda.test ", tenantSlug: TENANT_SLUG }),
    ).resolves.toBeUndefined();

    const verifications = store.getSnapshot().emailVerifications;
    expect(verifications).toHaveLength(before + 1);
    const fresh = verifications.at(-1);
    expect(fresh?.token).not.toBe(emailVerificationToken);
    // El token nuevo sirve para verificar la cuenta.
    await expect(auth.verifyEmail(fresh!.token)).resolves.toBeDefined();
  });

  it.each([
    ["correo inexistente", { email: "nadie@tienda.test", tenantSlug: TENANT_SLUG }],
    ["otra tienda", { email: "cliente.nuevo@tienda.test", tenantSlug: "otra-tienda" }],
    ["correo invalido", { email: "no-es-correo", tenantSlug: TENANT_SLUG }],
  ])("%s: no hace nada y resuelve igual", async (_label, input) => {
    const { auth, store } = createHarness();
    await auth.registerCustomer(newCustomer);
    const before = store.getSnapshot().emailVerifications.length;

    await expect(auth.resendEmailVerification(input)).resolves.toBeUndefined();

    expect(store.getSnapshot().emailVerifications).toHaveLength(before);
  });

  it("una cuenta ya verificada no recibe token nuevo", async () => {
    const { auth, store } = createHarness();
    const { emailVerificationToken } = await auth.registerCustomer(newCustomer);
    await auth.verifyEmail(emailVerificationToken!);
    const before = store.getSnapshot().emailVerifications.length;

    await auth.resendEmailVerification({ email: newCustomer.email, tenantSlug: TENANT_SLUG });

    expect(store.getSnapshot().emailVerifications).toHaveLength(before);
  });
});
