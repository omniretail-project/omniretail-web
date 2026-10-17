"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ProductSalesPriceTier, Promotion } from "@/core/entities";
import { SalesChannel } from "@/core/enums";
import { calculateEffectivePrice, resolveQuantityPrice } from "@/core/pricing";
import { useRepositories } from "@/infrastructure/providers/RepositoryProvider";
import {
  createStorefrontCartItem,
  type StorefrontCartItemDto,
} from "@/modules/storefront/application/dto/StorefrontCartDto";
import { GetStorefrontPublishedProductService } from "@/modules/storefront/application/services/GetStorefrontPublishedProductService";
import { ApiStorefrontCatalogService } from "@/modules/storefront/application/services/ApiStorefrontCatalogService";
import { isApiMode } from "@/config/api-mode";
import { usePublicTenant } from "@/modules/storefront/providers/PublicTenantProvider";

interface StorefrontCartContextValue {
  items: StorefrontCartItemDto[];
  itemCount: number;
  subtotal: number;
  /**
   * Agrega `quantity` unidades (1 por defecto). Devuelve `false` si no se agrego nada: producto no
   * disponible o, en modo api, la cantidad supera el stock vigente del backend.
   */
  addProduct: (productId: string, quantity?: number) => Promise<boolean>;
  updateQuantity: (productId: string, quantity: number) => void;
  removeProduct: (productId: string) => void;
  clearCart: () => void;
}

const StorefrontCartContext = createContext<StorefrontCartContextValue | null>(null);

type PricedStorefrontCartItem = StorefrontCartItemDto & {
  basePrice: number;
  salesPriceTiers: Array<Pick<ProductSalesPriceTier, "minQuantity" | "unitPrice" | "active">>;
  promotion?: Pick<Promotion, "id" | "type" | "value">;
};

function withQuantityPrice(item: PricedStorefrontCartItem, quantity: number): PricedStorefrontCartItem {
  const price = calculateEffectivePrice(
    resolveQuantityPrice({ basePrice: item.basePrice, quantity, tiers: item.salesPriceTiers }),
    item.promotion,
  );
  return { ...item, quantity, unitPrice: price.effectivePrice };
}

