import type { Product } from "@/core/entities";
import { ProductStatus, ProductType } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { ProductEditorDto } from "@/modules/catalog/application/dto/ProductEditorDto";
import {
  syncApiEditorRelatedData,
  syncApiProductMedia,
  syncEditorRelatedData,
  syncKitComponents,
  validateEditorProduct,
} from "@/modules/catalog/application/services/productEditorHelpers";
import {
  ProductEditorPartialSaveError,
  type ProductEditorFailedSection,
} from "@/modules/catalog/application/services/ProductEditorPartialSaveError";
import {
  CatalogServiceError,
  ensureCanCreateProducts,
  resolveTenantContext,
} from "@/modules/catalog/application/services/serviceHelpers";

export class CreateProductWithCommercialDataService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(dto: ProductEditorDto): Promise<Product> {
    const { tenantId, permissions } = await resolveTenantContext(this.repositories);
    ensureCanCreateProducts(permissions);
    if (!tenantId) {
      throw new CatalogServiceError("No hay un negocio disponible para crear productos.");
    }

    const { normalizedDto, productInput, capabilities, isNewProduct } = await validateEditorProduct(
      this.repositories,
      dto,
      tenantId,
    );
    const desiredStatus = normalizedDto.status;
    const isApiKit =
      this.repositories.productDataSource === "api" &&
      normalizedDto.productType === ProductType.kit;
    if (isApiKit && !permissions.includes("catalog.products.update")) {
      throw new CatalogServiceError(
        "Crear un kit requiere permiso para guardar sus componentes y restaurarlo.",
      );
    }
    if (
      this.repositories.productMediaDataSource === "api" &&
      normalizedDto.media.length > 0 &&
      !permissions.includes("catalog.products.update")
    ) {
      throw new CatalogServiceError(
        "Guardar multimedia requiere permiso para actualizar productos.",
      );
    }
    const product = await this.repositories.products.create({
      ...productInput,
      status: isApiKit ? ProductStatus.archived : productInput.status,
    });
    if (this.repositories.productDataSource === "mock") {
      await syncEditorRelatedData(this.repositories, product, normalizedDto, {
        capabilities,
        isNewProduct,
      });
      return product;
    }

    const failedSections: ProductEditorFailedSection[] = [];
    const failureMessages: string[] = [];
    const recordFailure = (section: ProductEditorFailedSection, error: unknown) => {
      failedSections.push(section);
      if (error instanceof Error && error.message) failureMessages.push(error.message);
    };

    // Un Kit nace archived: componentes -> restore -> resto de secciones. El backend rechaza
    // atributos y precios por cantidad sobre un producto archivado, asi que van DESPUES del
    // restore; la decision de restaurar depende solo de los componentes y del estado deseado.
    let kitStillArchived = isApiKit;
    if (isApiKit) {
      let componentsSaved = false;
      try {
        await syncKitComponents(this.repositories, product, normalizedDto);
        componentsSaved = true;
      } catch (error) {
        recordFailure("kitComponents", error);
      }
      if (componentsSaved && desiredStatus === ProductStatus.published) {
        try {
          await this.repositories.products.restoreScoped(tenantId, product.id);
          kitStillArchived = false;
        } catch (error) {
          recordFailure("restore", error);
        }
      }
    }

    if (kitStillArchived) {
      // Kit que permanece archived: solo multimedia (permitida). Atributos y precios por cantidad
      // no se intentan; si el usuario los capturo se informan como pendientes.
      if (
        normalizedDto.media.length > 0 &&
        this.repositories.productMediaDataSource === "api"
      ) {
        try {
          await syncApiProductMedia(this.repositories, product, normalizedDto.media);
        } catch (error) {
          recordFailure("media", error);
        }
      }
      const pendingMessage =
        "Atributos y precios por cantidad requieren que el kit este publicado.";
      if ((normalizedDto.attributes ?? []).length > 0) {
        recordFailure("attributes", new Error(pendingMessage));
      }
      if ((normalizedDto.salesPriceTiers ?? []).some((tier) => tier.active)) {
        recordFailure("priceTiers", new Error(pendingMessage));
      }
    } else {
      const relatedResult = await syncApiEditorRelatedData(
        this.repositories,
        product,
        normalizedDto,
        {
          permissions,
          capabilities,
          isNewProduct,
          skipKitComponents: isApiKit,
        },
      );
      failedSections.push(...relatedResult.failedSections);
      failureMessages.push(...relatedResult.failureMessages);
    }

    if (failedSections.length > 0) {
      throw new ProductEditorPartialSaveError(
        product.id,
        true,
        failedSections,
        failureMessages,
      );
    }
    try {
      return (await this.repositories.products.getByIdScoped(tenantId, product.id)) ?? product;
    } catch {
      throw new ProductEditorPartialSaveError(product.id, true, ["canonicalReload"]);
    }
  }
}
