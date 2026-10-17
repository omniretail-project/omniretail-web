import { ProductType, SalesChannel } from "@/core/enums";
import { getBranchAvailableQuantity } from "@/core/inventory/stockAvailability";
import { getCanonicalProductAvailability } from "@/core/inventory/canonicalAvailability";
import { calculateEffectivePrice, isPromotionApplicable } from "@/core/pricing";
import { fromBaseQuantity } from "@/core/units";
import type { InventoryStockListItem } from "@/core/repositories";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { PosProductDto } from "@/modules/pos/application/dto/PosProductDto";

export interface GetPosProductsInput {
  tenantId: string;
  branchId: string;
}

export class GetPosProductsService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(input: GetPosProductsInput): Promise<PosProductDto[]> {
    const products = (await this.repositories.products.getAvailableForPos()).filter(
      (product) => product.tenantId === input.tenantId,
    );
    if (this.repositories.inventoryStockDataSource === "api") {
      return this.getApiProducts(input, products);
    }
    const at = new Date().toISOString();
    const locations = await this.repositories.inventory.getLocations(input.branchId);

    const units = await this.repositories.units.getByTenant(input.tenantId);
    const items = await Promise.all(
      products.map(
        async (product): Promise<PosProductDto & { canonicalAvailableQuantity: number | null }> => {
          const [promotion, salesPriceTiers, balances, lots, serials, kitComponents] =
            await Promise.all([
              this.repositories.promotions.getApplicable({
                tenantId: input.tenantId,
                productId: product.id,
                at,
                channel: SalesChannel.pos,
                branchId: input.branchId,
              }),
              this.repositories.productSalesPriceTiers.getByProduct(product.id),
              product.tracking.stock
                ? this.repositories.inventory.getBalanceByProduct(product.id, input.branchId)
                : Promise.resolve([]),
              product.tracking.lot
                ? this.repositories.inventory.getLots(product.id)
                : Promise.resolve([]),
              product.tracking.serial
                ? this.repositories.inventory.getSerialNumbers(product.id)
                : Promise.resolve([]),
              product.productType === ProductType.kit
                ? this.repositories.productKitComponents.getByKitProduct(product.id)
                : Promise.resolve([]),
            ]);
          const price = calculateEffectivePrice(product.salePrice, promotion);
          const saleUnitId = product.saleUnitId ?? product.baseUnitId;
          const conversions = await this.repositories.units.getConversionsByProductScoped(
            input.tenantId,
            product.id,
          );
          const tracksStock = product.tracking.stock || product.productType === ProductType.kit;
          const physicalAvailableQuantity = product.tracking.stock
            ? getCanonicalProductAvailability({
                product,
                tenantId: input.tenantId,
                branchId: input.branchId,
                balances,
                lots,
                serials,
                locations,
                at,
              })
            : null;
          const kitAvailableQuantity =
            product.productType === ProductType.kit && kitComponents.length > 0
              ? Math.min(
                  ...(await Promise.all(
                    kitComponents.map(async (component) => {
                      const componentBalances =
                        await this.repositories.inventory.getBalanceByProduct(
                          component.componentProductId,
                          input.branchId,
                        );
                      const available = getBranchAvailableQuantity({
                        tenantId: input.tenantId,
                        branchId: input.branchId,
                        productId: component.componentProductId,
                        balances: componentBalances,
                        locations,
                      });
                      return Math.floor(available / component.quantityPerKit);
                    }),
                  )),
                )
              : null;
          const canonicalAvailableQuantity =
            product.productType === ProductType.kit
              ? Number.isFinite(kitAvailableQuantity)
                ? kitAvailableQuantity
                : 0
              : physicalAvailableQuantity;
          let hasValidSaleConversion = true;
          let availableQuantity: number | null = canonicalAvailableQuantity;
          if (canonicalAvailableQuantity !== null) {
            try {
              availableQuantity = fromBaseQuantity(canonicalAvailableQuantity, {
                targetUnitId: saleUnitId,
                baseUnitId: product.baseUnitId,
                conversions,
              });
            } catch {
              hasValidSaleConversion = false;
              availableQuantity = 0;
            }
          }
          const requiresLot = product.tracking.lot;
          const requiresSerial = product.tracking.serial;
          const requiresUnsupportedTraceability = product.tracking.expiration && !requiresLot;

          return {
            productId: product.id,
            sku: product.sku,
            barcode: product.barcode,
            name: product.name,
            productType: product.productType,
            basePrice: price.basePrice,
            effectivePrice: price.effectivePrice,
            discount: price.discountAmount,
            salesPriceTiers: salesPriceTiers
              .filter(
                (tier) =>
                  tier.tenantId === input.tenantId && tier.productId === product.id && tier.active,
              )
              .map(({ minQuantity, unitPrice, active }) => ({ minQuantity, unitPrice, active })),
            promotion: promotion ?? undefined,
            availableQuantity,
            saleUnitId,
            saleUnitName: units.find((unit) => unit.id === saleUnitId)?.name ?? saleUnitId,
            tracksStock,
            requiresLot,
            requiresSerial,
            requiresUnsupportedTraceability,
            isAvailableForSale:
              hasValidSaleConversion &&
              !requiresUnsupportedTraceability &&
              (!(tracksStock || product.productType === ProductType.kit) ||
                (availableQuantity !== null && availableQuantity > 0)),
            canonicalAvailableQuantity,
          };
        },
      ),
    );

