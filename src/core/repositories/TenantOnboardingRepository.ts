import type {
  AuthAccount,
  Branch,
  BusinessCapabilitiesConfig,
  EcommerceConfig,
  Role,
  Tenant,
  TenantSubscription,
  User,
} from "@/core/entities";
import type { BusinessPreset } from "@/core/enums";
import type { CurrencyCode } from "@/core/types/common.types";

/**
 * Paquete YA DECIDIDO por `TenantOnboardingService` (política/validación en Application) --
 * ningún campo aquí viene directo del caller HTTP/UI sin pasar antes por esa validación. En
 * particular `adminPermissions` es el catálogo canónico completo (`permissionsConfig.map(p =>
 * p.key)`), nunca una lista arbitraria enviada por el cliente.
 */
export interface TenantOnboardingInput {
  tenantName: string;
  tenantSlug: string;
  defaultCurrency: CurrencyCode;
  timezone: string;
  adminName: string;
  adminEmail: string;
  adminPasswordMock: string;
  planId: string;
  businessPreset?: BusinessPreset;
  adminPermissions: string[];
}

export interface TenantOnboardingResult {
  tenant: Tenant;
  branch: Branch;
  role: Role;
  user: User;
  authAccount: AuthAccount;
  businessCapabilities: BusinessCapabilitiesConfig;
  ecommerceConfig: EcommerceConfig;
  subscription: TenantSubscription;
}

/**
 * Boundary infraestructural mínimo para poder ejecutar el alta de un nuevo Tenant como una
 * unidad atómica REAL (feature/tenant-onboarding, auditoría §15/§26).
 *
 * Por qué existe un contrato nuevo en vez de reutilizar `TenantRepository.create` +
 * `BranchRepository.create` + `RoleRepository.create` + `UserRepository.create` +
 * `AuthRepository.bootstrapEmployeeAccount` + `BusinessConfigRepository.createCapabilities` +
 * `BusinessConfigRepository.createEcommerceConfig` + `TenantSubscriptionRepository.create` uno
 * detrás de otro desde `TenantOnboardingService`: `RepositoryRegistry` NUNCA expone
 * `MockDatabaseStore` a las capas superiores, y cada `Mock*Repository.create()` abre y confirma
 * su propio `store.mutate()`/`store.transact()` de forma independiente (uno por llamada, no uno
 * compartido). Encadenar esas siete llamadas desde el Application Service NO sería atómico: si
 * la sexta falla, las primeras cinco ya habrían sido persistidas. `onboard()` es el ÚNICO método
 * de este contrato precisamente para que exista un solo punto de entrada infraestructural capaz
 * de envolver TODAS las tablas involucradas en un único `store.transact()` real (ver
 * `MockTenantOnboardingRepository` para la implementación).
 */
export interface TenantOnboardingRepository {
  onboard(input: TenantOnboardingInput): Promise<TenantOnboardingResult>;
}
