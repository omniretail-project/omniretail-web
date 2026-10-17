import type { CustomerPaymentMethod } from "@/core/entities";
import { CustomerPaymentMethodStatus } from "@/core/enums";
import type {
  CreateCustomerPaymentMethodInput,
  CustomerPaymentMethodRepository,
  UpdateCustomerPaymentMethodInput,
} from "@/core/repositories";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { withFieldMessage } from "@/infrastructure/api/apiCustomerAccountMapper";
import {
  type ApiCustomerPaymentMethod,
  toCreatePaymentMethodRequest,
  toCustomerPaymentMethod,
  toUpdatePaymentMethodRequest,
} from "@/infrastructure/api/apiCustomerPaymentMethodMapper";
import { requireCustomerScope } from "@/infrastructure/api/ApiCustomerRepository";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import type { CurrentSessionClient } from "@/infrastructure/api/CurrentSessionClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const BASE_PATH = "/me/payment-methods";
const NOT_FOUND_ERROR = "El método de pago no existe.";
const ARCHIVE_NOT_AVAILABLE = "Archivar no está disponible; elimina la tarjeta.";

/** 404 PAYMENT_METHOD_NOT_FOUND (inexistente o de otro cliente) se reporta con un mensaje fijo. */
function toPaymentMethodError(error: unknown): unknown {
  if (error instanceof BackendRequestError && error.status === 404) return new Error(NOT_FOUND_ERROR);
  return withFieldMessage(error);
}

/**
 * CustomerPaymentMethodRepository de modo api contra `/api/backend/me/payment-methods`, solo para la
 * sesion de cliente (ver `withApiSession`). El backend toma tienda y cliente del JWT: los
 * tenantId/customerId del contrato solo se comprueban contra la sesion y nunca se envian.
 *
 * El backend decide cual es la principal y el orden (la principal primero): aqui no se reordena ni
 * se calcula nada. Cada cambio emite `customer-payment-method.changed`, asi la pantalla vuelve a
 * pedir la lista.
 */
export class ApiCustomerPaymentMethodRepository implements CustomerPaymentMethodRepository {
  constructor(
    private readonly currentSession: CurrentSessionClient,
    private readonly eventBus: DataEventBus,
  ) {}

  async getByCustomer(tenantId: string, customerId: string): Promise<CustomerPaymentMethod[]> {
    await requireCustomerScope(this.currentSession, tenantId, customerId);
    const methods = await backendFetch<ApiCustomerPaymentMethod[]>(BASE_PATH);
    return methods.map(toCustomerPaymentMethod);
  }

  /** El backend no expone GET por id: se busca en el listado del propio cliente. */
  async getById(
    tenantId: string,
    customerId: string,
    id: string,
  ): Promise<CustomerPaymentMethod | null> {
    if (!isApiUuid(id)) return null;
    return (await this.getByCustomer(tenantId, customerId)).find((method) => method.id === id) ?? null;
  }

  async create(input: CreateCustomerPaymentMethodInput): Promise<CustomerPaymentMethod> {
    await requireCustomerScope(this.currentSession, input.tenantId, input.customerId);
    const created = await this.send(BASE_PATH, "POST", toCreatePaymentMethodRequest(input));
    this.emitChanged(created.id, input.tenantId, "created");
    return created;
  }

  /**
   * El PUT del backend exige titular y vencimiento completos; el contrato admite un cambio
   * parcial, asi que se combina con la tarjeta actual (una clave presente con `undefined` la
   * borra, igual que el mock). Archivar no existe en el backend: se rechaza en vez de simularlo.
   */
  async update(
    tenantId: string,
    customerId: string,
    id: string,
    input: UpdateCustomerPaymentMethodInput,
  ): Promise<CustomerPaymentMethod> {
    if (input.status === CustomerPaymentMethodStatus.archived) throw new Error(ARCHIVE_NOT_AVAILABLE);
    const current = await this.getById(tenantId, customerId, id);
    if (!current) throw new Error(NOT_FOUND_ERROR);
    const updated = await this.send(
      `${BASE_PATH}/${id}`,
      "PUT",
      toUpdatePaymentMethodRequest({ ...current, ...input }),
    );
    this.emitChanged(updated.id, tenantId, "updated");
    return updated;
  }

  /** Si era la principal, el backend promueve otra. */
  async remove(tenantId: string, customerId: string, id: string): Promise<void> {
    await requireCustomerScope(this.currentSession, tenantId, customerId);
    if (!isApiUuid(id)) throw new Error(NOT_FOUND_ERROR);
    try {
      await backendFetch<void>(`${BASE_PATH}/${id}`, { method: "DELETE" });
    } catch (error) {
      throw toPaymentMethodError(error);
    }
    this.emitChanged(id, tenantId, "deleted");
  }

  async setDefault(
    tenantId: string,
    customerId: string,
    paymentMethodId: string,
  ): Promise<CustomerPaymentMethod> {
    await requireCustomerScope(this.currentSession, tenantId, customerId);
    if (!isApiUuid(paymentMethodId)) throw new Error(NOT_FOUND_ERROR);
    const updated = await this.send(`${BASE_PATH}/${paymentMethodId}/default`, "PUT");
    this.emitChanged(updated.id, tenantId, "updated");
    return updated;
  }

  private async send(
    path: string,
    method: "POST" | "PUT",
    body?: unknown,
  ): Promise<CustomerPaymentMethod> {
    try {
      return toCustomerPaymentMethod(await backendFetch<ApiCustomerPaymentMethod>(path, { method, body }));
    } catch (error) {
      throw toPaymentMethodError(error);
    }
  }

  private emitChanged(entityId: string, tenantId: string, action: "created" | "updated" | "deleted") {
    this.eventBus.emit("customer-payment-method.changed", { entityId, tenantId, action });
  }
}