export function StorefrontCartProvider({ children }: { children: ReactNode }) {
  const repositories = useRepositories();
  const { tenantId, tenantSlug } = usePublicTenant();
  const publishedProductService = useMemo(
    () => new GetStorefrontPublishedProductService(repositories),
    [repositories],
  );
  const apiCatalogService = useMemo(() => new ApiStorefrontCatalogService(), []);
  const [allItems, setAllItems] = useState<PricedStorefrontCartItem[]>([]);
  // Lectura sincrona del carrito para decidir el resultado de addProduct antes de encolar el cambio.
  const allItemsRef = useRef(allItems);
  useEffect(() => {
    allItemsRef.current = allItems;
  }, [allItems]);
  const items = useMemo(
    () => allItems.filter((item) => item.tenantId === tenantId),
    [allItems, tenantId],
  );
  const itemCount = useMemo(() => items.reduce((total, item) => total + item.quantity, 0), [items]);
  const subtotal = useMemo(
    () => items.reduce((total, item) => total + item.unitPrice * item.quantity, 0),
    [items],
  );

  const addProduct = useCallback(
    async (productId: string, quantity = 1): Promise<boolean> => {
      if (!tenantId || !Number.isInteger(quantity) || quantity < 1) return false;
      const apiProduct = isApiMode() ? await apiCatalogService.getProduct(tenantSlug, productId) : null;
      const product = isApiMode()
        ? apiProduct && {
            id: apiProduct.id,
            tenantId,
            sku: apiProduct.sku,
            name: apiProduct.name,
            salePrice: apiProduct.salePrice,
          }
        : await publishedProductService.execute(tenantId, productId);
      if (!product) return false;
      if (isApiMode()) {
        const media =
          apiProduct?.imageSource?.kind === "url"
            ? { imageUrl: apiProduct.imageSource.src, imageAlt: apiProduct.imageAlt }
            : undefined;
        // La UI ya bloquea con el catalogo, pero este stock es el mas reciente del backend.
        const availableQuantity = apiProduct?.availableQuantity ?? null;
        const exceedsStock = (inCart: number) =>
          availableQuantity !== null && inCart + quantity > availableQuantity;
        const quantityInCart =
          allItemsRef.current.find(
            (item) => item.tenantId === tenantId && item.productId === product.id,
          )?.quantity ?? 0;
        if (exceedsStock(quantityInCart)) return false;
        setAllItems((current) => {
          const existing = current.find(
            (item) => item.tenantId === tenantId && item.productId === product.id,
          );
          // Invariante: el carrito nunca supera el stock, aun con agregados concurrentes.
          if (exceedsStock(existing?.quantity ?? 0)) return current;
          if (existing) {
            return current.map((item) =>
              item === existing
                ? withQuantityPrice({ ...item, ...media }, item.quantity + quantity)
                : item,
            );
          }
          return [...current, withQuantityPrice({
            ...createStorefrontCartItem(product, media),
            basePrice: product.salePrice,
            salesPriceTiers: [],
          }, quantity)];
        });
        return true;
      }
      const ecommerceConfig = await repositories.businessConfig.getEcommerceConfig(tenantId);
      if (!ecommerceConfig?.defaultBranchId) return false;
      const [primaryMedia, salesPriceTiers, promotion] = await Promise.all([
        repositories.productMedia.getPrimaryByProduct(product.id),
        repositories.productSalesPriceTiers.getByProduct(product.id),
        repositories.promotions.getApplicable({
          tenantId,
          productId: product.id,
          at: new Date().toISOString(),
          channel: SalesChannel.ecommerce,
          branchId: ecommerceConfig.defaultBranchId,
        }),
      ]);
      const media =
        primaryMedia?.tenantId === tenantId && primaryMedia.type === "image"
          ? { imageUrl: primaryMedia.url, imageAlt: primaryMedia.alt }
          : undefined;

      setAllItems((current) => {
        const existing = current.find(
          (item) => item.tenantId === tenantId && item.productId === product.id,
        );
        const pricingContext = {
          basePrice: product.salePrice,
          salesPriceTiers: salesPriceTiers
            .filter((tier) => tier.tenantId === tenantId && tier.productId === product.id && tier.active)
            .map(({ minQuantity, unitPrice, active }) => ({ minQuantity, unitPrice, active })),
          promotion: promotion ?? undefined,
        };
        if (!existing)
          return [
            ...current,
            withQuantityPrice(
              { ...createStorefrontCartItem(product, media), ...pricingContext },
              quantity,
            ),
          ];

        return current.map((item) =>
          item === existing
            ? withQuantityPrice({
                ...item,
                sku: product.sku,
                name: product.name,
                ...media,
                ...pricingContext,
              }, item.quantity + quantity)
            : item,
        );
      });
      return true;
    },
    [apiCatalogService, publishedProductService, repositories, tenantId, tenantSlug],
  );

  const updateQuantity = useCallback(
    (productId: string, quantity: number) => {
      if (!tenantId) return;
      if (!Number.isFinite(quantity)) return;
      const nextQuantity = Math.floor(quantity);
      setAllItems((current) =>
        nextQuantity <= 0
          ? current.filter((item) => item.tenantId !== tenantId || item.productId !== productId)
          : current.map((item) =>
              item.tenantId === tenantId && item.productId === productId
                ? withQuantityPrice(item, nextQuantity)
                : item,
            ),
      );
    },
    [tenantId],
  );

  const removeProduct = useCallback(
    (productId: string) => updateQuantity(productId, 0),
    [updateQuantity],
  );
  const clearCart = useCallback(() => {
    if (!tenantId) return;
    setAllItems((current) => current.filter((item) => item.tenantId !== tenantId));
  }, [tenantId]);

  const value = useMemo<StorefrontCartContextValue>(
    () => ({ items, itemCount, subtotal, addProduct, updateQuantity, removeProduct, clearCart }),
    [addProduct, clearCart, itemCount, items, removeProduct, subtotal, updateQuantity],
  );

  return <StorefrontCartContext.Provider value={value}>{children}</StorefrontCartContext.Provider>;
}

export function useStorefrontCart() {
  const context = useContext(StorefrontCartContext);
  if (!context) throw new Error("useStorefrontCart must be used inside StorefrontCartProvider");
  return context;
}
