import type { BusinessCapabilitiesConfig, Product, ProductMedia } from "@/core/entities";
import { ProductType } from "@/core/enums";
import { getProductMediaSource, isSafeCatalogImageUrl } from "@/core/media/catalogImage";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import { normalizeSku } from "@/shared/utils/normalizeSku";
import {
  MAX_KIT_COMPONENT_QUANTITY,
  MAX_SAFE_CONVERSION_FACTOR,
  MAX_SAFE_CURRENCY,
  MAX_SAFE_INTEGER_COUNT,
  MONEY_DECIMAL_PLACES,
  QUANTITY_DECIMAL_PLACES,
  TEXT_LIMITS,
} from "@/shared/utils/inputLimits";
import type {
  ProductEditorDto,
  ProductMediaEditorValue,
} from "@/modules/catalog/application/dto/ProductEditorDto";
import {
  hasAtMostDecimalPlaces,
  isConversionFactorCompatibleWithBaseUnit,
  isQuantityCompatibleWithUnit,
  isPositiveInteger,
  isPositiveNumber as isPositiveNumericInput,
  toFiniteNumber,
  type NumericInputValue,
} from "@/shared/utils/numberInput";
import { ProductMapper } from "@/modules/catalog/application/mappers/ProductMapper";
import {
  applyCapabilityRulesToEditor,
  hasValidationErrors,
  validateProductDto,
} from "@/modules/catalog/validation/product.validation";
import {
  CatalogServiceError,
  ensureActiveCategory,
  ensureActiveUnit,
  ensureProductTypeAllowed,
  ensureTenantCanUseKits,
  ensureUnitConfigUnchanged,
  requireCapabilities,
} from "@/modules/catalog/application/services/serviceHelpers";
import type { ProductEditorFailedSection } from "@/modules/catalog/application/services/ProductEditorPartialSaveError";

