import type { CatalogImageSource } from "@/core/entities";
import type {
  BusinessConfigRepository,
  TenantRepository,
} from "@/core/repositories";

export interface InicioBusinessIdentity {
  businessName?: string;
  logo?: CatalogImageSource;
}

interface InicioBusinessIdentityRepositories {
  tenants: TenantRepository;
  businessConfig: BusinessConfigRepository;
}

/** Identidad publica de la tienda por slug (modo api): no requiere permisos administrativos. */
export type PublicIdentityReader = (tenantSlug: string) => Promise<{
  tenantId: string;
  enabled: boolean;
  storeName: string;
  logo?: CatalogImageSource;
}>;

export class GetInicioBusinessIdentityService {
  constructor(
    private readonly repositories: InicioBusinessIdentityRepositories,
    private readonly readPublicIdentity?: PublicIdentityReader,
  ) {}

  async execute(tenantId: string): Promise<InicioBusinessIdentity> {
    const [tenantResult, ecommerceResult] = await Promise.allSettled([
      this.repositories.tenants.getById(tenantId),
      this.repositories.businessConfig.getEcommerceConfig(tenantId),
    ]);

    const tenant = tenantResult.status === "fulfilled" ? tenantResult.value : null;
    const tenantName = tenant?.name.trim() ?? "";
    const publicIdentity = await this.readVerifiedPublicIdentity(tenantId, tenant?.slug);

    if (
      !publicIdentity &&
      tenantResult.status === "rejected" &&
      ecommerceResult.status === "rejected"
    ) {
      throw new Error("No se pudo cargar la identidad del negocio.");
    }

    // La config publica va primero: un empleado sin `admin.ecommerce_config.manage` recibe del
    // router un e-commerce del mock, que no tiene el logo real del negocio.
    const ecommerce = ecommerceResult.status === "fulfilled" ? ecommerceResult.value : null;
    const source = publicIdentity ?? ecommerce;
    const storeName = source?.enabled ? source.storeName.trim() : "";

    return {
      businessName: storeName || tenantName || undefined,
      logo: source?.enabled ? source.logo : undefined,
    };
  }

  /** null si no hay lector, slug, o la respuesta es de otra tienda o falla (no rompe el inicio). */
  private async readVerifiedPublicIdentity(tenantId: string, tenantSlug: string | undefined) {
    if (!this.readPublicIdentity || !tenantSlug) return null;
    try {
      const identity = await this.readPublicIdentity(tenantSlug);
      return identity.tenantId === tenantId ? identity : null;
    } catch {
      return null;
    }
  }
}
