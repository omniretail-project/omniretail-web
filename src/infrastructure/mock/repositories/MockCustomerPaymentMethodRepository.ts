import type { CustomerPaymentMethod } from "@/core/entities";
import type {
  CreateCustomerPaymentMethodInput,
  CustomerPaymentMethodRepository,
  UpdateCustomerPaymentMethodInput,
} from "@/core/repositories";
import { CARD_BRANDS, MAX_EXPIRATION_YEARS_AHEAD } from "@/config/card-brands";
import { GUATEMALA_BANKS } from "@/config/guatemala-banks";
import { CustomerPaymentMethodStatus, PaymentMethod } from "@/core/enums";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";

const CREATE_ALLOWED_KEYS = new Set<keyof CreateCustomerPaymentMethodInput>([
  "tenantId",
  "customerId",
  "brand",
  "issuingBank",
  "last4",
  "expirationMonth",
  "expirationYear",
  "cardholderName",
  "status",
]);

const UPDATE_ALLOWED_KEYS = new Set<keyof UpdateCustomerPaymentMethodInput>([
  "cardholderName",
  "expirationMonth",
  "expirationYear",
  "status",
]);

export class MockCustomerPaymentMethodRepository
  extends BaseMockRepository
  implements CustomerPaymentMethodRepository
{
  async getByCustomer(tenantId: string, customerId: string) {
    return this.read((db) =>
      db.customerPaymentMethods.filter(
        (item) =>
          item.tenantId === tenantId &&
          item.customerId === customerId &&
          item.status === CustomerPaymentMethodStatus.active,
      ),
    );
  }

  async getById(tenantId: string, customerId: string, id: string) {
    return this.read((db) => this.findOwned(db, tenantId, customerId, id) ?? null);
  }

  async create(input: CreateCustomerPaymentMethodInput) {
    // Allowlist explicita en runtime -- TypeScript no protege contra un
    // caller que bypasea el tipado (devtools, un hook mal escrito, etc.)
    // y agrega cardNumber/fullCardNumber/PAN/CVV/providerPaymentMethodId
    // arbitrario. Cualquier campo fuera de esta lista se rechaza.
    this.assertNoUnexpectedFields(input, CREATE_ALLOWED_KEYS, "CustomerPaymentMethod.create");
    this.assertValidPaymentMethod(input);
    const item = this.store.mutate((db) => {
      this.assertCustomerTenant(input.customerId, input.tenantId, db);
      const status = input.status ?? CustomerPaymentMethodStatus.active;
      const hasExistingActive = db.customerPaymentMethods.some(
        (method) =>
          method.tenantId === input.tenantId &&
          method.customerId === input.customerId &&
          method.status === CustomerPaymentMethodStatus.active,
      );
      // Primer metodo activo del cliente: siempre default, sin importar
      // que pida el caller -- isDefault ni siquiera es parte del input.
      const isDefault = !hasExistingActive && status === CustomerPaymentMethodStatus.active;
      if (isDefault) {
        db.customerPaymentMethods.forEach((method) => {
          if (method.tenantId === input.tenantId && method.customerId === input.customerId) {
            method.isDefault = false;
          }
        });
      }
      const now = this.now();
      const created: CustomerPaymentMethod = {
        id: this.id("customer-payment-method"),
        tenantId: input.tenantId,
        customerId: input.customerId,
        type: PaymentMethod.card,
        // Nunca aceptado desde afuera: el "token" de proveedor lo genera
        // el sistema, igual que lo haria un backend real hablando con el
        // procesador de pagos.
        providerPaymentMethodId: this.id("pm-mock"),
        brand: input.brand,
        issuingBank: input.issuingBank,
        last4: input.last4,
        expirationMonth: input.expirationMonth,
        expirationYear: input.expirationYear,
        cardholderName: input.cardholderName,
        isDefault,
        status,
        createdAt: now,
        updatedAt: now,
      };
      db.customerPaymentMethods.push(created);
      return created;
    });
    this.emit("customer-payment-method.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      action: "created",
    });
    return item;
  }

  async update(
    tenantId: string,
    customerId: string,
    id: string,
    input: UpdateCustomerPaymentMethodInput,
  ) {
    this.assertNoUnexpectedFields(input, UPDATE_ALLOWED_KEYS, "CustomerPaymentMethod.update");
    const item = this.store.mutate((db) => {
      const current = this.findOwned(db, tenantId, customerId, id);
      if (!current) throw this.missing("CustomerPaymentMethod", id);
      const becomingArchived =
        input.status === CustomerPaymentMethodStatus.archived &&
        current.status !== CustomerPaymentMethodStatus.archived;
      const next: CustomerPaymentMethod = {
        ...current,
        cardholderName: "cardholderName" in input ? input.cardholderName : current.cardholderName,
        expirationMonth: input.expirationMonth ?? current.expirationMonth,
        expirationYear: input.expirationYear ?? current.expirationYear,
        status: input.status ?? current.status,
        isDefault: becomingArchived ? false : current.isDefault,
        updatedAt: this.now(),
      };
      this.assertValidPaymentMethod(next);
      const index = db.customerPaymentMethods.findIndex((method) => method.id === id);
      db.customerPaymentMethods[index] = next;

      // Invariante: si el que se esta archivando era el default y quedan
      // otros activos, se promueve uno de forma deterministica dentro de
      // la misma mutacion.
      if (becomingArchived && current.isDefault) {
        this.promoteNextDefault(db, tenantId, customerId, id);
      }
      return next;
    });
    this.emit("customer-payment-method.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      action: "updated",
    });
    return item;
  }

  async remove(tenantId: string, customerId: string, id: string) {
    const removed = this.store.mutate((db) => {
      const existing = this.findOwned(db, tenantId, customerId, id);
      if (!existing) throw this.missing("CustomerPaymentMethod", id);
      db.customerPaymentMethods = db.customerPaymentMethods.filter((method) => method.id !== id);
      if (existing.isDefault) {
        this.promoteNextDefault(db, tenantId, customerId, id);
      }
      return existing;
    });
    this.emit("customer-payment-method.changed", {
      entityId: removed.id,
      tenantId: removed.tenantId,
      action: "deleted",
    });
  }

  async setDefault(tenantId: string, customerId: string, paymentMethodId: string) {
    const item = this.store.mutate((db) => {
      const selected = db.customerPaymentMethods.find(
        (method) =>
          method.id === paymentMethodId &&
          method.tenantId === tenantId &&
          method.customerId === customerId &&
          method.status === CustomerPaymentMethodStatus.active,
      );
      if (!selected) throw this.missing("CustomerPaymentMethod", paymentMethodId);
      db.customerPaymentMethods.forEach((method) => {
        if (method.tenantId === tenantId && method.customerId === customerId) {
          method.isDefault = method.id === paymentMethodId;
          method.updatedAt = this.now();
        }
      });
      return selected;
    });
    this.emit("customer-payment-method.changed", {
      entityId: item.id,
      tenantId: item.tenantId,
      action: "updated",
    });
    return item;
  }

  /**
   * Promueve, de forma deterministica (el mas antiguo por createdAt), un
   * reemplazo de default entre los metodos activos restantes del mismo
   * tenant+cliente. `excludeId` es el metodo que se esta quitando
   * (eliminado o recien archivado) y que ya no debe considerarse.
   */
  private promoteNextDefault(
    db: MockDatabase,
    tenantId: string,
    customerId: string,
    excludeId: string,
  ): void {
    const candidates = db.customerPaymentMethods.filter(
      (method) =>
        method.tenantId === tenantId &&
        method.customerId === customerId &&
        method.status === CustomerPaymentMethodStatus.active &&
        method.id !== excludeId,
    );
    if (candidates.length === 0) return;
    const promoted = [...candidates].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    promoted.isDefault = true;
    promoted.updatedAt = this.now();
  }

  private findOwned(
    db: MockDatabase,
    tenantId: string,
    customerId: string,
    id: string,
  ): CustomerPaymentMethod | undefined {
    return db.customerPaymentMethods.find(
      (method) =>
        method.id === id && method.tenantId === tenantId && method.customerId === customerId,
    );
  }

  private assertNoUnexpectedFields(
    input: Record<string, unknown>,
    allowed: Set<string>,
    context: string,
  ): void {
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) {
        throw new Error(`${context}: campo no permitido "${key}"`);
      }
    }
  }

  private assertValidPaymentMethod(input: {
    brand: string;
    issuingBank: string;
    last4: string;
    expirationMonth: number;
    expirationYear: number;
  }): void {
    // Allowlist de valores reales, no solo "no vacio" -- antes "Marca"
    // aceptaba cualquier texto (ej. "casa"). CARD_BRANDS/GUATEMALA_BANKS
    // son la misma lista que usa el selector del formulario; se revalida
    // aca para que una llamada directa al repositorio no pueda saltarsela.
    if (!CARD_BRANDS.includes(input.brand as (typeof CARD_BRANDS)[number])) {
      throw new Error("CustomerPaymentMethod brand must be one of the supported card brands");
    }
    if (!GUATEMALA_BANKS.includes(input.issuingBank as (typeof GUATEMALA_BANKS)[number])) {
      throw new Error("CustomerPaymentMethod issuingBank must be one of the supported banks");
    }
    // TypeScript no protege esto en runtime: un caller que bypasea el
    // tipado puede enviar "12" (string), NaN, o 1.5. Se valida
    // explicitamente tipo + finitud + entero antes de comparar rangos --
    // un valor no numerico jamas debe llegar a una comparacion "< 1" que
    // silenciosamente evalue false.
    if (typeof input.last4 !== "string" || !/^\d{4}$/.test(input.last4)) {
      throw new Error("CustomerPaymentMethod last4 must contain exactly 4 digits");
    }
    if (
      typeof input.expirationMonth !== "number" ||
      !Number.isFinite(input.expirationMonth) ||
      !Number.isInteger(input.expirationMonth) ||
      input.expirationMonth < 1 ||
      input.expirationMonth > 12
    ) {
      throw new Error("CustomerPaymentMethod expirationMonth must be an integer between 1 and 12");
    }
    if (
      typeof input.expirationYear !== "number" ||
      !Number.isFinite(input.expirationYear) ||
      !Number.isInteger(input.expirationYear)
    ) {
      throw new Error("CustomerPaymentMethod expirationYear must be a valid integer year");
    }
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const isPast =
      input.expirationYear < currentYear ||
      (input.expirationYear === currentYear && input.expirationMonth < currentMonth);
    if (isPast) {
      throw new Error("CustomerPaymentMethod expiration date must be the current month or later");
    }
    // Ninguna red de tarjetas emite una vigencia mayor a este margen --
    // sin este limite, un año como 2240 pasaba por no estar en el pasado.
    if (input.expirationYear > currentYear + MAX_EXPIRATION_YEARS_AHEAD) {
      throw new Error(
        `CustomerPaymentMethod expirationYear must not be more than ${MAX_EXPIRATION_YEARS_AHEAD} years ahead`,
      );
    }
  }

  private assertCustomerTenant(customerId: string, tenantId: string, db: MockDatabase): void {
    const customer = db.customers.find((item) => item.id === customerId);
    if (!customer) throw this.missing("Customer", customerId);
    if (customer.tenantId !== tenantId) {
      throw new Error("CustomerPaymentMethod tenant must match customer tenant");
    }
  }
}