export async function validateEditorProduct(
  repositories: RepositoryRegistry,
  dto: ProductEditorDto,
  tenantId: string,
  current?: Pick<
    Product,
    "id" | "productType" | "baseUnitId" | "inventoryUnitId" | "saleUnitId" | "tracking"
  >,
) {
  const capabilities = await requireCapabilities(repositories, tenantId);
  ensureProductTypeAllowed(dto.productType, capabilities, current?.productType);
  ensureUnitConfigUnchanged(dto, capabilities, current);
  if (dto.productType === ProductType.kit) {
    await ensureTenantCanUseKits(repositories, tenantId);
  }

  // El borrador se normaliza ANTES de validar y de persistir: lo que la configuracion deshabilita
  // no llega ni al producto ni a sus datos relacionados, venga de la pantalla o de otro consumidor.
  // Con `current` (producto existente) se conserva lo ya persistido en vez de recortarlo: la
  // capacidad apagada bloquea crear configuracion nueva, nunca borra la que ya habia.
  const capabilityContext = current
    ? {
        saleUnitId: current.saleUnitId ?? current.baseUnitId,
        inventoryUnitId: current.inventoryUnitId ?? current.baseUnitId,
        tracking: current.tracking,
      }
    : undefined;
  const normalizedDto = applyCapabilityRulesToEditor(dto, capabilities, capabilityContext);
  const currentProductId = current?.id;
  if (
    typeof normalizedDto.salePrice !== "number" ||
    !hasAtMostDecimalPlaces(normalizedDto.salePrice, MONEY_DECIMAL_PLACES)
  ) {
    throw new CatalogServiceError("El precio admite hasta 2 decimales.");
  }
  const baseErrors = validateProductDto(toProductDto(normalizedDto));
  if (hasValidationErrors(baseErrors)) {
    throw new CatalogServiceError(Object.values(baseErrors)[0] ?? "Revise los datos del producto.");
  }
  if (normalizedDto.productType === "kit" && normalizedDto.status === "published") {
    if (normalizedDto.kitComponents.length === 0) {
      throw new CatalogServiceError("Un kit publicado requiere al menos un componente físico.");
    }
  }
  if (
    normalizedDto.productType === "kit" &&
    normalizedDto.kitComponents.some(
      (component) =>
        !isPositiveNumericInput(component.quantityPerKit) ||
        toFiniteNumber(component.quantityPerKit) > MAX_KIT_COMPONENT_QUANTITY,
    )
  ) {
    throw new CatalogServiceError("Cada componente del kit debe estar entre 0 y 9,999.");
  }

  const unitConfigurationChanged = current
    ? normalizedDto.baseUnitId !== current.baseUnitId ||
      normalizedDto.inventoryUnitId !== (current.inventoryUnitId ?? current.baseUnitId) ||
      normalizedDto.saleUnitId !== (current.saleUnitId ?? current.baseUnitId)
    : normalizedDto.inventoryUnitId !== normalizedDto.baseUnitId ||
      normalizedDto.saleUnitId !== normalizedDto.baseUnitId;
  if (
    normalizedDto.productType !== ProductType.kit &&
    normalizedDto.unitConversions === undefined &&
    unitConfigurationChanged
  ) {
    throw new CatalogServiceError(
      "Abra la seccion de unidades para validar la configuracion de conversiones.",
    );
  }
  if (normalizedDto.unitConversions !== undefined) {
    if (
      (normalizedDto.inventoryUnitId !== normalizedDto.baseUnitId &&
        !isPositiveNumber(normalizedDto.inventoryToBaseFactor)) ||
      (normalizedDto.saleUnitId !== normalizedDto.baseUnitId &&
        !isPositiveNumber(normalizedDto.saleToBaseFactor))
    ) {
      throw new CatalogServiceError(
        "Cada presentacion debe equivaler a un multiplo positivo de la unidad base.",
      );
    }
    if (
      toFiniteNumber(normalizedDto.inventoryToBaseFactor) > MAX_SAFE_CONVERSION_FACTOR ||
      toFiniteNumber(normalizedDto.saleToBaseFactor) > MAX_SAFE_CONVERSION_FACTOR
    ) {
      throw new CatalogServiceError("El factor de conversion no puede superar 999,999.99.");
    }
  }
  if (
    (normalizedDto.attributes ?? []).some(
      (attribute) =>
        attribute.name.length > TEXT_LIMITS.attributeName ||
        attribute.value.length > TEXT_LIMITS.attributeValue,
    )
  ) {
    throw new CatalogServiceError("Los atributos admiten 50 caracteres en nombre y 100 en valor.");
  }
  if (
    normalizedDto.unitConversions !== undefined &&
    normalizedDto.inventoryUnitId === normalizedDto.saleUnitId &&
    normalizedDto.inventoryUnitId !== normalizedDto.baseUnitId &&
    toFiniteNumber(normalizedDto.inventoryToBaseFactor) !==
      toFiniteNumber(normalizedDto.saleToBaseFactor)
  ) {
    throw new CatalogServiceError("Una misma presentacion no puede tener dos factores distintos.");
  }
  const invalidMedia = normalizedDto.media.find((media) => {
    if (media.pendingUpload || media.source?.kind === "mockAsset") return false;
    const url = media.source?.kind === "url" ? media.source.src : media.url;
    return !isSafeCatalogImageUrl(url);
  });
  if (invalidMedia) {
    throw new CatalogServiceError("Cada imagen debe iniciar con / o una URL http(s).");
  }

  assertUniquePositiveSalesTiers(normalizedDto.salesPriceTiers);
  assertInventorySettings(
    normalizedDto,
    !current || (!current.tracking.stock && normalizedDto.tracking.stock),
  );

  const normalizedSku = normalizeSku(normalizedDto.sku);
  const duplicateSku = await repositories.products.getBySkuScoped(tenantId, normalizedSku);
  if (duplicateSku && duplicateSku.id !== currentProductId) {
    throw new CatalogServiceError("Ya existe un producto con este Codigo / SKU.");
  }

  if (normalizedDto.barcode?.trim()) {
    const products = await repositories.products.getByTenant(tenantId);
    const duplicateBarcode = products.find(
      (product) =>
        product.barcode === normalizedDto.barcode?.trim() && product.id !== currentProductId,
    );
    if (duplicateBarcode) {
      throw new CatalogServiceError("Ya existe un producto con este codigo de barras.");
    }
  }

  const [category, baseUnit, inventoryUnit, saleUnit] = await Promise.all([
    repositories.categories.getByIdScoped(tenantId, normalizedDto.categoryId),
    repositories.units.getByIdScoped(tenantId, normalizedDto.baseUnitId),
    repositories.units.getByIdScoped(tenantId, normalizedDto.inventoryUnitId),
    repositories.units.getByIdScoped(tenantId, normalizedDto.saleUnitId),
  ]);
  ensureActiveCategory(category);
  ensureActiveUnit(baseUnit);
  ensureActiveUnit(inventoryUnit);
  ensureActiveUnit(saleUnit);
  if (!baseUnit) throw new CatalogServiceError("La unidad base no esta disponible.");

  if (normalizedDto.unitConversions !== undefined) {
    const conversionValues = [
      ...(normalizedDto.inventoryUnitId === normalizedDto.baseUnitId
        ? []
        : [normalizedDto.inventoryToBaseFactor]),
      ...(normalizedDto.saleUnitId === normalizedDto.baseUnitId
        ? []
        : [normalizedDto.saleToBaseFactor]),
    ];
    if (
      conversionValues.some(
        (factor) => !isConversionFactorCompatibleWithBaseUnit(factor, baseUnit.allowsDecimals),
      )
    ) {
      throw new CatalogServiceError(
        baseUnit.allowsDecimals
          ? "El factor de conversion admite hasta 6 decimales."
          : "La conversion debe producir una cantidad entera de la unidad base.",
      );
    }
  }
  assertSupplierProducts(normalizedDto.supplierProducts, baseUnit.allowsDecimals);

  if (normalizedDto.productType === ProductType.kit) {
    const componentProducts = await Promise.all(
      normalizedDto.kitComponents.map((component) =>
        repositories.products.getByIdScoped(tenantId, component.componentProductId),
      ),
    );
    if (componentProducts.some((product) => !product)) {
      throw new CatalogServiceError("Uno de los componentes del kit no esta disponible.");
    }
    const componentUnits = await Promise.all(
      componentProducts.map((product) =>
        product ? repositories.units.getByIdScoped(tenantId, product.baseUnitId) : null,
      ),
    );
    normalizedDto.kitComponents.forEach((component, index) => {
      const unit = componentUnits[index];
      if (!unit) throw new CatalogServiceError("La unidad de un componente no esta disponible.");
      if (!isQuantityCompatibleWithUnit(component.quantityPerKit, unit.allowsDecimals)) {
        throw new CatalogServiceError(
          unit.allowsDecimals
            ? `La cantidad del componente admite hasta ${QUANTITY_DECIMAL_PLACES} decimales.`
            : "La unidad del componente no admite fracciones.",
        );
      }
    });
  }

  return {
    normalizedDto,
    capabilities,
    isNewProduct: !current,
    productInput: ProductMapper.toCreateInput(
      { ...toProductDto(normalizedDto), sku: normalizedSku },
      tenantId,
    ),
  };
}

