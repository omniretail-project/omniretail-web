import type { Address } from "@/core/entities";
import type {
  AddressRepository,
  CreateAddressInput,
  UpdateAddressInput,
} from "@/core/repositories";
import {
  GUATEMALA_DEPARTMENTS,
  GUATEMALA_MUNICIPALITIES,
  POSTAL_CODE_PATTERN,
} from "@/config/guatemala-locations";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";
import {
  DELIVERY_ADDRESS_LIMITS,
  isValidDeliveryAddress,
  isValidRecipientName,
} from "@/config/delivery-address-policy";

const UPDATE_ALLOWED_KEYS = new Set<keyof UpdateAddressInput>([
  "label",
  "recipientName",
  "line1",
  "line2",
  "city",
  "stateOrDepartment",
  "postalCode",
  "country",
  "references",
]);

export class MockAddressRepository extends BaseMockRepository implements AddressRepository {
  async getByCustomer(tenantId: string, customerId: string) {
    return this.read((db) =>
      db.addresses.filter((item) => item.tenantId === tenantId && item.customerId === customerId),
    );
  }

  async getById(tenantId: string, customerId: string, id: string) {
    return this.read((db) => this.findOwned(db, tenantId, customerId, id) ?? null);
  }

  async create(input: CreateAddressInput) {
    this.assertValidAddress(input);
    const item = this.store.mutate((db) => {
      this.assertCustomerTenant(input.customerId, input.tenantId, db);
      // Primera direccion del cliente: siempre queda predeterminada, sin
      // importar lo que pida el caller -- isDefault ni siquiera es parte
      // de CreateAddressInput, se calcula 100% server-side. Nunca puede
      // haber cero direcciones predeterminadas si al menos una existe.
      const isFirstForCustomer = !db.addresses.some(
        (address) => address.tenantId === input.tenantId && address.customerId === input.customerId,
      );
      if (isFirstForCustomer) {
        db.addresses.forEach((address) => {
          if (address.tenantId === input.tenantId && address.customerId === input.customerId) {
            address.isDefault = false;
          }
        });
      }
      const now = this.now();
      const created: Address = {
        id: this.id("address"),
        tenantId: input.tenantId,
        customerId: input.customerId,
        label: input.label,
        recipientName: input.recipientName,
        line1: input.line1,
        line2: input.line2,
        city: input.city,
        stateOrDepartment: input.stateOrDepartment,
        postalCode: input.postalCode,
        country: input.country,
        references: input.references,
        isDefault: isFirstForCustomer,
        createdAt: now,
        updatedAt: now,
      };
      db.addresses.push(created);
      return created;
    });
    this.emit("address.changed", { entityId: item.id, action: "created" });
    return item;
  }

  async update(tenantId: string, customerId: string, id: string, input: UpdateAddressInput) {
    this.assertNoUnexpectedFields(input, UPDATE_ALLOWED_KEYS, "Address.update");
    const item = this.store.mutate((db) => {
      const current = this.findOwned(db, tenantId, customerId, id);
      if (!current) throw this.missing("Address", id);
      const next: Address = {
        ...current,
        label: input.label ?? current.label,
        recipientName: input.recipientName ?? current.recipientName,
        line1: input.line1 ?? current.line1,
        line2: "line2" in input ? input.line2 : current.line2,
        city: input.city ?? current.city,
        stateOrDepartment:
          "stateOrDepartment" in input ? input.stateOrDepartment : current.stateOrDepartment,
        postalCode: "postalCode" in input ? input.postalCode : current.postalCode,
        country: input.country ?? current.country,
        references: "references" in input ? input.references : current.references,
        updatedAt: this.now(),
      };
      this.assertValidAddress(next);
      const index = db.addresses.findIndex((address) => address.id === id);
      db.addresses[index] = next;
      return next;
    });
    this.emit("address.changed", { entityId: item.id, action: "updated" });
    return item;
  }

