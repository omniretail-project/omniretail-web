import type { SubscriptionInvoice, TenantSubscription } from "@/core/entities";
import type { TenantSubscriptionStatus } from "@/core/enums";
import type { TenantSubscriptionRepository } from "@/core/repositories";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";

const BASE_PATH = "/admin/subscriptions";

/** TenantSubscriptionDetailsResponse del backend (solo los campos que consume el frontend). */
interface ApiTenantSubscriptionDetails {
  tenantId: string;
  addonCodes: string[];
  subscription: { status: string; startedAt: string };
  plan: { id: string; code: string; name: string; description: string | null };
  capabilities: { key: string; included: boolean; operationalStatus?: string }[];
  usage: { key: string; current: number; limit: number | null }[];
  invoices: {
    id: string;
    tenantId: string;
    cycleStart: string;
    cycleEnd: string;
    createdAt: string;
    addonCodes: string[];
    baseQuetzales: number;
    addonLines: { code: string; name: string; amountQuetzales: number }[];
    totalQuetzales: number;
    status: string;
  }[];
}

/**
 * La respuesta no expone el id de la suscripcion; como el backend resuelve UNA suscripcion vigente
 * por tienda, se usa un id estable derivado de la tienda (solo se usa en auditoria local).
 */
function subscriptionIdFor(tenantId: string): string {
  return `subscription:${tenantId}`;
}

function toTenantSubscription(details: ApiTenantSubscriptionDetails): TenantSubscription {
  return {
    id: subscriptionIdFor(details.tenantId),
    tenantId: details.tenantId,
    planId: details.plan.id,
    status: details.subscription.status as TenantSubscriptionStatus,
    startedAt: details.subscription.startedAt,
    addonCodes: [...details.addonCodes],
    createdAt: details.subscription.startedAt,
    updatedAt: details.subscription.startedAt,
  };
}

function toInvoice(invoice: ApiTenantSubscriptionDetails["invoices"][number]): SubscriptionInvoice {
  return { ...invoice, addonCodes: [...invoice.addonCodes], status: "simulated" };
}

/**
 * TenantSubscriptionRepository de modo api contra `/api/backend/admin/subscriptions` (exige
 * `admin.plans.read`). El backend resuelve la suscripcion de la tienda del JWT.
 *
 * Fail-closed: un 403/404 o una respuesta de otra tienda devuelven `null`, y
 * `ResolveTenantEntitlementsService` lanza SUBSCRIPTION_MISSING; nunca se asume un plan.
 *
 * Mutaciones: el backend solo expone `PUT /admin/subscriptions/addons`, y genera el snapshot de
 * factura del ciclo el mismo (por eso `ensureInvoice` no envia nada). Cambiar de plan o crear una
 * suscripcion no tiene endpoint y se rechaza con un mensaje claro.
 */
export class ApiTenantSubscriptionRepository implements TenantSubscriptionRepository {
  constructor(private readonly eventBus: DataEventBus) {}

  async getByTenantId(tenantId: string): Promise<TenantSubscription | null> {
    const details = await this.fetchDetails(tenantId);
    return details ? toTenantSubscription(details) : null;
  }

  async listInvoices(tenantId: string): Promise<SubscriptionInvoice[]> {
    const details = await this.fetchDetails(tenantId);
    return details ? details.invoices.map(toInvoice) : [];
  }

  async ensureInvoice(input: SubscriptionInvoice): Promise<SubscriptionInvoice> {
    return input;
  }

  async create(): Promise<TenantSubscription> {
    throw unsupported("La suscripción se crea en el alta del negocio, no desde administración.");
  }

  async update(
    tenantId: string,
    input: Partial<Omit<TenantSubscription, "id" | "tenantId" | "createdAt" | "updatedAt">>,
  ): Promise<TenantSubscription> {
    const { addonCodes, ...rest } = input;
    if (addonCodes === undefined || Object.values(rest).some((value) => value !== undefined)) {
      throw unsupported("El cambio de plan todavía no está disponible. Solo se pueden modificar los complementos.");
    }
    const details = await backendFetch<ApiTenantSubscriptionDetails>(`${BASE_PATH}/addons`, {
      method: "PUT",
      body: { addonCodes },
    });
    if (details.tenantId !== tenantId) {
      throw new BackendRequestError("La suscripción no corresponde al negocio activo.", 403);
    }
    const updated = toTenantSubscription(details);
    this.eventBus.emit("tenant-subscription.changed", {
      entityId: updated.id,
      tenantId: updated.tenantId,
      action: "updated",
    });
    return updated;
  }

  private async fetchDetails(tenantId: string): Promise<ApiTenantSubscriptionDetails | null> {
    try {
      const details = await backendFetch<ApiTenantSubscriptionDetails>(BASE_PATH);
      return details.tenantId === tenantId ? details : null;
    } catch (error) {
      if (error instanceof BackendRequestError && (error.status === 403 || error.status === 404)) {
        return null;
      }
      throw error;
    }
  }
}

function unsupported(message: string): BackendRequestError {
  return new BackendRequestError(message, 501, "NOT_SUPPORTED");
}