export function toProductDto(dto: ProductEditorDto) {
  const primaryImageUrl = dto.media.find((item) => item.isPrimary)?.url ?? dto.media[0]?.url ?? "";
  return {
    sku: dto.sku,
    barcode: dto.barcode,
    name: dto.name,
    description: dto.description,
    brand: dto.brand,
    productType: dto.productType,
    categoryId: dto.categoryId,
    baseUnitId: dto.baseUnitId,
    inventoryUnitId: dto.inventoryUnitId,
    saleUnitId: dto.saleUnitId,
    salePrice: toFiniteNumber(dto.salePrice),
    status: dto.status,
    tracking: dto.tracking,
    channels: dto.channels,
    primaryImageUrl,
  };
}

export async function syncEditorRelatedData(
  repositories: RepositoryRegistry,
  product: Product,
  dto: ProductEditorDto,
  context: { capabilities: BusinessCapabilitiesConfig; isNewProduct: boolean },
) {
  await Promise.all([
    product.productType === "kit"
      ? repositories.productKitComponents.replaceForKit(
          product.tenantId,
          product.id,
          dto.kitComponents.map((component) => ({
            componentProductId: component.componentProductId,
            quantityPerKit: toFiniteNumber(component.quantityPerKit),
          })),
        )
      : Promise.resolve([]),
    syncInventorySettings(repositories, product, dto),
    syncUnitConversion(repositories, product, dto, context),
    syncAttributes(repositories, product, dto, context),
    syncSalesPriceTiers(repositories, product, dto),
    product.productType === "kit"
      ? Promise.resolve([])
      : syncSupplierProducts(repositories, product, dto),
    syncProductMedia(repositories, product, dto.media),
  ]);
}

export interface ApiEditorSyncOptions {
  permissions: readonly string[];
  capabilities: BusinessCapabilitiesConfig;
  isNewProduct: boolean;
  skipKitComponents?: boolean;
}

export interface ApiEditorSyncResult {
  failedSections: ProductEditorFailedSection[];
  failureMessages: string[];
}

/**
 * Sincroniza cada replace API como una seccion observable. No usa Promise.all: supplier/cost tiers
 * y las operaciones destructivas conservan su orden, y el caller puede informar exactamente que
 * quedo pendiente sin fingir rollback.
 */
export async function syncApiEditorRelatedData(
  repositories: RepositoryRegistry,
  product: Product,
  dto: ProductEditorDto,
  options: ApiEditorSyncOptions,
): Promise<ApiEditorSyncResult> {
  const failed: ProductEditorFailedSection[] = [];
  const failureMessages: string[] = [];
  const hasPermission = (permission: string) => options.permissions.includes(permission);
  const canUpdateProductRelations = hasPermission("catalog.products.update");
  const run = async (section: ProductEditorFailedSection, operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      failed.push(section);
      if (error instanceof Error && error.message) failureMessages.push(error.message);
    }
  };

  if (product.productType === "kit") {
    if (!options.skipKitComponents) {
      await run("kitComponents", () => syncKitComponents(repositories, product, dto));
    }
  } else {
    if (
      options.capabilities.supportsUnitsAndPackaging &&
      dto.unitConversions !== undefined &&
      hasPermission("catalog.units.read") &&
      hasPermission("catalog.units.manage")
    ) {
      await run("conversions", () => syncUnitConversion(repositories, product, dto, options));
    }
    if (hasPermission("admin.suppliers.manage")) {
      await run("suppliers", () => syncSupplierProducts(repositories, product, dto));
    }
    if (
      canUpdateProductRelations &&
      product.productType === ProductType.physical &&
      dto.tracking.stock &&
      hasPermission("inventory.stock.read") &&
      dto.inventorySettings?.branchId
    ) {
      await run("inventorySettings", () => syncInventorySettings(repositories, product, dto));
    }
  }

  if (
    dto.attributes !== undefined &&
    canUpdateProductRelations &&
    hasPermission("catalog.attributes.read")
  ) {
    await run("attributes", () =>
      syncAttributes(
        repositories,
        product,
        dto,
        options,
        hasPermission("catalog.attributes.manage"),
      ),
    );
  }
  if (canUpdateProductRelations && dto.salesPriceTiers !== undefined) {
    await run("priceTiers", () => syncSalesPriceTiers(repositories, product, dto));
  }
  if (canUpdateProductRelations) {
    if (repositories.productMediaDataSource === "api") {
      await run("media", () => syncApiProductMedia(repositories, product, dto.media));
    }
  }

  return { failedSections: failed, failureMessages };
}

