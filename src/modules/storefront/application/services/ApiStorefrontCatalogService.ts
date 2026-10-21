import type { StorefrontDiscoveryDto, StorefrontDiscoveryProductDto } from "@/modules/storefront/application/dto/StorefrontDiscoveryDto";
import { toSameOriginMediaUrl } from "@/infrastructure/api/mediaUrl";

interface BackendProduct {
  id: string;
  sku: string;
  name: string;
  description?: string;
  brand?: string;
  primaryImageUrl?: string | null;
  primaryImageAlt?: string | null;
  salePrice: number;
  basePrice?: number | null;
  effectivePrice?: number | null;
  discountAmount?: number | null;
  promotionId?: string | null;
  categoryId: string;
  categoryName?: string | null;
  categoryImageUrl?: string | null;
  saleUnitId?: string | null;
  saleUnitName?: string | null;
  /** Hay disponible en la sucursal que atiende el e-commerce (siempre true si no controla stock). */
  inStock?: boolean;
  /** Disponible (cantidad - reservado); `null` si el producto no controla inventario (servicios). */
  availableQuantity?: number | null;
  attributes?: Array<{ name: string; value: string }> | null;
  availability?: Array<{
    branchId: string;
    branchName: string;
    address?: string | null;
    available: boolean;
  }> | null;
  /** Solo en el detalle: precio desde `minQuantity`; `effectivePrice` ya incluye la promoción. */
  priceTiers?: Array<{ minQuantity: number; effectivePrice: number | string }> | null;
}

function toImageSource(url?: string | null) {
  const normalized = url?.trim();
  return normalized
    ? ({ kind: "url", src: toSameOriginMediaUrl(normalized) } as const)
    : undefined;
}

/** `null` = stock ilimitado para la UI; `inStock: false` siempre se trata como agotado. */
function toAvailableQuantity(product: BackendProduct): number | null {
  if (product.inStock === false) return 0;
  return product.availableQuantity !== undefined && product.availableQuantity !== null
    ? Number(product.availableQuantity)
    : null;
}

function toProduct(product: BackendProduct): StorefrontDiscoveryProductDto {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    brand: product.brand,
    imageSource: toImageSource(product.primaryImageUrl),
    imageAlt: product.primaryImageAlt?.trim() || product.name,
    salePrice: Number(product.salePrice),
    basePrice: product.basePrice == null ? undefined : Number(product.basePrice),
    effectivePrice: product.effectivePrice == null ? undefined : Number(product.effectivePrice),
    discountAmount: product.discountAmount == null ? undefined : Number(product.discountAmount),
    promotionId: product.promotionId ?? undefined,
    salesPriceTiers: [],
    finalPriceTiers: (product.priceTiers ?? []).map((tier) => ({
      minQuantity: Number(tier.minQuantity),
      unitPrice: Number(tier.effectivePrice),
      active: true,
    })),
    categoryId: product.categoryId,
    categoryName: product.categoryName ?? undefined,
    availableQuantity: toAvailableQuantity(product),
    saleUnitId: product.saleUnitId ?? "",
    saleUnitName: product.saleUnitName ?? "",
    attributes: product.attributes ?? [],
    availability: product.availability?.map((branch) => ({
      branchId: branch.branchId,
      branchName: branch.branchName,
      address: branch.address ?? undefined,
      available: branch.available,
    })),
  };
}

export class ApiStorefrontCatalogService {
  private async request(path: string): Promise<BackendProduct | BackendProduct[]> {
    const response = await fetch(`/api/backend${path}`, { cache: "no-store" });
    if (!response.ok) throw new Error("No se pudo cargar el catálogo público.");
    return (await response.json()) as BackendProduct | BackendProduct[];
  }

  async list(tenantSlug: string): Promise<StorefrontDiscoveryDto> {
    const products = (await this.request(`/public/${encodeURIComponent(tenantSlug)}/products`)) as BackendProduct[];
    const mapped = products.map(toProduct);
    const categories = [...new Map(
      products
        .filter((product) => Boolean(product.categoryName))
        .map((product) => [
          product.categoryId,
          {
            id: product.categoryId,
            name: product.categoryName!,
            slug: product.categoryId,
            imageSource: toImageSource(product.categoryImageUrl),
          },
        ] as const),
    ).values()];
    return { categories, products: mapped };
  }

  async getProduct(tenantSlug: string, productId: string): Promise<StorefrontDiscoveryProductDto | null> {
    const response = await fetch(`/api/backend/public/${encodeURIComponent(tenantSlug)}/products/${encodeURIComponent(productId)}`, { cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("No se pudo cargar el producto.");
    return toProduct((await response.json()) as BackendProduct);
  }
}
