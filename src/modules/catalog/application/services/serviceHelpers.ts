import { CategoryStatus, ProductType, SaasCapabilityKey, UnitStatus } from "@/core/enums";
import type { BusinessCapabilitiesConfig, Category, Product, Unit } from "@/core/entities";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { resolveCurrentSessionSnapshot } from "@/modules/auth/application/services/resolveCurrentSessionSnapshot";
import {
  getDisabledProductTypeMessage,
  isProductTypeAllowed,
} from "@/modules/catalog/validation/product.validation";
import { ensureTenantCapability } from "@/shared/application/services/entitlementGuards";
import { ResolveTenantEntitlementsService } from "@/shared/application/services/ResolveTenantEntitlementsService";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { ProductEditorPartialSaveError } from "@/modules/catalog/application/services/ProductEditorPartialSaveError";

export class CatalogServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogServiceError";
  }
}

export async function resolveTenantId(repositories: RepositoryRegistry) {
  const snapshot = await resolveCurrentSessionSnapshot(repositories);
  if (!snapshot.user || !snapshot.role) {
    throw new CatalogServiceError("No se pudo resolver el negocio activo.");
  }
  return snapshot.user.tenantId;
}

/**
 * Igual que `resolveTenantId`, pero además expone `permissions` -- pensado para los services que
 * necesitan verificar un permiso (`ensureCanReadCategories`/`ensureCanManageCategories` y
 * equivalentes de Locations/Units) sin agregar un parámetro `permissions` al `execute()` público
 * de cada service (que hubiera obligado a tocar cada call site en los hooks). Mismo patrón de
 * resolución interna que ya usaba `resolveTenantId`, solo que además devuelve
 * `snapshot.role.permissions`.
 */
export async function resolveTenantContext(repositories: RepositoryRegistry) {
  const snapshot = await resolveCurrentSessionSnapshot(repositories);
  if (!snapshot.user || !snapshot.role) {
    throw new CatalogServiceError("No se pudo resolver el negocio activo.");
  }
  return { tenantId: snapshot.user.tenantId, permissions: snapshot.role.permissions };
}

/**
 * Permission hardening (feature/permission-enforcement-hardening): Categorías/Ubicaciones/
 * Unidades no tenían NINGUNA verificación de permiso a nivel de aplicación -- la única barrera
 * era el nav (`RequirePermission`), y no existía ningún permiso `.read` para estas 3 pantallas.
 * Mismo criterio que Administration (Employees/Roles/Branches, #92): el permiso se verifica en
 * la capa de aplicación, no solo ocultando el botón.
 */
export function ensureCanReadCategories(permissions: readonly string[]) {
  if (
    permissions.includes("catalog.categories.read") ||
    permissions.includes("catalog.categories.manage")
  ) {
    return;
  }
  throw new CatalogServiceError("No dispone de permisos para consultar categorías.");
}

export function ensureCanManageCategories(permissions: readonly string[]) {
  if (permissions.includes("catalog.categories.manage")) return;
  throw new CatalogServiceError("No dispone de permisos para gestionar categorías.");
}

export function ensureCanReadLocations(permissions: readonly string[]) {
  if (
    permissions.includes("catalog.locations.read") ||
    permissions.includes("catalog.locations.manage")
  ) {
    return;
  }
  throw new CatalogServiceError("No dispone de permisos para consultar ubicaciones.");
}

export function ensureCanManageLocations(permissions: readonly string[]) {
  if (permissions.includes("catalog.locations.manage")) return;
  throw new CatalogServiceError("No dispone de permisos para gestionar ubicaciones.");
}

export function ensureCanReadUnits(permissions: readonly string[]) {
  if (permissions.includes("catalog.units.read") || permissions.includes("catalog.units.manage")) {
    return;
  }
  throw new CatalogServiceError("No dispone de permisos para consultar unidades.");
}

export function ensureCanManageUnits(permissions: readonly string[]) {
  if (permissions.includes("catalog.units.manage")) return;
  throw new CatalogServiceError("No dispone de permisos para gestionar unidades.");
}

/**
 * Permission hardening fase 2 (Products, feature/permission-enforcement-hardening-products):
 * mismo criterio que Categorías/Ubicaciones/Unidades -- el permiso se verifica en la capa de
 * aplicación, nunca solo ocultando el botón. Products usa 3 keys canónicas separadas (no un
 * `.manage` único): `catalog.products.read`, `.create`, `.update`. Tener `.create` o `.update`
 * implica poder leer (no tiene sentido poder crear/editar un producto que no podés consultar) --
 * mismo criterio que `.manage` implicando `.read` en Categorías/Ubicaciones/Unidades.
 * `.update` cubre editar, archivar y restaurar. Promociones usan los permisos backend
 * `catalog.promotions.read/manage` y se validan por separado.
 */
export function ensureCanReadProducts(permissions: readonly string[]) {
  if (
    permissions.includes("catalog.products.read") ||
    permissions.includes("catalog.products.create") ||
    permissions.includes("catalog.products.update")
  ) {
    return;
  }
  throw new CatalogServiceError("No dispone de permisos para consultar productos.");
}