export async function syncKitComponents(
  repositories: RepositoryRegistry,
  product: Product,
  dto: ProductEditorDto,
) {
  return repositories.productKitComponents.replaceForKit(
    product.tenantId,
    product.id,
    dto.kitComponents.map((component) => ({
      componentProductId: component.componentProductId,
      quantityPerKit: toFiniteNumber(component.quantityPerKit),
    })),
  );
}

async function syncSalesPriceTiers(
  repositories: RepositoryRegistry,
  product: Product,
  dto: ProductEditorDto,
) {
  if (dto.salesPriceTiers === undefined) return;
  return repositories.productSalesPriceTiers.replaceForProduct(
    product.id,
    dto.salesPriceTiers
      .filter((tier) => tier.active)
      .map((tier) => ({
        tenantId: product.tenantId,
        minQuantity: toFiniteNumber(tier.minQuantity),
        unitPrice: toFiniteNumber(tier.unitPrice),
        active: tier.active,
      })),
  );
}

function assertInventorySettings(dto: ProductEditorDto, required: boolean) {
  if (!dto.tracking.stock) return;
  if (!dto.inventorySettings) {
    if (required) {
      throw new CatalogServiceError(
        "Abra la seccion de inventario para configurar los parametros de la sucursal.",
      );
    }
    return;
  }
  const minStock = toFiniteNumber(dto.inventorySettings.minStock);
  if (
    dto.inventorySettings.minStock === "" ||
    !Number.isSafeInteger(minStock) ||
    minStock < 0 ||
    minStock > MAX_SAFE_INTEGER_COUNT
  ) {
    throw new CatalogServiceError("El stock minimo debe ser mayor o igual a 0.");
  }
}

async function syncInventorySettings(
  repositories: RepositoryRegistry,
  product: Product,
  dto: ProductEditorDto,
) {
  if (!dto.tracking.stock || !dto.inventorySettings?.branchId) return;

  await repositories.inventory.upsertProductInventorySettings({
    tenantId: product.tenantId,
    productId: product.id,
    branchId: dto.inventorySettings.branchId,
    minStock: toFiniteNumber(dto.inventorySettings.minStock),
    // undefined (campo no cargado) conserva el valor actual; "" lo deja sin configurar (null).
    reorderPoint:
      dto.inventorySettings.reorderPoint === undefined
        ? undefined
        : dto.inventorySettings.reorderPoint === ""
          ? null
          : toFiniteNumber(dto.inventorySettings.reorderPoint),
    // undefined conserva un valor no cargado; la opcion vacia solicita limpiar la asignacion.
    defaultLocationId:
      dto.inventorySettings.defaultLocationId === undefined
        ? undefined
        : dto.inventorySettings.defaultLocationId === ""
          ? null
          : dto.inventorySettings.defaultLocationId,
  });
}

async function syncUnitConversion(
  repositories: RepositoryRegistry,
  product: Product,
  dto: ProductEditorDto,
  context: { capabilities: BusinessCapabilitiesConfig; isNewProduct: boolean },
) {
  if (dto.unitConversions === undefined) return;
  // Capacidad apagada: no se toca la tabla de conversiones en absoluto. Un producto nuevo usa una
  // sola unidad (no hay equivalencias que crear) y uno existente conserva su conversion historica
  // intacta pase lo que pase con los factores del borrador (evita confiar en esos numeros).
  if (!context.capabilities.supportsUnitsAndPackaging) return;

  await repositories.units.replaceConversionsForProductScoped(product.tenantId, product.id, [
    ...(dto.inventoryUnitId === dto.baseUnitId
      ? []
      : [
          {
            fromUnitId: dto.inventoryUnitId,
            toUnitId: dto.baseUnitId,
            factor: toFiniteNumber(dto.inventoryToBaseFactor),
          },
        ]),
    ...(dto.saleUnitId === dto.baseUnitId || dto.saleUnitId === dto.inventoryUnitId
      ? []
      : [
          {
            fromUnitId: dto.saleUnitId,
            toUnitId: dto.baseUnitId,
            factor: toFiniteNumber(dto.saleToBaseFactor),
          },
        ]),
  ]);
}

