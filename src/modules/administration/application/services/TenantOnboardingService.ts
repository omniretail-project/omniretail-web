import { validateEmployeePassword } from "@/config/auth-policy";
import { permissionsConfig } from "@/config/permissions";
import { BusinessPreset, PlanStatus } from "@/core/enums";
import type { CurrencyCode } from "@/core/types/common.types";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  TenantOnboardingInputDto,
  TenantOnboardingResultDto,
} from "@/modules/administration/application/dto/TenantOnboardingDto";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";

const DEFAULT_CURRENCY: CurrencyCode = "GTQ";
const DEFAULT_TIMEZONE = "America/Guatemala";
const VALID_CURRENCIES: readonly CurrencyCode[] = ["GTQ", "USD"];
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface NormalizedTenantOnboardingInput {
  tenantName: string;
  tenantSlug: string;
  adminName: string;
  adminEmail: string;
  adminPasswordMock: string;
  planId: string;
  businessPreset?: BusinessPreset;
  defaultCurrency: CurrencyCode;
  timezone: string;
}

/**
 * Onboarding técnico de un nuevo cliente SaaS (feature/tenant-onboarding). Único punto de
 * entrada para dar de alta Tenant + Branch inicial + Role admin + User admin + AuthAccount +
 * TenantSubscription + config mínima como una unidad atómica -- NO implementa entitlement
 * enforcement, `/contratar`, pagos SaaS ni copia datos de tenant-demo (auditoría §2).
 *
 * Responsabilidad de ESTE service (Application, política/orquestación): validar el input,
 * comprobar disponibilidad de slug/email, resolver el Plan, calcular el catálogo canónico de
 * permisos del rol admin (`permissionsConfig.map(p => p.key)`, MISMA fuente que
 * `DEMO_ADMIN_ROLE_PERMISSIONS` en el seed -- nunca un catálogo duplicado a mano) y los defaults
 * de negocio (moneda/zona horaria). La persistencia atómica real vive en
 * `repositories.tenantOnboarding.onboard(...)` (Infrastructure) -- ver su docstring para por qué
 * no puede hacerse encadenando `tenants.create()` + `branches.create()` + ... desde aquí.
 *
 * Nada de lo que este service acepta como INPUT es de autoridad (auditoría §6): `tenantId`,
 * `roleId`, la lista de permisos, `allowedBranchIds`, el status de Subscription/AuthAccount,
 * `isSystem` y cualquier branch id preexistente se derivan siempre server-side, nunca del DTO.
 */
export class TenantOnboardingService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(input: TenantOnboardingInputDto): Promise<TenantOnboardingResultDto> {
    const normalized = this.normalizeAndValidate(input);

    const existingTenant = await this.repositories.tenants.getBySlug(normalized.tenantSlug);
    if (existingTenant) {
      throw new AdministrationServiceError(
        `Ya existe un negocio con el identificador "${normalized.tenantSlug}".`,
      );
    }

    // Misma fuente de verdad que login()/CreateEmployeeService: email único a nivel global.
    const existingUser = await this.repositories.users.getByEmail(normalized.adminEmail);
    if (existingUser) {
      throw new AdministrationServiceError(
        `Ya existe una cuenta con el correo "${normalized.adminEmail}".`,
      );
    }

    const plan = await this.repositories.plans.getById(normalized.planId);
    if (!plan) {
      throw new AdministrationServiceError("El plan seleccionado no existe.");
    }
    if (plan.status !== PlanStatus.active) {
      throw new AdministrationServiceError("El plan seleccionado no está activo.");
    }

    // El rol Administrador es una identidad de negocio/empleado: conserva los permisos
    // operativos del catálogo, pero no los de la identidad Customer ni su autoservicio Storefront.
    // Las categorías vienen del catálogo canónico; no se mantienen listas locales de keys.
    const adminPermissions = permissionsConfig
      .filter(
        (permission) => permission.module !== "customer" && permission.module !== "storefront",
      )
      .map((permission) => permission.key);

    const result = await this.repositories.tenantOnboarding.onboard({
      tenantName: normalized.tenantName,
      tenantSlug: normalized.tenantSlug,
      defaultCurrency: normalized.defaultCurrency,
      timezone: normalized.timezone,
      adminName: normalized.adminName,
      adminEmail: normalized.adminEmail,
      adminPasswordMock: normalized.adminPasswordMock,
      planId: plan.id,
      businessPreset: normalized.businessPreset,
      adminPermissions,
    });

    return {
      tenantId: result.tenant.id,
      tenantSlug: result.tenant.slug,
      branchId: result.branch.id,
      roleId: result.role.id,
      userId: result.user.id,
      authAccountId: result.authAccount.id,
      subscriptionId: result.subscription.id,
      planId: result.subscription.planId,
    };
  }

  private normalizeAndValidate(input: TenantOnboardingInputDto): NormalizedTenantOnboardingInput {
    const tenantName = input.tenantName?.trim() ?? "";
    if (!tenantName) {
      throw new AdministrationServiceError("El nombre del negocio es obligatorio.");
    }

    const tenantSlug = input.tenantSlug?.trim().toLowerCase() ?? "";
    if (!tenantSlug || !SLUG_PATTERN.test(tenantSlug)) {
      throw new AdministrationServiceError(
        "El identificador (slug) debe usar solo minúsculas, números y guiones, sin espacios.",
      );
    }

    const adminName = input.adminName?.trim() ?? "";
    if (!adminName) {
      throw new AdministrationServiceError("El nombre del administrador es obligatorio.");
    }

    const adminEmail = input.adminEmail?.trim() ?? "";
    if (!adminEmail || !EMAIL_PATTERN.test(adminEmail)) {
      throw new AdministrationServiceError("El correo del administrador no es válido.");
    }

    const passwordError = validateEmployeePassword(input.adminPasswordMock, adminEmail);
    if (passwordError) {
      throw new AdministrationServiceError(passwordError);
    }

    const planId = input.planId?.trim() ?? "";
    if (!planId) {
      throw new AdministrationServiceError("Debe seleccionarse un plan.");
    }

    const defaultCurrency = input.defaultCurrency ?? DEFAULT_CURRENCY;
    if (!VALID_CURRENCIES.includes(defaultCurrency)) {
      throw new AdministrationServiceError("La moneda indicada no es válida.");
    }

    const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;
    const businessPreset = input.businessPreset;

    return {
      tenantName,
      tenantSlug,
      adminName,
      adminEmail,
      adminPasswordMock: input.adminPasswordMock,
      planId,
      defaultCurrency,
      timezone,
      businessPreset,
    };
  }
}
