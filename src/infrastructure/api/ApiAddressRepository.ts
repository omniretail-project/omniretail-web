import type { Address } from "@/core/entities";
import type {
  AddressRepository,
  CreateAddressInput,
  UpdateAddressInput,
} from "@/core/repositories/AddressRepository";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import {
  type ApiAddress,
  toAddress,
  toAddressRequest,
  withFieldMessage,
} from "@/infrastructure/api/apiCustomerAccountMapper";
import { requireCustomerScope } from "@/infrastructure/api/ApiCustomerRepository";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import type { CurrentSessionClient } from "@/infrastructure/api/CurrentSessionClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const BASE_PATH = "/me/addresses";
const NOT_FOUND_ERROR = "La dirección no existe.";

/** 404 ADDRESS_NOT_FOUND (inexistente o de otro cliente) se reporta igual que en el mock. */
function toAddressError(error: unknown): unknown {
  if (error instanceof BackendRequestError && error.status === 404) return new Error(NOT_FOUND_ERROR);
  return withFieldMessage(error);
}

/**
 * AddressRepository de modo api contra `/api/backend/me/addresses`, solo para la sesion de cliente
 * (ver `withApiSession`). El backend toma tienda y cliente del JWT: los tenantId/customerId del
 * contrato solo se comprueban contra la sesion y nunca se envian.
 */
export class ApiAddressRepository implements AddressRepository {
  constructor(
    private readonly currentSession: CurrentSessionClient,
    private readonly eventBus: DataEventBus,
  ) {}

  async getByCustomer(tenantId: string, customerId: string): Promise<Address[]> {
    await requireCustomerScope(this.currentSession, tenantId, customerId);
    const addresses = await backendFetch<ApiAddress[]>(BASE_PATH);
    return addresses.map(toAddress);
  }

  /** El backend no expone GET por id: se busca en el listado del propio cliente. */
  async getById(tenantId: string, customerId: string, id: string): Promise<Address | null> {
    if (!isApiUuid(id)) return null;
    return (await this.getByCustomer(tenantId, customerId)).find((address) => address.id === id) ?? null;
  }

  async create(input: CreateAddressInput): Promise<Address> {
    await requireCustomerScope(this.currentSession, input.tenantId, input.customerId);
    const created = await this.send(BASE_PATH, "POST", toAddressRequest(input));
    this.eventBus.emit("address.changed", { entityId: created.id, action: "created" });
    return created;
  }

  /**
   * El PUT del backend reemplaza la direccion completa; el contrato admite un cambio parcial, asi
   * que se combina con la actual (una clave presente con `undefined` la borra, igual que el mock).
   */
  async update(
    tenantId: string,
    customerId: string,
    id: string,
    input: UpdateAddressInput,
  ): Promise<Address> {
    const current = await this.getById(tenantId, customerId, id);
    if (!current) throw new Error(NOT_FOUND_ERROR);
    const updated = await this.send(`${BASE_PATH}/${id}`, "PUT", toAddressRequest({ ...current, ...input }));
    this.eventBus.emit("address.changed", { entityId: updated.id, action: "updated" });
    return updated;
  }

  async remove(tenantId: string, customerId: string, id: string): Promise<void> {
    await requireCustomerScope(this.currentSession, tenantId, customerId);
    if (!isApiUuid(id)) throw new Error(NOT_FOUND_ERROR);
    try {
      await backendFetch<void>(`${BASE_PATH}/${id}`, { method: "DELETE" });
    } catch (error) {
      throw toAddressError(error);
    }
    this.eventBus.emit("address.changed", { entityId: id, action: "deleted" });
  }

  async setDefault(tenantId: string, customerId: string, addressId: string): Promise<Address> {
    await requireCustomerScope(this.currentSession, tenantId, customerId);
    if (!isApiUuid(addressId)) throw new Error(NOT_FOUND_ERROR);
    const updated = await this.send(`${BASE_PATH}/${addressId}/default`, "PUT");
    this.eventBus.emit("address.changed", { entityId: updated.id, action: "updated" });
    return updated;
  }

  private async send(path: string, method: "POST" | "PUT", body?: unknown): Promise<Address> {
    try {
      return toAddress(await backendFetch<ApiAddress>(path, { method, body }));
    } catch (error) {
      throw toAddressError(error);
    }
  }
}