async function syncAttributes(
  repositories: RepositoryRegistry,
  product: Product,
  dto: ProductEditorDto,
  context: { capabilities: BusinessCapabilitiesConfig; isNewProduct: boolean },
  canCreateDefinitions = true,
) {
  // undefined representa una seccion que nunca fue cargada: no consultar definitions ni reemplazar
  // values evita interpretar "no cargado" como "eliminar todos".
  if (dto.attributes === undefined) return;

  // Producto existente + capacidad apagada: la pestana de atributos queda oculta o de solo lectura
  // en la UI, asi que no hay una edicion legitima que sincronizar. No tocar la tabla de valores en
  // absoluto es mas seguro que confiar en `dto.attributes` para reconstruirla.
  if (!context.capabilities.supportsProductAttributes && !context.isNewProduct) return;

  const definitions = await repositories.attributes.getDefinitions();
  const values = [];

  for (const attribute of dto.attributes) {
    const name = attribute.name.trim();
    const value = attribute.value.trim();
    if (!name || !value) continue;

    let definition = attribute.attributeDefinitionId
      ? (definitions.find((item) => item.id === attribute.attributeDefinitionId) ?? null)
      : null;

    if (!definition) {
      const code = name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      definition =
        definitions.find(
          (item) =>
            (item.tenantId === undefined || item.tenantId === product.tenantId) &&
            item.code === code &&
            item.dataType === "text" &&
            item.active,
        ) ?? null;
      if (!definition && !canCreateDefinitions) {
        throw new CatalogServiceError(
          "No dispone de permisos para crear la definicion de un atributo nuevo.",
        );
      }
      definition ??= await repositories.attributes.createDefinition({
        tenantId: product.tenantId,
        name,
        code,
        dataType: "text",
        required: false,
        active: true,
      });
      definitions.push(definition);
    }

    values.push({
      attributeDefinitionId: definition.id,
      value,
    });
  }

  await repositories.attributes.replaceValuesForProduct(product.id, values);
}

async function syncSupplierProducts(
  repositories: RepositoryRegistry,
  product: Product,
  dto: ProductEditorDto,
) {
  const current = await repositories.supplierProducts.getAllByProductForTenant(
    product.tenantId,
    product.id,
  );
  const nextIds = new Set<string>();

  const normalizedSupplierProducts = normalizePreferredSupplier(dto.supplierProducts);

  for (const supplierProduct of normalizedSupplierProducts) {
    if (!supplierProduct.supplierId) continue;
    const input = {
      tenantId: product.tenantId,
      supplierId: supplierProduct.supplierId,
      productId: product.id,
      supplierSku: supplierProduct.supplierSku?.trim() || undefined,
      purchaseUnitId: supplierProduct.purchaseUnitId,
      purchaseToBaseFactor: toFiniteNumber(supplierProduct.purchaseToBaseFactor),
      lastCost: toFiniteNumber(supplierProduct.lastCost),
      leadTimeDays: toFiniteNumber(supplierProduct.leadTimeDays),
      minimumOrderQuantity: toFiniteNumber(supplierProduct.minimumOrderQuantity),
      preferred: supplierProduct.preferred,
      active: true,
    };
    const existing = supplierProduct.id
      ? current.find((item) => item.id === supplierProduct.id)
      : current.find((item) => item.supplierId === supplierProduct.supplierId);
    const saved = existing
      ? await repositories.supplierProducts.update(product.tenantId, existing.id, input)
      : await repositories.supplierProducts.create(input);
    nextIds.add(saved.id);
    if (supplierProduct.costTiers !== undefined) {
      await repositories.supplierProducts.replaceCostTiers(
        product.tenantId,
        saved.id,
        supplierProduct.costTiers.map((tier) => ({
          tenantId: product.tenantId,
          minQuantity: toFiniteNumber(tier.minQuantity),
          unitCost: toFiniteNumber(tier.unitCost),
        })),
      );
    }
  }

  await Promise.all(
    current
      .filter((supplierProduct) => supplierProduct.active && !nextIds.has(supplierProduct.id))
      .map((supplierProduct) =>
        repositories.supplierProducts.archive(product.tenantId, supplierProduct.id),
      ),
  );
}

