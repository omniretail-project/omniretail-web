import type { Customer } from "@/core/entities";
import { UserType } from "@/core/enums";
import type { CustomerRepository, UpdateCustomerProfileInput } from "@/core/repositories";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { ApiCurrentSession } from "@/infrastructure/api/apiCurrentSession";
import {
  type ApiCustomerProfile,
  toCustomer,
  withFieldMessage,
} from "@/infrastructure/api/apiCustomerAccountMapper";
import { backendFetch } from "@/infrastructure/api/backendClient";
import type { CurrentSessionClient } from "@/infrastructure/api/CurrentSessionClient";

const BASE_PATH = "/me/profile";
const SCOPE_ERROR = "La cuenta indicada no corresponde a la sesión actual.";

/**
 * El backend resuelve tienda y cliente desde el JWT, asi que un tenantId/customerId distinto al
 * de la sesion nunca puede llegar a el: se rechaza aqui en vez de operar sobre la cuenta propia.
 */
export async function requireCustomerScope(
  currentSession: CurrentSessionClient,
  tenantId: string,
  customerId: string,
): Promise<ApiCurrentSession> {
  const current = await currentSession.get();
  if (
    !current ||
    current.user.type !== UserType.customer ||
    current.user.tenantId !== tenantId ||
    current.user.customerId !== customerId
  ) {
    throw new Error(SCOPE_ERROR);
  }
  return current;
}

/**
 * Autoservicio de "Mi cuenta" en modo api contra `/api/backend/me/profile`. Solo cubre lo que usa
 * el modulo customer para la sesion de cliente; el resto de CustomerRepository sigue en el mock
 * (ver `withApiSession`).
 */
export class ApiCustomerRepository
  implements Pick<CustomerRepository, "getByUserId" | "updateProfileForCustomer">
{
  constructor(
    private readonly currentSession: CurrentSessionClient,
    private readonly eventBus: DataEventBus,
  ) {}

  /** Solo el usuario de la sesion actual tiene perfil accesible; cualquier otro es null. */
  async getByUserId(userId: string): Promise<Customer | null> {
    const current = await this.currentSession.get();
    if (!current || current.user.type !== UserType.customer || current.user.id !== userId) return null;
    return toCustomer(await backendFetch<ApiCustomerProfile>(BASE_PATH));
  }

  async updateProfileForCustomer(
    tenantId: string,
    customerId: string,
    input: UpdateCustomerProfileInput,
  ): Promise<Customer> {
    await requireCustomerScope(this.currentSession, tenantId, customerId);
    let updated: Customer;
    try {
      updated = toCustomer(
        await backendFetch<ApiCustomerProfile>(BASE_PATH, {
          method: "PUT",
          body: { name: input.name, phone: input.phone },
        }),
      );
    } catch (error) {
      throw withFieldMessage(error);
    }
    // El backend tambien actualiza el User: /auth/me (encabezado de la cuenta) debe releerse.
    this.currentSession.invalidate();
    this.eventBus.emit("customer.changed", { entityId: updated.id, tenantId, action: "updated" });
    this.eventBus.emit("user.changed", { entityId: updated.userId, tenantId, action: "updated" });
    return updated;
  }
}