export function ensureCanCreateProducts(permissions: readonly string[]) {
  if (permissions.includes("catalog.products.create")) return;
  throw new CatalogServiceError("No dispone de permisos para crear productos.");
}

export function ensureCanUpdateProducts(permissions: readonly string[]) {
  if (permissions.includes("catalog.products.update")) return;
  throw new CatalogServiceError("No dispone de permisos para editar productos.");
}

export function ensureCanReadPromotions(permissions: readonly string[]) {
  if (permissions.includes("catalog.promotions.read")) return;
  throw new CatalogServiceError("No dispone de permisos para consultar promociones.");
}

export function ensureCanManagePromotions(permissions: readonly string[]) {
  if (permissions.includes("catalog.promotions.manage")) return;
  throw new CatalogServiceError("No dispone de permisos para gestionar promociones.");
}

export async function requireCapabilities(
  repositories: RepositoryRegistry,
  tenantId: string,
): Promise<BusinessCapabilitiesConfig> {
  const capabilities = await repositories.businessConfig.getCapabilities(tenantId);
  if (!capabilities) {
    throw new CatalogServiceError("La configuracion del negocio no esta disponible.");
  }
  return capabilities;
}

export function ensureActiveCategory(category: Category | null) {
  if (!category || category.status !== CategoryStatus.active) {
    throw new CatalogServiceError("La categoria seleccionada ya no esta disponible.");
  }
}

export function ensureActiveUnit(unit: Unit | null) {
  if (!unit || unit.status !== UnitStatus.active) {
    throw new CatalogServiceError("La unidad seleccionada ya no esta disponible.");
  }
}

/**
 * Un producto ya guardado con un tipo que despues se deshabilito puede seguir editandose y
 * archivandose: bloquear su edicion dejaria datos existentes sin forma de corregirse. Lo que se
 * prohibe es crear uno nuevo o cambiar un producto hacia un tipo deshabilitado.
 */
export function ensureProductTypeAllowed(
  productType: ProductType,
  capabilities: BusinessCapabilitiesConfig,
  currentProductType?: ProductType,
) {
  if (isProductTypeAllowed(productType, capabilities)) return;
  if (currentProductType === productType) return;
  throw new CatalogServiceError(getDisabledProductTypeMessage(productType));
}

/**
 * Sin "Unidades y empaques", un producto EXISTENTE protege TODA su configuracion de unidades, no
 * solo `saleUnitId`/la equivalencia (que ya se preservan en silencio). `baseUnitId` se edita con un
 * control que, a diferencia del selector de venta, nunca estuvo deshabilitado por esta capacidad:
 * si se permitiera cambiarlo, una equivalencia historica (ej. "1 Caja = 12 Unidades") quedaria
 * atada a una base distinta sin que exista una migracion explicita que la redefina. Por eso esto
 * SE RECHAZA en vez de corregirse en silencio como tracking/atributos/saleUnitId: es un cambio que
 * el usuario pidio activamente, no un efecto colateral de guardar otro campo.
 */
export function ensureUnitConfigUnchanged(
  dto: { baseUnitId: string },
  capabilities: BusinessCapabilitiesConfig,
  current?: { baseUnitId: string },
) {
  if (capabilities.supportsUnitsAndPackaging) return;
  if (!current) return; // producto nuevo: no hay configuracion previa que proteger
  if (dto.baseUnitId === current.baseUnitId) return;
  throw new CatalogServiceError(
    'No podes cambiar la unidad de inventario de este producto mientras "Unidades y empaques" este desactivado en la configuracion del negocio.',
  );
}

export function ensureProduct(product: Product | null) {
  if (!product) throw new CatalogServiceError("El producto solicitado no existe.");
  return product;
}

/**
 * Capa de entitlement SaaS (feature/saas-entitlement-enforcement, auditoría §16) -- se suma a
 * `ensureProductTypeAllowed`/`supportsKits` (business config), nunca los sustituye: crear un Kit
 * nuevo o modificar sus componentes (`ProductKitComponentRepository.replaceForKit`) exige la
 * capability `catalog.kits`, a diferencia de `ensureProductTypeAllowed` NO se exceptúa para un
 * Kit ya existente -- "modificar" el kit también requiere la capability (auditoría §16: "Crear/
 * modificar/ensamblar/usar funcionalidad Kit"). El resto de Catalog (productos no-kit) permanece
 * sin ninguna capability SaaS -- auditoría §2: no se gatea Catalog completo.
 */
export async function ensureTenantCanUseKits(
  repositories: RepositoryRegistry,
  tenantId: string,
): Promise<void> {
  const entitlements = await new ResolveTenantEntitlementsService(repositories).execute(tenantId);
  ensureTenantCapability(entitlements, SaasCapabilityKey.catalogKits);
}

export function cleanError(error: unknown) {
  if (error instanceof ProductEditorPartialSaveError) return error.message;
  if (error instanceof CatalogServiceError) return error.message;
  if (error instanceof BackendRequestError) return error.message;
  return "No se pudo completar la operacion. Intentalo de nuevo.";
}