    const byProductId = new Map(items.map((item) => [item.productId, item]));
    const resolvedKitAvailability = await Promise.all(
      items.map(async (item) => {
        if (item.productType !== ProductType.kit) return item;
        const components = await this.repositories.productKitComponents.getByKitProduct(
          item.productId,
        );
        const availableQuantity = components.length
          ? Math.min(
              ...components.map((component) => {
                const componentProduct = byProductId.get(component.componentProductId);
                return Math.floor(
                  ((componentProduct as PosProductDto & { canonicalAvailableQuantity?: number })
                    ?.canonicalAvailableQuantity ?? 0) / component.quantityPerKit,
                );
              }),
            )
          : 0;
        const product = products.find((candidate) => candidate.id === item.productId);
        if (!product) return { ...item, availableQuantity: 0, isAvailableForSale: false };
        const conversions = await this.repositories.units.getConversionsByProductScoped(
          input.tenantId,
          product.id,
        );
        let sellableAvailableQuantity = 0;
        try {
          sellableAvailableQuantity = fromBaseQuantity(availableQuantity, {
            targetUnitId: item.saleUnitId,
            baseUnitId: product.baseUnitId,
            conversions,
          });
        } catch {
          return { ...item, availableQuantity: 0, isAvailableForSale: false };
        }
        return {
          ...item,
          canonicalAvailableQuantity: availableQuantity,
          availableQuantity: sellableAvailableQuantity,
          isAvailableForSale: sellableAvailableQuantity > 0,
        };
      }),
    );
    return resolvedKitAvailability.sort((left, right) => left.name.localeCompare(right.name));
  }

  private async getApiProducts(
    input: GetPosProductsInput,
    products: Awaited<ReturnType<RepositoryRegistry["products"]["getAvailableForPos"]>>,
  ): Promise<PosProductDto[]> {
    // Promociones y conversiones se cargan una sola vez para todo el catalogo: consultarlas por
    // producto multiplicaba las peticiones (cada una revalida sesion y rol en el backend).
    // Los tramos de precio solo tienen endpoint por producto.
    const [stockItems, units, activePromotions, allConversions] = await Promise.all([
      this.getAllApiStock(input.branchId),
      this.repositories.units.getByTenant(input.tenantId),
      this.repositories.promotions.getActiveByTenant(input.tenantId),
      this.repositories.units.getAllConversionsByTenant(input.tenantId),
    ]);
    const stockByProductId = new Map(stockItems.map((item) => [item.productId, item]));
    const conversionsByProductId = new Map<string, typeof allConversions>();
    for (const conversion of allConversions) {
      if (!conversion.productId) continue;
      const group = conversionsByProductId.get(conversion.productId) ?? [];
      group.push(conversion);
      conversionsByProductId.set(conversion.productId, group);
    }
    const at = new Date().toISOString();

    const items = await Promise.all(
      products.map(async (product): Promise<PosProductDto> => {
        const promotion =
          activePromotions.find((candidate) =>
            isPromotionApplicable(candidate, {
              tenantId: input.tenantId,
              productId: product.id,
              at,
              channel: SalesChannel.pos,
              branchId: input.branchId,
            }),
          ) ?? null;
        const conversions = conversionsByProductId.get(product.id) ?? [];
        const salesPriceTiers = await this.repositories.productSalesPriceTiers.getByProduct(
          product.id,
        );
        const price = calculateEffectivePrice(product.salePrice, promotion);
        const saleUnitId = product.saleUnitId ?? product.baseUnitId;
        const stock = stockByProductId.get(product.id);
        const tracksStock = product.tracking.stock || product.productType === ProductType.kit;
        const canonicalAvailableQuantity = getApiAvailableQuantity(product.productType, stock);
        let availableQuantity = canonicalAvailableQuantity;
        let hasValidSaleConversion = true;
        if (canonicalAvailableQuantity !== null) {
          try {
            availableQuantity = fromBaseQuantity(canonicalAvailableQuantity, {
              targetUnitId: saleUnitId,
              baseUnitId: product.baseUnitId,
              conversions,
            });
          } catch {
            availableQuantity = 0;
            hasValidSaleConversion = false;
          }
        }
        // El contrato de venta exige selecciones explicitas para trazabilidad. La terminal actual
        // no ofrece ese selector, por lo que falla cerrado en vez de enviar selecciones vacias.
        const requiresUnsupportedTraceability =
          product.tracking.lot || product.tracking.serial || product.tracking.expiration;

        return {
          productId: product.id,
          sku: product.sku,
          barcode: product.barcode,
          name: product.name,
          productType: product.productType,
          basePrice: price.basePrice,
          effectivePrice: price.effectivePrice,
          discount: price.discountAmount,
          salesPriceTiers: salesPriceTiers
            .filter(
              (tier) =>
                tier.tenantId === input.tenantId && tier.productId === product.id && tier.active,
            )
            .map(({ minQuantity, unitPrice, active }) => ({ minQuantity, unitPrice, active })),
          promotion: promotion ?? undefined,
          availableQuantity,
          saleUnitId,
          saleUnitName: units.find((unit) => unit.id === saleUnitId)?.name ?? saleUnitId,
          tracksStock,
          requiresLot: product.tracking.lot,
          requiresSerial: product.tracking.serial,
          requiresUnsupportedTraceability,
          isAvailableForSale:
            hasValidSaleConversion &&
            !requiresUnsupportedTraceability &&
            (!tracksStock || (availableQuantity !== null && availableQuantity > 0)),
        };
      }),
    );
    return items.sort((left, right) => left.name.localeCompare(right.name));
  }

  private async getAllApiStock(branchId: string): Promise<InventoryStockListItem[]> {
    const items: InventoryStockListItem[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.repositories.inventory.getStockPage({
        branchId,
        productTypes: ["physical", "service", "kit"],
        page,
        pageSize: 100,
        sort: "productName,asc",
      });
      items.push(...result.items);
      if (page >= result.totalPages) return items;
    }
  }
}

function getApiAvailableQuantity(
  productType: ProductType,
  stock: InventoryStockListItem | undefined,
): number | null {
  if (productType === ProductType.service) return null;
  if (stock?.productType !== productType) return 0;
  return stock.availableQuantity ?? 0;
}
