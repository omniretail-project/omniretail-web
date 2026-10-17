import type { PlanDefinition } from "@/core/entities";
import type { PlanCode, PlanStatus, SaasCapabilityKey, SaasLimitKey } from "@/core/enums";
import type { PlanRepository } from "@/core/repositories";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";

const BASE_PATH = "/admin/plans";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SaasPlanResponse del backend (`/admin/plans`). */
interface ApiPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  monthlyQuetzales: number | null;
  status: string;
  capabilities: string[];
  /** Solo trae las claves con limite definido (ausente = sin limite). */
  limits: Record<string, number>;
  createdAt: string;
  updatedAt: string;
}

function toPlan(plan: ApiPlan): PlanDefinition {
  return {
    id: plan.id,
    code: plan.code as PlanCode,
    name: plan.name,
    description: plan.description ?? undefined,
    monthlyQuetzales: plan.monthlyQuetzales ?? undefined,
    status: plan.status as PlanStatus,
    capabilities: plan.capabilities as SaasCapabilityKey[],
    limits: { ...plan.limits } as Partial<Record<SaasLimitKey, number>>,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

/**
 * PlanRepository de modo api contra `/api/backend/admin/plans` (exige `admin.plans.read`). Se usa
 * el catalogo del backend y no el plan resumido de `/admin/subscriptions`, porque solo este trae
 * `capabilities` y `limits` completos, que son la fuente de verdad de los entitlements.
 *
 * El catalogo es global y casi estatico, y `ResolveTenantEntitlementsService` lo consulta en cada
 * alta y en cada recarga del EntitlementProvider: se cachea por id durante la vida del registro.
 * Un 403/404 no se cachea y devuelve `null` (fail-closed: el resolver lanza PLAN_MISSING).
 */
export class ApiPlanRepository implements PlanRepository {
  private readonly byId = new Map<string, PlanDefinition>();

  async listActive(): Promise<PlanDefinition[]> {
    const plans = (await backendFetch<ApiPlan[]>(BASE_PATH, { query: { activeOnly: true } })).map(toPlan);
    for (const plan of plans) this.byId.set(plan.id, plan);
    return plans;
  }

  async getById(id: string): Promise<PlanDefinition | null> {
    const cached = this.byId.get(id);
    if (cached) return cached;
    if (!UUID_PATTERN.test(id)) return null;
    try {
      const plan = toPlan(await backendFetch<ApiPlan>(`${BASE_PATH}/${id}`));
      this.byId.set(plan.id, plan);
      return plan;
    } catch (error) {
      if (error instanceof BackendRequestError && (error.status === 403 || error.status === 404)) {
        return null;
      }
      throw error;
    }
  }

  async getByCode(code: PlanCode): Promise<PlanDefinition | null> {
    return (await this.listActive()).find((plan) => plan.code === code) ?? null;
  }
}
