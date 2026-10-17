import { validateEmployeePassword } from "@/config/auth-policy";
import { BusinessPreset, PlanStatus } from "@/core/enums";
import { BASE_PLAN_ID } from "@/core/subscription/catalog";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  CreatePublicContractInputDto,
  CreatePublicContractResultDto,
} from "@/modules/contracting/application/dto/PublicContractDto";
import { TenantOnboardingService } from "@/modules/administration/application/services/TenantOnboardingService";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 120;
const MAX_EMAIL_LENGTH = 254;
const MAX_SLUG_LENGTH = 80;

export type PublicContractErrorCode =
  | "INCOMPLETE_DATA"
  | "INVALID_EMAIL"
  | "INVALID_PASSWORD"
  | "EMAIL_ALREADY_REGISTERED"
  | "SLUG_COLLISION"
  | "PLAN_UNAVAILABLE"
  | "ONBOARDING_FAILED";

export class PublicContractError extends Error {
  constructor(
    readonly code: PublicContractErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PublicContractError";
  }
}

interface NormalizedPublicContractInput {
  businessName: string;
  tenantSlug: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  businessPreset?: BusinessPreset;
}

/** Convierte el nombre visible a un identificador URL-safe estable, sin aceptar un slug externo. */
export function deriveTenantSlug(businessName: string): string {
  return businessName
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * Boundary público de contratación. Decide toda autoridad comercial en el servidor de
 * aplicación y delega la escritura atómica al onboarding canónico.
 */
export class CreatePublicContractService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(input: CreatePublicContractInputDto): Promise<CreatePublicContractResultDto> {
    const normalized = this.normalizeAndValidate(input);

    const [existingTenant, existingUser, basePlan] = await Promise.all([
      this.repositories.tenants.getBySlug(normalized.tenantSlug),
      this.repositories.users.getByEmail(normalized.adminEmail),
      this.repositories.plans.getById(BASE_PLAN_ID),
    ]);

    if (existingUser) {
      throw new PublicContractError(
        "EMAIL_ALREADY_REGISTERED",
        "Ya existe una cuenta con este correo electrónico.",
      );
    }
    if (existingTenant) {
      throw new PublicContractError(
        "SLUG_COLLISION",
        "Ya existe un negocio con este nombre. Prueba con otro nombre.",
      );
    }
    if (!basePlan || basePlan.status !== PlanStatus.active) {
      throw new PublicContractError(
        "PLAN_UNAVAILABLE",
        "MARJYM Base no está disponible en este momento. Intenta nuevamente más tarde.",
      );
    }

    try {
      const result = await new TenantOnboardingService(this.repositories).execute({
        tenantName: normalized.businessName,
        tenantSlug: normalized.tenantSlug,
        adminName: normalized.adminName,
        adminEmail: normalized.adminEmail,
        adminPasswordMock: normalized.adminPassword,
        planId: basePlan.id,
        businessPreset: normalized.businessPreset,
      });

      return {
        tenantId: result.tenantId,
        tenantSlug: result.tenantSlug,
        planId: result.planId,
      };
    } catch (error) {
      throw this.toPublicError(error);
    }
  }

  private normalizeAndValidate(input: CreatePublicContractInputDto): NormalizedPublicContractInput {
    const businessName = input.businessName?.trim() ?? "";
    const adminName = input.adminName?.trim() ?? "";
    const adminEmail = input.adminEmail?.trim().toLowerCase() ?? "";
    const adminPassword = input.adminPassword ?? "";
    const businessPreset = input.businessPreset;

    if (!businessName || !adminName || !adminEmail || !adminPassword) {
      throw new PublicContractError(
        "INCOMPLETE_DATA",
        "Completa todos los datos del negocio y del administrador.",
      );
    }
    if (businessName.length > MAX_NAME_LENGTH || adminName.length > MAX_NAME_LENGTH) {
      throw new PublicContractError(
        "INCOMPLETE_DATA",
        `Los nombres no pueden superar ${MAX_NAME_LENGTH} caracteres.`,
      );
    }
    if (adminEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(adminEmail)) {
      throw new PublicContractError("INVALID_EMAIL", "Ingresa un correo electrónico válido.");
    }

    const passwordError = validateEmployeePassword(adminPassword, adminEmail);
    if (passwordError) {
      throw new PublicContractError("INVALID_PASSWORD", passwordError);
    }

    const tenantSlug = deriveTenantSlug(businessName);
    if (!tenantSlug) {
      throw new PublicContractError(
        "INCOMPLETE_DATA",
        "El nombre del negocio debe incluir letras o números.",
      );
    }

    return { businessName, tenantSlug, adminName, adminEmail, adminPassword, businessPreset };
  }

  private toPublicError(error: unknown): PublicContractError {
    if (error instanceof PublicContractError) return error;

    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("ya existe una cuenta") || message.includes("correo")) {
      return new PublicContractError(
        "EMAIL_ALREADY_REGISTERED",
        "Ya existe una cuenta con este correo electrónico.",
      );
    }
    if (message.includes("ya existe un negocio") || message.includes("slug")) {
      return new PublicContractError(
        "SLUG_COLLISION",
        "Ya existe un negocio con este nombre. Prueba con otro nombre.",
      );
    }
    if (message.includes("plan")) {
      return new PublicContractError(
        "PLAN_UNAVAILABLE",
        "MARJYM Base no está disponible en este momento. Intenta nuevamente más tarde.",
      );
    }

    return new PublicContractError(
      "ONBOARDING_FAILED",
      "No pudimos crear tu negocio. No se guardaron cambios; intenta nuevamente.",
    );
  }
}
