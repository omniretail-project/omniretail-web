import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CustomerPaymentMethodStatus, PaymentMethod } from "@/core/enums";
import { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { MockCustomerPaymentMethodRepository } from "@/infrastructure/mock/repositories/MockCustomerPaymentMethodRepository";
import type { PaymentMethodFormDto } from "@/modules/customer/application/dto/PaymentMethodFormDto";
import {
  createPaymentMethod,
  listPaymentMethods,
  removePaymentMethod,
  updatePaymentMethod,
} from "@/modules/customer/application/services/paymentMethodService";
import { MemoryStorageAdapter } from "../inventory/mockInventoryFixtures";

const TENANT_ID = "tenant-demo";
const CUSTOMER_ID = "customer-ana";

vi.mock("@/modules/customer/application/services/CustomerAuthorizationContext", () => ({
  resolveCustomerAuthorizationContext: async () => ({
    tenantId: "tenant-demo",
    customerId: "customer-ana",
  }),
}));

const ALLOWED_CREATE_KEYS = [
  "brand",
  "cardholderName",
  "customerId",
  "expirationMonth",
  "expirationYear",
  "issuingBank",
  "last4",
  "tenantId",
];

function createScenario() {
  const store = new MockDatabaseStore(new MemoryStorageAdapter());
  const customerPaymentMethods = new MockCustomerPaymentMethodRepository(store, new DataEventBus());
  const createSpy = vi.spyOn(customerPaymentMethods, "create");
  const repositories = { customerPaymentMethods } as unknown as Parameters<
    typeof createPaymentMethod
  >[0];
  return { store, repositories, createSpy };
}

function form(patch: Partial<PaymentMethodFormDto> = {}): PaymentMethodFormDto {
  return {
    cardNumber: "4242 4242 4242 4242",
    cardholderName: "Ana López",
    expiration: "12/30",
    cvv: "123",
    issuingBank: "BAC Credomatic",
    ...patch,
  };
}

describe("paymentMethodService", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 15));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["4242 4242 4242 4242", "123", "Visa", "4242"],
    ["5555 5555 5555 4444", "123", "Mastercard", "4444"],
    ["3782 822463 10005", "1234", "American Express", "0005"],
  ])("toma last4 y brand del número %s", async (cardNumber, cvv, brand, last4) => {
    const { repositories, createSpy } = createScenario();

    const created = await createPaymentMethod(repositories, form({ cardNumber, cvv }));

    expect(created).toMatchObject({ brand, last4, expirationMonth: 12, expirationYear: 2030 });
    expect(createSpy).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      brand,
      issuingBank: "BAC Credomatic",
      last4,
      expirationMonth: 12,
      expirationYear: 2030,
      cardholderName: "Ana López",
    });
  });

  it("no envía al repositorio el número completo, el CVV ni el token del proveedor", async () => {
    const { repositories, createSpy, store } = createScenario();

    await createPaymentMethod(repositories, form({ cvv: "987" }));

    const payload = createSpy.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(ALLOWED_CREATE_KEYS);
    expect(payload).not.toHaveProperty("cardNumber");
    expect(payload).not.toHaveProperty("cvv");
    expect(payload).not.toHaveProperty("providerPaymentMethodId");
    expect(JSON.stringify(payload)).not.toContain("4242424242424242");
    expect(JSON.stringify(payload)).not.toContain("987");
    expect(JSON.stringify(store.getSnapshot())).not.toContain("4242424242424242");
  });

  it("no llama al repositorio si la tarjeta no es válida", async () => {
    const { repositories, createSpy } = createScenario();

    await expect(
      createPaymentMethod(repositories, form({ cardNumber: "6011 1111 1111 1117" })),
    ).rejects.toThrow("Solo se aceptan tarjetas Visa, Mastercard o American Express.");
    await expect(
      createPaymentMethod(repositories, form({ cardNumber: "4242 4242 4242 4241" })),
    ).rejects.toThrow("El número de tarjeta no es válido.");
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("una tarjeta Discover ya guardada se lista, se edita y se elimina sin error", async () => {
    const { repositories, store } = createScenario();
    store.mutate((db) => {
      db.customerPaymentMethods.push({
        id: "cpm-ana-discover",
        tenantId: TENANT_ID,
        customerId: CUSTOMER_ID,
        type: PaymentMethod.card,
        providerPaymentMethodId: "pm_demo_ana_discover",
        brand: "Discover",
        issuingBank: "Banco Industrial",
        last4: "1117",
        expirationMonth: 5,
        expirationYear: 2028,
        isDefault: false,
        status: CustomerPaymentMethodStatus.active,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    expect((await listPaymentMethods(repositories)).map((method) => method.brand)).toContain(
      "Discover",
    );

    const updated = await updatePaymentMethod(
      repositories,
      "cpm-ana-discover",
      form({ cardNumber: "", cvv: "", cardholderName: "", expiration: "06/31" }),
    );
    expect(updated).toMatchObject({
      brand: "Discover",
      last4: "1117",
      expirationMonth: 6,
      expirationYear: 2031,
      cardholderName: undefined,
    });

    await removePaymentMethod(repositories, "cpm-ana-discover");
    expect((await listPaymentMethods(repositories)).some((method) => method.brand === "Discover")).toBe(
      false,
    );
  });
});