  async remove(tenantId: string, customerId: string, id: string) {
    const removed = this.store.mutate((db) => {
      const existing = this.findOwned(db, tenantId, customerId, id);
      if (!existing) throw this.missing("Address", id);
      db.addresses = db.addresses.filter((address) => address.id !== id);
      // Invariante: si la eliminada era default y quedan otras del mismo
      // cliente, se promueve una de forma deterministica (la mas antigua
      // por createdAt) dentro de la MISMA mutacion -- nunca queda una
      // ventana con cero defaults teniendo direcciones disponibles.
      if (existing.isDefault) {
        const remaining = db.addresses.filter(
          (address) => address.tenantId === tenantId && address.customerId === customerId,
        );
        if (remaining.length > 0) {
          const promoted = [...remaining].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
          promoted.isDefault = true;
          promoted.updatedAt = this.now();
        }
      }
      return existing;
    });
    this.emit("address.changed", { entityId: removed.id, action: "deleted" });
  }

  async setDefault(tenantId: string, customerId: string, addressId: string) {
    const item = this.store.mutate((db) => {
      const selected = this.findOwned(db, tenantId, customerId, addressId);
      if (!selected) throw this.missing("Address", addressId);
      db.addresses.forEach((address) => {
        if (address.tenantId === tenantId && address.customerId === customerId) {
          address.isDefault = address.id === addressId;
          address.updatedAt = this.now();
        }
      });
      return selected;
    });
    this.emit("address.changed", { entityId: item.id, action: "updated" });
    return item;
  }

  private findOwned(
    db: MockDatabase,
    tenantId: string,
    customerId: string,
    id: string,
  ): Address | undefined {
    return db.addresses.find(
      (address) =>
        address.id === id && address.tenantId === tenantId && address.customerId === customerId,
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

  private assertValidAddress(input: {
    label: string;
    recipientName: string;
    line1: string;
    city: string;
    stateOrDepartment?: string;
    postalCode?: string;
    country: string;
    line2?: string;
    references?: string;
  }): void {
    const required: Array<[string, string | undefined]> = [
      ["label", input.label],
      ["recipientName", input.recipientName],
      ["line1", input.line1],
      ["city", input.city],
      ["stateOrDepartment", input.stateOrDepartment],
      ["country", input.country],
    ];
    for (const [field, value] of required) {
      if (!value || !value.trim()) {
        throw new Error(`Address ${field} is required`);
      }
    }
    if (input.label.length > DELIVERY_ADDRESS_LIMITS.label) {
      throw new Error(`Address label cannot exceed ${DELIVERY_ADDRESS_LIMITS.label} characters`);
    }
    if (!isValidRecipientName(input.recipientName)) {
      throw new Error("Address recipientName contains invalid characters or exceeds its limit");
    }
    if (!isValidDeliveryAddress(input.line1, "line1")) {
      throw new Error("Address line1 contains invalid characters or exceeds its limit");
    }
    if (input.line2 && !isValidDeliveryAddress(input.line2, "line2")) {
      throw new Error("Address line2 contains invalid characters or exceeds its limit");
    }
    if (input.references && !isValidDeliveryAddress(input.references, "references")) {
      throw new Error("Address references contains invalid characters or exceeds its limit");
    }
    // Departamento dejo de ser opcional: Municipio (el campo `city`)
    // depende de el para saber que opciones son validas -- un municipio
    // sin departamento no tiene forma de verificarse.
    const stateOrDepartment = input.stateOrDepartment as (typeof GUATEMALA_DEPARTMENTS)[number];
    if (!GUATEMALA_DEPARTMENTS.includes(stateOrDepartment)) {
      throw new Error("Address stateOrDepartment must be a valid Guatemala department");
    }
    // "city" (Municipio) ya no es texto libre -- antes aceptaba cualquier
    // basura ("sadasf"). Debe pertenecer al departamento seleccionado.
    if (!GUATEMALA_MUNICIPALITIES[stateOrDepartment].includes(input.city.trim())) {
      throw new Error("Address city must be a municipality that belongs to the selected department");
    }
    // postalCode sigue siendo opcional, pero si SE completa ya no acepta
    // cualquier texto -- antes "asd" se guardaba sin problema.
    if (input.postalCode && !POSTAL_CODE_PATTERN.test(input.postalCode)) {
      throw new Error("Address postalCode must be 5 digits");
    }
  }

  private assertCustomerTenant(customerId: string, tenantId: string, db: MockDatabase): void {
    const customer = db.customers.find((item) => item.id === customerId);
    if (!customer) throw this.missing("Customer", customerId);
    if (customer.tenantId !== tenantId) {
      throw new Error("Address tenant must match customer tenant");
    }
  }
}
