import type { Product } from "@/core/entities";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import {
  CatalogServiceError,
  ensureCanUpdateProducts,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";

export class ArchiveProductService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(productId: string): Promise<Product> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanUpdateProducts(permissions);
    try {
      return await this.repositories.products.archiveScoped(tenantId, productId);
    } catch (error) {
      // Un producto inexistente o de otro tenant responde igual (no filtra existencia cross-tenant).
      // Solo se normaliza "producto no encontrado"; cualquier otro error se propaga tal cual.
      if (isProductNotFound(error, productId)) {
        throw new CatalogServiceError("El producto solicitado no existe.");
      }
      throw error;
    }
  }
}

function isProductNotFound(error: unknown, productId: string) {
  // API: 404 / PRODUCT_NOT_FOUND del backend (o de la lectura previa de ApiProductRepository.archive).
  if (error instanceof BackendRequestError) {
    return error.status === 404 || error.code === "PRODUCT_NOT_FOUND";
  }
  // Mock: unico contrato de BaseMockRepository.missing("Product", id).
  return error instanceof Error && error.message === `Product not found: ${productId}`;
}