export async function syncProductMedia(
  repositories: RepositoryRegistry,
  product: Product,
  mediaValues: ProductMediaEditorValue[],
) {
  const current = await repositories.productMedia.getByProduct(product.id);
  const nextIds = new Set<string>();
  if (mediaValues.length > 6) throw new CatalogServiceError("Se pueden guardar hasta 6 imágenes.");
  const normalizedMedia = mediaValues
    .filter((item) => item.pendingUpload || item.source || item.url.trim())
    .map((item, index) => ({
      ...item,
      url:
        item.source?.kind === "url" && !item.url.trim() ? item.source.src.trim() : item.url.trim(),
      isPrimary: item.isPrimary,
      sortOrder: index + 1,
    }));
  const hasPrimary = normalizedMedia.some((item) => item.isPrimary);
  const previousAssetIds = new Set(
    current.flatMap((item) => {
      const source = getProductMediaSource(item);
      return source?.kind === "mockAsset" ? [source.assetId] : [];
    }),
  );

  for (const [index, media] of normalizedMedia.entries()) {
    if (!media.pendingUpload && media.source?.kind === "mockAsset") {
      const ownedAsset = await repositories.catalogImageAssets.get(
        product.tenantId,
        media.source.assetId,
      );
      if (!ownedAsset) throw new CatalogServiceError("La imagen local ya no esta disponible.");
    }
    const newAssetId = media.pendingUpload ? crypto.randomUUID() : null;
    if (newAssetId && media.pendingUpload) {
      await repositories.catalogImageAssets.put(
        {
          id: newAssetId,
          tenantId: product.tenantId,
          mimeType: media.pendingUpload.mimeType,
          byteSize: media.pendingUpload.byteSize,
          width: media.pendingUpload.width,
          height: media.pendingUpload.height,
          createdAt: new Date().toISOString(),
        },
        media.pendingUpload.blob,
      );
    }
    const input: ProductMedia = {
      id: media.id ?? "",
      tenantId: product.tenantId,
      productId: product.id,
      type: media.type,
      url: media.url,
      source: newAssetId ? { kind: "mockAsset", assetId: newAssetId } : media.source,
      alt: media.alt?.trim() || product.name,
      isPrimary: hasPrimary ? media.isPrimary : index === 0,
      sortOrder: media.sortOrder,
      createdAt:
        current.find((item) => item.id === media.id)?.createdAt ?? new Date().toISOString(),
    };

    let saved: ProductMedia;
    try {
      saved = media.id
        ? await repositories.productMedia.update(input)
        : await repositories.productMedia.add({
            tenantId: input.tenantId,
            productId: input.productId,
            type: input.type,
            url: input.url,
            source: input.source,
            alt: input.alt,
            isPrimary: input.isPrimary,
            sortOrder: input.sortOrder,
            createdAt: input.createdAt,
          });
    } catch (error) {
      if (newAssetId) await repositories.catalogImageAssets.remove(product.tenantId, newAssetId);
      throw error;
    }
    nextIds.add(saved.id);
  }

  await Promise.all(
    current
      .filter((media) => !nextIds.has(media.id))
      .map((media) => repositories.productMedia.remove(media.id)),
  );

  const nextMedia = await repositories.productMedia.getByProduct(product.id);
  const nextAssetIds = new Set(
    nextMedia.flatMap((item) => {
      const source = getProductMediaSource(item);
      return source?.kind === "mockAsset" ? [source.assetId] : [];
    }),
  );
  await Promise.all(
    [...previousAssetIds]
      .filter((assetId) => !nextAssetIds.has(assetId))
      .map((assetId) => removeAssetIfOrphaned(repositories, product.tenantId, assetId)),
  );
}

export async function syncApiProductMedia(
  repositories: RepositoryRegistry,
  product: Product,
  mediaValues: ProductMediaEditorValue[],
) {
  if (mediaValues.length > 6) {
    throw new CatalogServiceError("Se pueden guardar hasta 6 imágenes.");
  }
  if (mediaValues.some((media) => media.source?.kind === "mockAsset")) {
    throw new CatalogServiceError("Una imagen mock no puede enviarse a Product Media API.");
  }

  const current = await repositories.productMedia.getByProduct(product.id, product.tenantId);
  const candidates = mediaValues.filter(
    (item) => item.pendingUpload || item.source || item.url.trim(),
  );
  const firstImageIndex = candidates.findIndex((item) => item.type === "image");
  const hasPrimaryImage = candidates.some((item) => item.type === "image" && item.isPrimary);
  const normalized = candidates.map((item, index) => ({
    ...item,
    url: editorMediaUrl(item),
    isPrimary:
      item.type === "image" && (hasPrimaryImage ? item.isPrimary : index === firstImageIndex),
    sortOrder: index,
  }));
  const currentById = new Map(current.map((item) => [item.id, item]));
  const currentPrimaryId = current.find((item) => item.type === "image" && item.isPrimary)?.id;
  for (const media of normalized) {
    if (media.id && !currentById.has(media.id)) {
      throw new CatalogServiceError("Una referencia multimedia ya no pertenece al producto.");
    }
  }

  const retainedIds = new Set(normalized.flatMap((item) => (item.id ? [item.id] : [])));
  const removals = current.filter((item) => !retainedIds.has(item.id));
  const resolvedIds = new Map<number, string>();

  try {
    for (const [index, media] of normalized.entries()) {
      if (!media.id || media.pendingUpload) continue;
      const existing = currentById.get(media.id);
      if (!existing) continue;
      if (existing.type !== media.type) {
        throw new CatalogServiceError("El tipo de una multimedia existente no puede cambiarse.");
      }
      const nextAlt = media.alt?.trim() || undefined;
      const existingAlt = existing.alt?.trim() || undefined;
      const urlChanged = media.url !== existing.url;
      if (nextAlt !== existingAlt || media.sortOrder !== existing.sortOrder || urlChanged) {
        await repositories.productMedia.update({
          ...existing,
          url: media.url,
          source: media.url ? { kind: "url", src: media.url } : existing.source,
          alt: nextAlt,
          sortOrder: media.sortOrder,
        });
      }
      resolvedIds.set(index, existing.id);
    }

    for (const media of removals) {
      await repositories.productMedia.removeFromProduct(product.id, media.id);
    }
    let persistedCount = current.length - removals.length;

    for (const [index, media] of normalized.entries()) {
      if (!media.pendingUpload) continue;
      const replacing = media.id ? currentById.get(media.id) : undefined;
      let removedReplacementFirst = false;
      if (!replacing && persistedCount >= 6) {
        throw new CatalogServiceError(
          "El producto ya alcanzó el límite de 6 elementos multimedia.",
        );
      }
      if (replacing && persistedCount >= 6) {
        await repositories.productMedia.removeFromProduct(product.id, replacing.id);
        persistedCount -= 1;
        removedReplacementFirst = true;
      }
      const uploaded = await repositories.productMedia.uploadForProduct(product.id, {
        tenantId: product.tenantId,
        file: media.pendingUpload.blob,
        alt: media.alt?.trim() || product.name,
        sortOrder: media.sortOrder,
        isPrimary: media.isPrimary,
      });
      persistedCount += 1;
      resolvedIds.set(index, uploaded.id);
      if (replacing && !removedReplacementFirst) {
        await repositories.productMedia.removeFromProduct(product.id, replacing.id);
        persistedCount -= 1;
      }
    }

    for (const [index, media] of normalized.entries()) {
      if (media.id || media.pendingUpload) continue;
      if (persistedCount >= 6) {
        throw new CatalogServiceError(
          "El producto ya alcanzó el límite de 6 elementos multimedia.",
        );
      }
      const created = await repositories.productMedia.add({
        tenantId: product.tenantId,
        productId: product.id,
        type: media.type,
        url: media.url,
        source: media.url ? { kind: "url", src: media.url } : undefined,
        alt: media.alt?.trim() || product.name,
        isPrimary: media.isPrimary,
        sortOrder: media.sortOrder,
        createdAt: new Date().toISOString(),
      });
      persistedCount += 1;
      resolvedIds.set(index, created.id);
    }

    const primaryIndex = normalized.findIndex((item) => item.isPrimary);
    const primaryId = primaryIndex >= 0 ? resolvedIds.get(primaryIndex) : undefined;
    if (primaryId && primaryId !== currentPrimaryId) {
      await repositories.productMedia.setPrimary(product.id, primaryId);
    }

    return repositories.productMedia.getByProduct(product.id, product.tenantId);
  } catch (error) {
    await repositories.productMedia.getByProduct(product.id, product.tenantId).catch(() => []);
    throw error;
  }
}

function editorMediaUrl(media: ProductMediaEditorValue) {
  if (media.url.trim()) return media.url.trim();
  return media.source?.kind === "url" ? media.source.src.trim() : "";
}

export async function removeAssetIfOrphaned(
  repositories: RepositoryRegistry,
  tenantId: string,
  assetId: string,
) {
  const [productReferences, categories] = await Promise.all([
    repositories.productMedia.getByAssetId(tenantId, assetId),
    repositories.categories.getByTenant(tenantId),
  ]);
  const categoryReference = categories.some(
    (category) =>
      category.tenantId === tenantId &&
      category.image?.kind === "mockAsset" &&
      category.image.assetId === assetId,
  );
  if (productReferences.length === 0 && !categoryReference) {
    await repositories.catalogImageAssets.remove(tenantId, assetId);
  }
}

function assertUniquePositiveSalesTiers(tiers: ProductEditorDto["salesPriceTiers"]) {
  if (tiers === undefined) return;
  const quantities = new Set<number>();
  for (const tier of tiers) {
    const minQuantity = toFiniteNumber(tier.minQuantity);
    if (!isPositiveInteger(tier.minQuantity) || minQuantity <= 1) {
      throw new CatalogServiceError("La cantidad minima mayorista debe ser mayor a 1.");
    }
    if (minQuantity > MAX_SAFE_INTEGER_COUNT) {
      throw new CatalogServiceError("La cantidad minima no puede superar 999,999.");
    }
    if (!isPositiveNumericInput(tier.unitPrice)) {
      throw new CatalogServiceError("El precio mayorista debe ser mayor a 0.");
    }
    if (toFiniteNumber(tier.unitPrice) > MAX_SAFE_CURRENCY) {
      throw new CatalogServiceError("El precio mayorista no puede superar Q9,999,999.99.");
    }
    if (!hasAtMostDecimalPlaces(tier.unitPrice, MONEY_DECIMAL_PLACES)) {
      throw new CatalogServiceError("El precio mayorista admite hasta 2 decimales.");
    }
    if (quantities.has(minQuantity)) {
      throw new CatalogServiceError("No repitas cantidades minimas en precios mayoristas.");
    }
    quantities.add(minQuantity);
  }
}

function assertSupplierProducts(
  supplierProducts: ProductEditorDto["supplierProducts"],
  baseUnitAllowsDecimals: boolean,
) {
  const normalizedSupplierProducts = normalizePreferredSupplier(supplierProducts);
  const suppliers = new Set<string>();
  for (const supplierProduct of normalizedSupplierProducts) {
    if (suppliers.has(supplierProduct.supplierId)) {
      throw new CatalogServiceError("No se puede asociar el mismo proveedor dos veces.");
    }
    suppliers.add(supplierProduct.supplierId);
    if (!isPositiveNumber(supplierProduct.purchaseToBaseFactor)) {
      throw new CatalogServiceError("El contenido de compra debe ser mayor a 0.");
    }
    if (toFiniteNumber(supplierProduct.purchaseToBaseFactor) > MAX_SAFE_CONVERSION_FACTOR) {
      throw new CatalogServiceError("El contenido de compra no puede superar 999,999.99.");
    }
    if (
      !isConversionFactorCompatibleWithBaseUnit(
        supplierProduct.purchaseToBaseFactor,
        baseUnitAllowsDecimals,
      )
    ) {
      throw new CatalogServiceError(
        baseUnitAllowsDecimals
          ? "El contenido de compra admite hasta 6 decimales."
          : "El contenido de compra debe producir unidades base enteras.",
      );
    }
    if (toFiniteNumber(supplierProduct.lastCost, -1) < 0) {
      throw new CatalogServiceError("El costo del proveedor debe ser mayor o igual a 0.");
    }
    if (toFiniteNumber(supplierProduct.lastCost) > MAX_SAFE_CURRENCY) {
      throw new CatalogServiceError("El costo del proveedor no puede superar Q9,999,999.99.");
    }
    if (!hasAtMostDecimalPlaces(supplierProduct.lastCost, MONEY_DECIMAL_PLACES)) {
      throw new CatalogServiceError("El costo del proveedor admite hasta 2 decimales.");
    }
    if (
      !isPositiveInteger(supplierProduct.minimumOrderQuantity) ||
      toFiniteNumber(supplierProduct.minimumOrderQuantity) > MAX_SAFE_INTEGER_COUNT
    ) {
      throw new CatalogServiceError("El pedido minimo debe ser un entero entre 1 y 999,999.");
    }
    if (!isNonNegativeInteger(supplierProduct.leadTimeDays)) {
      throw new CatalogServiceError("El plazo de entrega debe ser un entero mayor o igual a 0.");
    }
    if (toFiniteNumber(supplierProduct.leadTimeDays) > MAX_SAFE_INTEGER_COUNT) {
      throw new CatalogServiceError("El plazo de entrega no puede superar 999,999 dias.");
    }
    const quantities = new Set<number>();
    for (const tier of supplierProduct.costTiers ?? []) {
      const minQuantity = toFiniteNumber(tier.minQuantity);
      if (!isPositiveInteger(tier.minQuantity)) {
        throw new CatalogServiceError("La cantidad minima de costo debe ser mayor a 0.");
      }
      if (minQuantity > MAX_SAFE_INTEGER_COUNT) {
        throw new CatalogServiceError("La cantidad minima de costo no puede superar 999,999.");
      }
      if (toFiniteNumber(tier.unitCost, -1) < 0) {
        throw new CatalogServiceError("El costo por volumen debe ser mayor o igual a 0.");
      }
      if (toFiniteNumber(tier.unitCost) > MAX_SAFE_CURRENCY) {
        throw new CatalogServiceError("El costo por volumen no puede superar Q9,999,999.99.");
      }
      if (!hasAtMostDecimalPlaces(tier.unitCost, MONEY_DECIMAL_PLACES)) {
        throw new CatalogServiceError("El costo por volumen admite hasta 2 decimales.");
      }
      if (quantities.has(minQuantity)) {
        throw new CatalogServiceError("No repitas cantidades minimas en costos por proveedor.");
      }
      quantities.add(minQuantity);
    }
  }
}

function isPositiveNumber(value: NumericInputValue) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeInteger(value: NumericInputValue) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function normalizePreferredSupplier(supplierProducts: ProductEditorDto["supplierProducts"]) {
  if (!supplierProducts.length || supplierProducts.some((item) => item.preferred)) {
    return supplierProducts;
  }
  return supplierProducts.map((item, index) => ({ ...item, preferred: index === 0 }));
}
