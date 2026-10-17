"use client";

import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Product, Promotion } from "@/core/entities";
import {
  LocationStatus,
  ProductStatus,
  ProductType,
  PromotionStatus,
  PromotionType,
  SaasCapabilityKey,
  SalesChannel,
} from "@/core/enums";
import { calculateEffectivePrice } from "@/core/pricing";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { Input } from "@/shared/components/Input";
import { Select } from "@/shared/components/Select";
import { cn } from "@/shared/utils/cn";
import { formatCurrency } from "@/shared/utils/formatCurrency";
import { useEntitlement } from "@/shared/hooks/useEntitlement";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { processImageUpload } from "@/shared/application/services/processImageUpload";
import { CatalogImage } from "@/modules/catalog/components/CatalogImage";
import {
  isPositiveInteger,
  isPositiveNumber,
  isDecimalInputText,
  hasAtMostDecimalPlaces,
  isConversionFactorCompatibleWithBaseUnit,
  parseDecimalInput,
  parseIntegerInput,
  parseUnitQuantityInput,
  toFiniteNumber,
} from "@/shared/utils/numberInput";
import {
  MAX_KIT_COMPONENT_QUANTITY,
  CONVERSION_FACTOR_DECIMAL_PLACES,
  MAX_PERCENTAGE,
  MAX_SAFE_CONVERSION_FACTOR,
  MAX_SAFE_CURRENCY,
  MAX_SAFE_INTEGER_COUNT,
  MONEY_DECIMAL_PLACES,
  PERCENTAGE_DECIMAL_PLACES,
  QUANTITY_DECIMAL_PLACES,
  TEXT_LIMITS,
} from "@/shared/utils/inputLimits";
import type {
  ProductAttributeEditorValue,
  ProductEditorData,
  ProductEditorDto,
  ProductMediaEditorValue,
  ProductSalesPriceTierEditorValue,
  SupplierCostTierEditorValue,
  SupplierProductEditorValue,
} from "@/modules/catalog/application/dto/ProductEditorDto";
import {
  ArchiveIcon,
  CheckIcon,
  GlobeIcon,
  MobileIcon,
  PlusIcon,
  PosIcon,
  TagIcon,
} from "@/modules/catalog/components/CatalogIcons";
import { productTypeLabels } from "@/modules/catalog/components/productLabels";
import { useProductPromotions } from "@/modules/catalog/hooks/useProductPromotions";
import {
  useProductAttributes,
  type ProductAttributesLoadState,
} from "@/modules/catalog/hooks/useProductAttributes";
import {
  useProductSalesPriceTiers,
  type ProductSalesPriceTiersLoadState,
} from "@/modules/catalog/hooks/useProductSalesPriceTiers";
import {
  useSupplierCostTiers,
  type SupplierCostTierLoadState,
} from "@/modules/catalog/hooks/useSupplierCostTiers";
import {
  useProductUnitConversions,
  type ProductUnitConversionsLoadState,
} from "@/modules/catalog/hooks/useProductUnitConversions";
import {
  useProductInventorySettings,
  type ProductInventorySettingsLoadState,
} from "@/modules/catalog/hooks/useProductInventorySettings";
import {
  useProductEditorKitEligibleProducts,
  useProductEditorLocations,
  type DeferredLoadState,
} from "@/modules/catalog/hooks/useProductEditorDeferredData";
import type { ProductFormOptions } from "@/modules/catalog/types/catalog.types";
import {
  applyCapabilityRulesToEditor,
  applyTrackingRules,
  getAllowedProductTypes,
  getDefaultTracking,
  hasValidationErrors,
  resolveSaleUnitId,
  validateProductDto,
  type ProductValidationErrors,
} from "@/modules/catalog/validation/product.validation";
import { validateProductFormPilot } from "@/modules/catalog/validation/productFormPilot.schema";

interface ProductFormProps {
  mode: "create" | "edit";
  branchId: string;
  options: ProductFormOptions;
  editorData: ProductEditorData;
  busy?: boolean;
  error?: string | null;
  onSubmit: (dto: ProductEditorDto) => Promise<void>;
  onArchive?: () => void;
}

type ProductFormErrors = ProductValidationErrors & { defaultLocationId?: string };

type ProductFormTab =
  "general" | "units" | "tracking" | "attributes" | "prices" | "promotion" | "suppliers" | "media";

type PromotionProduct = Pick<
  Product,
  "id" | "tenantId" | "name" | "salePrice" | "status" | "tracking" | "channels"
>;

interface PromotionFormState {
  type: PromotionType;
  value: string;
  startDate: string;
  endDate: string;
  channels: SalesChannel[];
  untilStockEnds: boolean;
}

const promotionTypeLabels: Record<PromotionType, string> = {
  [PromotionType.percentage]: "Descuento porcentual",
  [PromotionType.fixedDiscount]: "Descuento fijo",
  [PromotionType.fixedPrice]: "Precio promocional",
};

const promotionStatusLabels: Record<PromotionStatus, string> = {
  [PromotionStatus.scheduled]: "Programada",
  [PromotionStatus.active]: "Activa",
  [PromotionStatus.ended]: "Finalizada",
  [PromotionStatus.cancelled]: "Cancelada",
};

export function ProductForm({
  mode,
  branchId,
  options,
  editorData,
  busy,
  error,
  onSubmit,
  onArchive,
}: ProductFormProps) {
  const initialValue = useMemo(() => buildInitialValue(options, editorData), [editorData, options]);
  const [value, setValue] = useState<ProductEditorDto>(initialValue);
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProductFormTab>("general");
  // Guarda sincrona contra doble submit: `busy` llega por estado del padre y no cubre dos submits
  // del mismo tick (doble Enter/click) antes de que React lo propague.
  const submittingRef = useRef(false);
  const detail = editorData.detail;
  const { user } = useCurrentSession();
  const editorTenantId = detail?.product.tenantId ?? user?.tenantId;
  const editorProductId = detail?.product.id;
  const productAttributes = useProductAttributes();
  const productSalesPriceTiers = useProductSalesPriceTiers();
  const supplierCostTiers = useSupplierCostTiers();
  const productUnitConversions = useProductUnitConversions();
  const productInventorySettings = useProductInventorySettings();
  const { hasCapability } = useEntitlement();
  const isEdit = mode === "edit";
  const kitEligibleProductsState = useProductEditorKitEligibleProducts({
    tenantId: editorTenantId,
    productId: editorProductId,
    enabled: activeTab === "tracking" && value.productType === ProductType.kit,
  });
  const locationsState = useProductEditorLocations({
    tenantId: editorTenantId,
    branchId,
    enabled:
      activeTab === "tracking" &&
      value.productType === ProductType.physical &&
      value.tracking.stock &&
      editorData.access.canReadLocations,
  });
  const deferredEditorData = useMemo<ProductEditorData>(
    () => ({
      ...editorData,
      kitEligibleProducts: kitEligibleProductsState.data ?? [],
      branchLocations: locationsState.data?.branchLocations ?? [],
      storageLocations: locationsState.data?.storageLocations ?? [],
    }),
    [editorData, kitEligibleProductsState.data, locationsState.data],
  );
  // El backend rechaza (409) atributos y precios por cantidad mientras el producto esta archivado;
  // un Kit archivado solo admite componentes y multimedia, asi que esas secciones no se editan.
  const isArchivedKit =
    isEdit &&
    detail?.product.productType === ProductType.kit &&
    detail.product.status === ProductStatus.archived;
  const attributeLoadState = productAttributes.getState(editorTenantId, editorProductId);
  const salesPriceTiersLoadState = productSalesPriceTiers.getState(editorTenantId, editorProductId);
  const unitConversionsLoadState = productUnitConversions.getState(editorTenantId, editorProductId);
  const inventorySettingsLoadState = productInventorySettings.getState(
    editorTenantId,
    editorProductId,
    branchId,
  );
  const promotionState = useProductPromotions(editorProductId ?? null, {
    enabled: activeTab === "promotion" && editorData.access.canReadPromotions,
    tenantId: editorTenantId,
  });
  const categoryName =
    options.categories.find((category) => category.id === value.categoryId)?.name ??
    "Sin categoria";
  const baseUnit = options.units.find((unit) => unit.id === value.baseUnitId);
  const saleUnit = options.units.find((unit) => unit.id === value.saleUnitId);
  // Snapshot de lo YA PERSISTIDO, solo para un producto existente. Con la capacidad apagada, es lo
  // que se conserva en vez de recortarse: ver applyCapabilityRulesToEditor/resolveSaleUnitId.
  const existingCapabilityContext = detail
    ? {
        saleUnitId: detail.product.saleUnitId ?? detail.product.baseUnitId,
        inventoryUnitId: detail.product.inventoryUnitId ?? detail.product.baseUnitId,
        tracking: detail.product.tracking,
      }
    : undefined;
  const preferredSupplier = value.supplierProducts.find((item) => item.preferred);
  const preferredSupplierName = preferredSupplier
    ? editorData.suppliers.find((supplier) => supplier.id === preferredSupplier.supplierId)?.name
    : undefined;
  const promotionProduct: PromotionProduct | null = detail
    ? {
        id: detail.product.id,
        tenantId: detail.product.tenantId,
        name: value.name || detail.product.name,
        salePrice: toFiniteNumber(value.salePrice),
        status: value.status,
        tracking: value.tracking,
        channels: value.channels,
      }
    : null;
  const showPromotionTab = Boolean(
    isEdit && editorData.access.canReadPromotions && promotionProduct,
  );
  const promotionCount =
    promotionState.status === "loaded"
      ? (promotionState.data?.promotions ?? []).filter(
          (promotion) =>
            promotion.status === PromotionStatus.active ||
            promotion.status === PromotionStatus.scheduled,
        ).length
      : undefined;
  const tabs = [
    { id: "general", label: "Informacion general", icon: "I" },
    value.productType !== ProductType.kit ? { id: "units", label: "Unidades", icon: "U" } : null,
    { id: "tracking", label: "Inventario y trazabilidad", icon: "T" },
    options.businessCapabilities.supportsProductAttributes ||
    (isEdit && editorData.access.canReadAttributes)
      ? { id: "attributes", label: "Atributos", icon: "A", count: value.attributes?.length }
      : null,
    { id: "prices", label: "Precios", icon: "Q", count: value.salesPriceTiers?.length },
    showPromotionTab
      ? { id: "promotion", label: "Promocion", icon: "%", count: promotionCount }
      : null,
    value.productType !== ProductType.kit && editorData.access.canManageSuppliers
      ? { id: "suppliers", label: "Proveedores", icon: "P", count: value.supplierProducts.length }
      : null,
    { id: "media", label: "Multimedia", icon: "M", count: value.media.length },
  ].filter((tab): tab is { id: ProductFormTab; label: string; icon: string; count?: number } =>
    Boolean(tab),
  );

  const preparationItems = [
    { label: "Nombre", complete: Boolean(value.name.trim()) },
    { label: "SKU", complete: Boolean(value.sku.trim()) },
    { label: "Categoria", complete: Boolean(value.categoryId) },
    { label: "Unidad inventario", complete: Boolean(value.baseUnitId) },
    {
      label: "Precio",
      complete: value.salePrice !== "" && toFiniteNumber(value.salePrice) >= 0,
    },
  ];
  const completedItems = preparationItems.filter((item) => item.complete).length;
  const completionPercentage = Math.round((completedItems / preparationItems.length) * 100);

  function loadSalesPriceTiers() {
    if (!editorTenantId || value.salesPriceTiers !== undefined) return;

    void productSalesPriceTiers
      .load(editorTenantId, editorProductId)
      .then((salesPriceTiers) => {
        setValue((current) =>
          current.salesPriceTiers === undefined ? { ...current, salesPriceTiers } : current,
        );
      })
      .catch(() => {
        // El hook conserva el Error real y deja la consulta reintentable.
      });
  }

  function loadAttributes() {
    if (!editorTenantId || !editorData.access.canReadAttributes || value.attributes !== undefined) {
      return;
    }
    void productAttributes
      .load(editorTenantId, editorProductId)
      .then(({ attributes }) => {
        setValue((current) =>
          current.attributes === undefined ? { ...current, attributes } : current,
        );
      })
      .catch(() => {
        // El hook conserva el Error real y deja definitions/values fallidos reintentables.
      });
  }

  function loadSupplierCostTiers(supplierProductId: string) {
    const supplierProduct = value.supplierProducts.find((item) => item.id === supplierProductId);
    if (!supplierProduct || supplierProduct.costTiers !== undefined) return;

    void supplierCostTiers
      .load(supplierProductId)
      .then((costTiers) => {
        setValue((current) => {
          let changed = false;
          const supplierProducts = current.supplierProducts.map((item) => {
            if (item.id !== supplierProductId || item.costTiers !== undefined) return item;
            changed = true;
            return { ...item, costTiers };
          });
          return changed ? { ...current, supplierProducts } : current;
        });
      })
      .catch(() => {
        // El hook conserva el Error real y deja la entrada reintentable.
      });
  }

  function loadUnitConversions() {
    if (
      !editorTenantId ||
      !editorData.access.canReadConversions ||
      value.productType === ProductType.kit ||
      value.unitConversions !== undefined ||
      // Producto nuevo sin "Unidades y empaques": usa una sola unidad y no hay conversiones que leer.
      (!isEdit && !options.businessCapabilities.supportsUnitsAndPackaging)
    ) {
      return;
    }

    void productUnitConversions
      .load(editorTenantId, editorProductId)
      .then((unitConversions) => {
        setValue((current) => {
          if (current.productType === ProductType.kit || current.unitConversions !== undefined) {
            return current;
          }
          const factorFor = (unitId: string) =>
            unitId === current.baseUnitId
              ? 1
              : (unitConversions.find(
                  (conversion) =>
                    conversion.fromUnitId === unitId && conversion.toUnitId === current.baseUnitId,
                )?.factor ?? "");
          return {
            ...current,
            unitConversions,
            inventoryToBaseFactor: factorFor(current.inventoryUnitId),
            saleToBaseFactor: factorFor(current.saleUnitId),
          };
        });
      })
      .catch(() => {
        // El hook conserva el Error real y deja la consulta reintentable.
      });
  }

  function loadInventorySettings() {
    if (
      !editorTenantId ||
      !branchId ||
      !editorData.access.canReadInventorySettings ||
      value.productType !== ProductType.physical ||
      value.inventorySettings !== undefined
    ) {
      return;
    }

    void productInventorySettings
      .load(editorTenantId, editorProductId, branchId)
      .then((inventorySettings) => {
        setValue((current) =>
          current.productType === ProductType.physical && current.inventorySettings === undefined
            ? {
                ...current,
                inventorySettings: {
                  branchId,
                  minStock: inventorySettings?.minStock ?? 0,
                  reorderPoint: inventorySettings?.reorderPoint ?? "",
                  defaultLocationId: inventorySettings?.defaultLocationId ?? "",
                },
              }
            : current,
        );
      })
      .catch(() => {
        // El hook conserva el Error real y deja la consulta reintentable.
      });
  }

  function selectTab(tab: ProductFormTab) {
    setActiveTab(tab);
    if (tab === "units") {
      loadUnitConversions();
      return;
    }
    if (tab === "tracking") {
      loadInventorySettings();
      return;
    }
    if (tab === "prices") {
      loadSalesPriceTiers();
      return;
    }
    if (tab === "attributes") {
      loadAttributes();
      return;
    }
    if (tab !== "suppliers") return;
    value.supplierProducts.forEach((item) => {
      if (item.id && item.costTiers === undefined) loadSupplierCostTiers(item.id);
    });
  }

  function updateValue(patch: Partial<ProductEditorDto>) {
    const next = { ...value, ...patch };
    if (patch.productType) {
      next.tracking =
        patch.productType === ProductType.physical
          ? getDefaultTracking(options.businessCapabilities, patch.productType)
          : applyTrackingRules(patch.productType, next.tracking, options.businessCapabilities);
      if (patch.productType === ProductType.kit) {
        const unitId = options.units.find((unit) => unit.category === "unit")?.id;
        if (unitId) {
          next.baseUnitId = unitId;
          next.inventoryUnitId = unitId;
          next.saleUnitId = unitId;
          next.inventoryToBaseFactor = 1;
          next.saleToBaseFactor = 1;
        }
        next.supplierProducts = [];
      }
    }
    if (
      patch.baseUnitId !== undefined &&
      !isEdit &&
      !options.businessCapabilities.supportsUnitsAndPackaging
    ) {
      // Producto nuevo con una sola unidad: inventario y venta siguen a la unidad minima.
      next.inventoryUnitId = next.baseUnitId;
      next.saleUnitId = next.baseUnitId;
      next.inventoryToBaseFactor = 1;
      next.saleToBaseFactor = 1;
    }
    next.saleUnitId = resolveSaleUnitId(
      next.baseUnitId,
      next.saleUnitId,
      options.businessCapabilities,
      existingCapabilityContext?.saleUnitId,
    );
    if (next.baseUnitId === next.saleUnitId) {
      next.saleToBaseFactor = 1;
    }
    if (next.baseUnitId === next.inventoryUnitId) next.inventoryToBaseFactor = 1;
    setValue(next);

    const affectedFields = Object.keys(patch) as (keyof ProductFormErrors)[];
    if (patch.productType !== undefined) {
      affectedFields.push("baseUnitId", "saleUnitId", "tracking", "defaultLocationId");
    } else if (patch.baseUnitId !== undefined) {
      affectedFields.push("saleUnitId");
    }
    if (patch.tracking !== undefined || patch.inventorySettings !== undefined) {
      affectedFields.push("defaultLocationId");
    }
    if (patch.media !== undefined) affectedFields.push("primaryImageUrl");

    setErrors((current) => {
      if (
        !affectedFields.some(
          (field) =>
            current[field] ||
            (hasSubmitted && (field === "salePrice" || field === "defaultLocationId")),
        )
      )
        return current;

      const validatedValue = applyCapabilityRulesToEditor(
        next,
        options.businessCapabilities,
        existingCapabilityContext,
      );
      const validation = validateProductFormFields(validatedValue);
      const nextErrors = { ...current };
      for (const field of affectedFields) {
        if (
          !current[field] &&
          !(hasSubmitted && (field === "salePrice" || field === "defaultLocationId"))
        )
          continue;
        if (validation[field]) nextErrors[field] = validation[field];
        else delete nextErrors[field];
      }
      return nextErrors;
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submittingRef.current) return;
    setHasSubmitted(true);
    setEditorError(null);
    const nextValue = applyCapabilityRulesToEditor(
      value,
      options.businessCapabilities,
      existingCapabilityContext,
    );
    const pilotErrors = validateProductFormPilot(nextValue);
    const nextErrors = validateProductFormFields(nextValue);
    const nextEditorError =
      pilotErrors.tracking ?? validateEditor(nextValue, deferredEditorData, options.units);
    setErrors(nextErrors);
    setEditorError(nextEditorError);
    if (hasValidationErrors(nextErrors) || nextEditorError) {
      routeToFirstError(nextErrors, nextEditorError, selectTab);
      return;
    }
    submittingRef.current = true;
    try {
      await onSubmit(nextValue);
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <form
      aria-busy={Boolean(busy)}
      className="space-y-5"
      id="catalog-product-form"
      noValidate
      onSubmit={handleSubmit}
    >
      {/* fieldset disabled bloquea inputs, selects, textareas y botones (tabs, multimedia,
          relaciones) mientras se guarda; el contenido sigue visible y sin remontar. */}
      <fieldset
        className={cn(
          "m-0 min-w-0 space-y-5 border-0 p-0 transition-opacity",
          busy && "opacity-90",
        )}
        disabled={Boolean(busy)}
      >
        <section className="rounded-md border border-[var(--color-border)] bg-white p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <nav
                aria-label="Ruta"
                className="text-sm font-semibold text-[var(--color-text-muted)]"
              >
                Catalogo &gt;{" "}
                {isEdit ? `Editar: ${detail?.product.name ?? value.name}` : "Nuevo producto"}
              </nav>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="break-words text-2xl font-bold text-[var(--color-title)]">
                  {isEdit ? "Editar producto" : "Nuevo producto"}
                </h1>
                {isEdit ? <ProductStatusPill status={value.status} /> : null}
              </div>
              <p className="max-w-2xl text-sm text-[var(--color-text-muted)]">
                Configura la informacion comercial, inventario y venta del producto.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
              {busy ? (
                // Un Link ignora `disabled`: durante el guardado se renderiza un boton inerte.
                <Button className="w-full sm:w-auto" disabled type="button" variant="secondary">
                  {"<-"} Volver
                </Button>
              ) : (
                <Button
                  className="w-full sm:w-auto"
                  href={detail ? `/catalogo/productos/${detail.product.id}` : "/catalogo/productos"}
                  variant="secondary"
                >
                  {"<-"} Volver
                </Button>
              )}
              <Button
                className="w-full sm:w-auto"
                disabled={
                  busy ||
                  // UI action gating (feature/saas-entitlement-enforcement §7/§12): SOLO Kits se
                  // gatea por capability -- Catalog/Products general nunca. El backend
                  // (ensureTenantCanUseKits en productEditorHelpers) sigue siendo la autoridad final.
                  (value.productType === ProductType.kit &&
                    !hasCapability(SaasCapabilityKey.catalogKits))
                }
                form="catalog-product-form"
                type="submit"
              >
                {busy ? (
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  />
                ) : (
                  <CheckIcon />
                )}
                {busy ? "Guardando producto..." : "Guardar producto"}
              </Button>
            </div>
          </div>
        </section>

        <nav
          aria-label="Secciones del formulario"
          className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-white p-2"
        >
          <div className="flex min-w-max gap-2">
            {tabs.map((tab) => (
              <button
                aria-current={activeTab === tab.id ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
                  activeTab === tab.id
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-title)]"
                    : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-app-background)] hover:text-[var(--color-title)]",
                )}
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                type="button"
              >
                <span className="grid h-6 w-6 place-items-center rounded-md bg-white text-xs text-[var(--color-title)]">
                  {tab.icon}
                </span>
                {tab.label}
                {typeof tab.count === "number" ? (
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs text-[var(--color-text-muted)]">
                    {tab.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </nav>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {activeTab === "general" ? (
              <GeneralTab
                capabilities={options.businessCapabilities}
                categories={options.categories}
                errors={errors}
                onChange={updateValue}
                value={value}
              />
            ) : null}
            {activeTab === "units" ? (
              <UnitsTab
                canRead={editorData.access.canReadConversions}
                capabilities={options.businessCapabilities}
                errors={errors}
                isExistingProduct={Boolean(existingCapabilityContext)}
                loadState={unitConversionsLoadState}
                onLoad={loadUnitConversions}
                onChange={updateValue}
                readOnly={
                  !editorData.access.canReadConversions || !editorData.access.canManageConversions
                }
                units={options.units}
                value={value}
              />
            ) : null}
            {activeTab === "tracking" ? (
              <TrackingTab
                capabilities={options.businessCapabilities}
                editorData={deferredEditorData}
                error={editorError}
                errors={errors}
                kitEligibleProductsState={kitEligibleProductsState}
                loadState={inventorySettingsLoadState}
                locationsState={locationsState}
                onLoad={loadInventorySettings}
                onChange={updateValue}
                units={options.units}
                value={value}
              />
            ) : null}
            {activeTab === "attributes" ? (
              <AttributesTab
                canCreateDefinitions={editorData.access.canManageAttributes}
                canRead={editorData.access.canReadAttributes}
                loadState={attributeLoadState}
                onLoad={loadAttributes}
                onChange={(attributes) => updateValue({ attributes })}
                archivedKit={isArchivedKit}
                readOnly={
                  isArchivedKit ||
                  !options.businessCapabilities.supportsProductAttributes ||
                  !editorData.access.canReadAttributes ||
                  !editorData.access.canUpdateProductRelations
                }
                value={value.attributes}
              />
            ) : null}
            {activeTab === "prices" ? (
              <PricesTab
                errors={errors}
                loadState={salesPriceTiersLoadState}
                onLoadTiers={loadSalesPriceTiers}
                onChange={updateValue}
                archivedKit={isArchivedKit}
                readOnlyTiers={isArchivedKit || !editorData.access.canUpdateProductRelations}
                value={value}
              />
            ) : null}
            {activeTab === "promotion" && promotionProduct ? (
              <PromotionTab
                canManage={editorData.access.canManagePromotions}
                product={promotionProduct}
                state={promotionState}
              />
            ) : null}
            {activeTab === "suppliers" ? (
              <SuppliersTab
                baseUnitId={value.baseUnitId}
                baseUnitName={baseUnit?.name ?? "unidad de inventario"}
                getCostTierState={supplierCostTiers.getState}
                onLoadCostTiers={loadSupplierCostTiers}
                onChange={(supplierProducts) => updateValue({ supplierProducts })}
                suppliers={editorData.suppliers}
                units={options.units}
                value={value.supplierProducts}
              />
            ) : null}
            {activeTab === "media" ? (
              <MediaTab
                errors={errors}
                onChange={(media) => updateValue({ media })}
                readOnly={!editorData.access.canUpdateProductRelations}
                value={value.media}
              />
            ) : null}
          </div>

          <aside className="min-w-0 space-y-4">
            <section className="rounded-md border border-[var(--color-border)] bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-[var(--color-title)]">Preparacion</h2>
                <span className="text-sm font-bold text-[var(--color-title)]">
                  {completedItems}/{preparationItems.length}
                </span>
              </div>
              <div
                aria-label={`${completedItems} de ${preparationItems.length} completos`}
                aria-valuemax={preparationItems.length}
                aria-valuemin={0}
                aria-valuenow={completedItems}
                className="mt-3 h-2 rounded-full bg-[var(--color-app-background)]"
                role="progressbar"
              >
                <div
                  className="h-full rounded-full bg-[var(--color-primary)]"
                  style={{ width: `${completionPercentage}%` }}
                />
              </div>
              <ul className="mt-4 space-y-2">
                {preparationItems.map((item) => (
                  <li
                    className="flex items-center justify-between gap-3 text-sm text-[var(--color-text)]"
                    key={item.label}
                  >
                    <span>{item.label}</span>
                    <span
                      className={cn(
                        "grid h-6 w-6 place-items-center rounded-full border",
                        item.complete
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-title)]"
                          : "border-[var(--color-border)] text-[var(--color-text-muted)]",
                      )}
                    >
                      {item.complete ? <CheckIcon /> : "-"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-md border border-[var(--color-border)] bg-white p-4">
              <h2 className="text-base font-bold text-[var(--color-title)]">Resumen operativo</h2>
              <dl className="mt-4 divide-y divide-[var(--color-border)]">
                <SummaryItem label="Tipo" value={productTypeLabels[value.productType]} />
                <SummaryItem label="Categoria" value={categoryName} />
                <SummaryItem
                  label="Inventario"
                  value={value.tracking.stock ? (baseUnit?.name ?? "Controlado") : "Sin control"}
                />
                <SummaryItem label="Venta" value={saleUnit?.name ?? "Sin unidad"} />
                <SummaryItem label="Proveedor preferido" value={preferredSupplierName ?? "-"} />
                <SummaryItem
                  label="Costo proveedor"
                  value={
                    preferredSupplier
                      ? formatCurrency(toFiniteNumber(preferredSupplier.lastCost))
                      : "-"
                  }
                />
                <SummaryItem
                  label="Precio de venta"
                  value={formatCurrency(toFiniteNumber(value.salePrice))}
                />
                <SummaryItem
                  label="Promocion"
                  value={
                    showPromotionTab
                      ? promotionCount === undefined
                        ? "Sin cargar"
                        : `${promotionCount} vigente`
                      : "-"
                  }
                />
              </dl>
            </section>

            {isEdit && value.status === ProductStatus.published ? (
              <section className="rounded-md border border-[var(--color-border)] bg-white p-4">
                <h2 className="text-base font-bold text-[var(--color-title)]">
                  Acciones del producto
                </h2>
                <Button className="mt-3 w-full" onClick={onArchive} type="button" variant="danger">
                  <ArchiveIcon />
                  Archivar producto
                </Button>
              </section>
            ) : null}
          </aside>
        </div>
      </fieldset>

      {editorError ? <FieldError>{editorError}</FieldError> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </form>
  );
}

function GeneralTab({
  value,
  capabilities,
  categories,
  errors,
  onChange,
}: {
  value: ProductEditorDto;
  capabilities: ProductFormOptions["businessCapabilities"];
  categories: ProductFormOptions["categories"];
  errors: ProductValidationErrors;
  onChange: (value: Partial<ProductEditorDto>) => void;
}) {
  const allowedProductTypes = getAllowedProductTypes(capabilities);
  // Un producto guardado con un tipo que despues se deshabilito conserva su opcion: sin ella la
  // pantalla lo cambiaria de tipo en silencio al primer guardado.
  const productTypes = allowedProductTypes.includes(value.productType)
    ? allowedProductTypes
    : [...allowedProductTypes, value.productType];
  const hiddenProductTypes = Object.values(ProductType).length - productTypes.length;

  return (
    <section className="space-y-5 rounded-md border border-[var(--color-border)] bg-white p-4 sm:p-5">
      <SectionTitle
        description="Datos comerciales visibles en catalogo, ventas y operaciones."
        title="Informacion general"
      />
      <div className="space-y-2">
        <p className="text-sm font-bold text-[var(--color-title)]">Tipo de producto</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {productTypes.map((type) => (
            <button
              aria-pressed={value.productType === type}
              className={cn(
                "rounded-md border px-4 py-3 text-left text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
                value.productType === type
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-title)]"
                  : "border-[var(--color-border)] bg-white text-[var(--color-text-muted)] hover:border-[var(--color-structure)] hover:text-[var(--color-title)]",
              )}
              key={type}
              onClick={() => onChange({ productType: type })}
              type="button"
            >
              {productTypeLabels[type]}
            </button>
          ))}
        </div>
        {hiddenProductTypes > 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">
            La configuracion del negocio limita los tipos de producto disponibles.
          </p>
        ) : null}
        {errors.productType ? <FieldError>{errors.productType}</FieldError> : null}
      </div>
      <FormField id="name" label="Nombre *" error={errors.name}>
        <Input
          id="name"
          maxLength={TEXT_LIMITS.productName}
          onChange={(event) => onChange({ name: event.target.value })}
          value={value.name}
        />
      </FormField>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField id="sku" label="Codigo / SKU *" error={errors.sku}>
          <Input
            id="sku"
            maxLength={TEXT_LIMITS.sku}
            onChange={(event) => onChange({ sku: event.target.value })}
            value={value.sku}
          />
        </FormField>
        <FormField id="barcode" label="Codigo de barras" error={errors.barcode}>
          <Input
            id="barcode"
            maxLength={TEXT_LIMITS.barcode}
            onChange={(event) => onChange({ barcode: event.target.value })}
            value={value.barcode ?? ""}
          />
        </FormField>
        <FormField id="brand" label="Marca" error={errors.brand}>
          <Input
            id="brand"
            maxLength={TEXT_LIMITS.brand}
            onChange={(event) => onChange({ brand: event.target.value })}
            value={value.brand ?? ""}
          />
        </FormField>
        <FormField id="categoryId" label="Categoria *" error={errors.categoryId}>
          <Select
            id="categoryId"
            onChange={(event) => onChange({ categoryId: event.target.value })}
            value={value.categoryId}
          >
            <option value="">Selecciona una categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField id="description" label="Descripcion" error={errors.description}>
        <textarea
          className="min-h-24 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
          id="description"
          maxLength={TEXT_LIMITS.description}
          onChange={(event) => onChange({ description: event.target.value })}
          value={value.description ?? ""}
        />
        <CharacterCount
          current={value.description?.length ?? 0}
          maximum={TEXT_LIMITS.description}
        />
      </FormField>
      <ChannelsControl value={value} onChange={onChange} />
    </section>
  );
}

function ChannelsControl({
  value,
  onChange,
}: {
  value: ProductEditorDto;
  onChange: (value: Partial<ProductEditorDto>) => void;
}) {
  const channels = [
    { key: "pos", label: "Punto de venta", icon: <PosIcon /> },
    { key: "ecommerce", label: "Web", icon: <GlobeIcon /> },
    { key: "mobileApp", label: "App movil", icon: <MobileIcon /> },
  ] as const;

  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-[var(--color-title)]">Canales de venta</p>
      <div className="grid gap-3 md:grid-cols-3">
        {channels.map((channel) => {
          const active = value.channels[channel.key];
          return (
            <button
              aria-pressed={active}
              className={cn(
                "flex min-h-16 items-center justify-between gap-3 rounded-md border p-3 text-left text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
                active
                  ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-title)]"
                  : "border-[var(--color-border)] bg-white text-[var(--color-text-muted)] hover:border-[var(--color-structure)] hover:text-[var(--color-title)]",
              )}
              key={channel.key}
              onClick={() => onChange({ channels: { ...value.channels, [channel.key]: !active } })}
              type="button"
            >
              <span className="flex items-center gap-2">
                {channel.icon}
                {channel.label}
              </span>
              {active ? <CheckIcon /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UnitsTab({
  value,
  canRead,
  capabilities,
  isExistingProduct,
  units,
  errors,
  loadState,
  onLoad,
  onChange,
  readOnly,
}: {
  value: ProductEditorDto;
  canRead: boolean;
  capabilities: ProductFormOptions["businessCapabilities"];
  isExistingProduct: boolean;
  units: ProductFormOptions["units"];
  errors: ProductValidationErrors;
  loadState: ProductUnitConversionsLoadState;
  onLoad: () => void;
  onChange: (value: Partial<ProductEditorDto>) => void;
  readOnly?: boolean;
}) {
  const baseUnit = units.find((item) => item.id === value.baseUnitId);
  const inventoryUnit = units.find((item) => item.id === value.inventoryUnitId);
  const saleUnit = units.find((item) => item.id === value.saleUnitId);
  // Sin "Unidades y empaques" un producto NUEVO trabaja con una sola unidad (baseUnitId libre,
  // saleUnitId siempre igual). Uno EXISTENTE protege TODA su configuracion de unidades — tambien
  // baseUnitId, no solo la unidad de venta — porque cambiar la unidad de inventario dejaria una
  // equivalencia historica (ej. "1 Caja = 12 Unidades") atada a una base distinta sin que exista
  // una migracion explicita que la redefina. Se muestra, no se oculta: ver principio general del
  // blocker, capacidad OFF no es una migracion destructiva de datos historicos.
  const usesSingleUnit = !capabilities.supportsUnitsAndPackaging;
  const unitsProtected = isExistingProduct && usesSingleUnit;
  const coreUnitsReadOnly = Boolean(readOnly && isExistingProduct);
  const conversionsLoaded = value.unitConversions !== undefined;
  // Un producto nuevo con una sola unidad no necesita conversiones: no se exige cargarlas.
  const newSingleUnit = usesSingleUnit && !isExistingProduct;
  const controlsDisabled =
    unitsProtected || coreUnitsReadOnly || (!conversionsLoaded && !newSingleUnit);
  const needsInventoryConversion = value.baseUnitId !== value.inventoryUnitId;
  const needsSaleConversion = value.baseUnitId !== value.saleUnitId;

  return (
    <section className="space-y-5 rounded-md border border-[var(--color-border)] bg-white p-4 sm:p-5">
      <SectionTitle
        description={
          unitsProtected
            ? "El negocio opera con una única unidad para productos nuevos; la configuración de unidades de este producto queda protegida mientras esta función esté desactivada."
            : usesSingleUnit
              ? "El negocio opera con una única unidad por producto."
              : "Define cómo se cuenta el producto y cómo se presenta en inventario y venta."
        }
        title="Unidades"
      />
      {unitsProtected || readOnly ? (
        <p className="rounded-md border border-[var(--color-warning)] bg-[var(--color-app-background)] px-3 py-2 text-sm font-semibold text-[var(--color-text)]">
          La configuracion de unidades y conversiones esta disponible en modo de solo lectura.
        </p>
      ) : null}
      {canRead && !conversionsLoaded && !newSingleUnit ? (
        <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--color-text-muted)]">
            {loadState.status === "error"
              ? loadState.error.message
              : loadState.status === "loading"
                ? "Cargando conversiones..."
                : "Las conversiones todavía no se han cargado."}
          </p>
          {loadState.status !== "loading" ? (
            <Button onClick={onLoad} type="button" variant="secondary">
              {loadState.status === "error" ? "Reintentar" : "Cargar conversiones"}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        <FormField
          id="baseUnitId"
          label="Unidad minima *"
          error={errors.baseUnitId}
          hint={
            unitsProtected
              ? "Protegida mientras la capacidad este desactivada."
              : "Es la unidad más pequeña con la que se controla el producto."
          }
        >
          <Select
            disabled={controlsDisabled}
            id="baseUnitId"
            onChange={(event) =>
              onChange({
                baseUnitId: event.target.value,
                ...(readOnly
                  ? {
                      inventoryUnitId: event.target.value,
                      saleUnitId: event.target.value,
                    }
                  : {}),
                inventoryToBaseFactor:
                  readOnly || event.target.value === value.inventoryUnitId ? 1 : "",
                saleToBaseFactor: readOnly || event.target.value === value.saleUnitId ? 1 : "",
              })
            }
            value={value.baseUnitId}
          >
            <option value="">Selecciona una unidad</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name} ({unit.symbol})
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="inventoryUnitId" label="Presentación de inventario *">
          <Select
            disabled={usesSingleUnit || readOnly || !conversionsLoaded}
            id="inventoryUnitId"
            onChange={(event) =>
              onChange({
                inventoryUnitId: event.target.value,
                inventoryToBaseFactor: event.target.value === value.baseUnitId ? 1 : "",
              })
            }
            value={value.inventoryUnitId}
          >
            <option value="">Selecciona una unidad</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name} ({unit.symbol})
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          id="saleUnitId"
          label="Unidad de venta *"
          error={errors.saleUnitId}
          hint={
            unitsProtected
              ? "Se conserva la configuración previa; el negocio ya no permite editarla."
              : usesSingleUnit
                ? "Sigue a la unidad de inventario porque el negocio no maneja unidades y empaques."
                : undefined
          }
        >
          <Select
            disabled={usesSingleUnit || readOnly || !conversionsLoaded}
            id="saleUnitId"
            onChange={(event) =>
              onChange({
                saleUnitId: event.target.value,
                saleToBaseFactor: event.target.value === value.baseUnitId ? 1 : "",
              })
            }
            value={value.saleUnitId}
          >
            <option value="">Selecciona una unidad</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name} ({unit.symbol})
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      {needsInventoryConversion || needsSaleConversion ? (
        <div className="grid gap-4 rounded-md border border-[var(--color-border)] p-4 md:grid-cols-2">
          {needsInventoryConversion ? (
            <FormField
              id="inventoryToBaseFactor"
              label={`1 ${inventoryUnit?.name ?? "presentación"} equivale a`}
            >
              <div className="flex items-center gap-2">
                <Input
                  disabled={unitsProtected || readOnly || !conversionsLoaded}
                  id="inventoryToBaseFactor"
                  inputMode="decimal"
                  maxLength={12}
                  type="text"
                  value={value.inventoryToBaseFactor}
                  onChange={(event) =>
                    onChange({
                      inventoryToBaseFactor: parseDecimalInput(
                        event.target.value,
                        CONVERSION_FACTOR_DECIMAL_PLACES,
                      ),
                    })
                  }
                />
                <span className="text-sm font-semibold">{baseUnit?.name ?? "base"}</span>
              </div>
            </FormField>
          ) : null}
          {needsSaleConversion ? (
            <FormField id="saleToBaseFactor" label={`1 ${saleUnit?.name ?? "venta"} equivale a`}>
              <div className="flex items-center gap-2">
                <Input
                  disabled={unitsProtected || readOnly || !conversionsLoaded}
                  id="saleToBaseFactor"
                  inputMode="decimal"
                  maxLength={12}
                  type="text"
                  value={value.saleToBaseFactor}
                  onChange={(event) =>
                    onChange({
                      saleToBaseFactor: parseDecimalInput(
                        event.target.value,
                        CONVERSION_FACTOR_DECIMAL_PLACES,
                      ),
                    })
                  }
                />
                <span className="text-sm font-semibold">{baseUnit?.name ?? "base"}</span>
              </div>
            </FormField>
          ) : null}
        </div>
      ) : (
        <p className="rounded-md bg-[var(--color-app-background)] px-3 py-2 text-sm text-[var(--color-text)]">
          {usesSingleUnit
            ? "El negocio no maneja unidades y empaques: la venta usa la unidad de inventario y no se habilitan equivalencias ni presentaciones distintas."
            : "Todas las presentaciones utilizan la unidad de medida principal, por lo que no es necesario configurar conversiones."}
        </p>
      )}
    </section>
  );
}

function TrackingTab({
  value,
  capabilities,
  editorData,
  error,
  errors,
  kitEligibleProductsState,
  loadState,
  locationsState,
  units,
  onLoad,
  onChange,
}: {
  value: ProductEditorDto;
  capabilities: ProductFormOptions["businessCapabilities"];
  editorData: ProductEditorData;
  error: string | null;
  errors: ProductFormErrors;
  kitEligibleProductsState: DeferredLoadState<Product[]> & { retry: () => Promise<void> };
  loadState: ProductInventorySettingsLoadState;
  locationsState: DeferredLoadState<{
    branchLocations: ProductEditorData["branchLocations"];
    storageLocations: ProductEditorData["storageLocations"];
  }> & { retry: () => Promise<void> };
  units: ProductFormOptions["units"];
  onLoad: () => void;
  onChange: (value: Partial<ProductEditorDto>) => void;
}) {
  const isService = value.productType === ProductType.service;
  const isKit = value.productType === ProductType.kit;
  const usesStock = !isService && !isKit && value.tracking.stock;
  const inventorySettingsReadOnly =
    !editorData.access.canReadInventorySettings || !editorData.access.canUpdateProductRelations;
  const inventorySettings = value.inventorySettings;
  const currentDefaultLocation = inventorySettings?.defaultLocationId
    ? (editorData.branchLocations.find(
        (location) => location.id === inventorySettings.defaultLocationId,
      ) ?? null)
    : null;
  const assignedUnavailableDefaultLocation =
    currentDefaultLocation &&
    currentDefaultLocation.id === inventorySettings?.defaultLocationId &&
    !editorData.storageLocations.some((location) => location.id === currentDefaultLocation.id);
  const unavailableDefaultLocationStatus =
    currentDefaultLocation?.status === LocationStatus.inactive ? "inactiva" : "archivada";
  const options = [
    {
      key: "stock",
      label: "Control de stock",
      description: "Permite registrar movimientos y consultar las existencias de este producto.",
      enabled: capabilities.supportsInventory,
    },
    {
      key: "lot",
      label: "Manejo por lote",
      description: "Identifica entradas por lote.",
      enabled: capabilities.supportsLots,
    },
    {
      key: "expiration",
      label: "Fecha de vencimiento",
      description: "Controla caducidad cuando aplique.",
      enabled: capabilities.supportsExpiration,
    },
    {
      key: "serial",
      label: "Número de serie",
      description: "Seguimiento individual por unidad.",
      enabled: capabilities.supportsSerials,
    },
  ] as const;

  function toggle(key: keyof ProductEditorDto["tracking"], checked: boolean) {
    const tracking = applyTrackingRules(
      value.productType,
      {
        ...value.tracking,
        [key]: checked,
        ...(key === "lot" || key === "expiration" ? { lot: checked, expiration: checked } : {}),
      },
      capabilities,
    );
    onChange({
      tracking,
      inventorySettings:
        !tracking.stock && inventorySettings
          ? // La asignacion de ubicacion NO se borra al apagar el control de stock: con el control
            // apagado no se envia nada, y al reactivarlo debe conservarse la ubicacion cargada.
            { ...inventorySettings, minStock: 0, reorderPoint: "" }
          : inventorySettings,
    });
  }

  // Con la configuracion visible, "Control de stock" comparte fila con la ubicacion predeterminada.
  const stockOptionInSettingsRow = Boolean(usesStock && inventorySettings);

  function renderOption(option: (typeof options)[number], fillRow = false) {
    const disabled = isService || isKit || !option.enabled;
    if (!option.enabled && !value.tracking[option.key]) return null;
    const active = value.tracking[option.key];
    return (
      <button
        aria-pressed={active}
        className={cn(
          "rounded-md border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)] disabled:cursor-not-allowed disabled:opacity-60",
          fillRow && "h-full",
          active
            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10"
            : "border-[var(--color-border)] bg-white hover:border-[var(--color-structure)]",
        )}
        disabled={disabled}
        key={option.key}
        onClick={() => toggle(option.key, !active)}
        type="button"
      >
        <span className="flex items-start justify-between gap-3">
          <span>
            <span className="block text-sm font-bold text-[var(--color-title)]">
              {option.label}
            </span>
            <span className="mt-1 block text-sm text-[var(--color-text-muted)]">
              {option.description}
            </span>
          </span>
          <span
            className={cn(
              "mt-0.5 h-5 w-9 shrink-0 rounded-full border p-0.5 transition",
              active
                ? "border-[var(--color-primary)] bg-[var(--color-primary)]"
                : "border-[var(--color-border)] bg-white",
            )}
          >
            <span
              className={cn(
                "block h-3.5 w-3.5 rounded-full bg-white transition",
                active ? "translate-x-4" : "translate-x-0 bg-[var(--color-text-muted)]",
              )}
            />
          </span>
        </span>
      </button>
    );
  }

  return (
    <section className="space-y-5 rounded-md border border-[var(--color-border)] bg-white p-4 sm:p-5">
      <SectionTitle
        description="Reglas de inventario según el tipo de producto y las funciones del negocio."
        title="Inventario y trazabilidad"
      />
      {isService ? (
        <p className="rounded-md bg-[var(--color-app-background)] px-3 py-2 text-sm text-[var(--color-text)]">
          Los servicios no utilizan control de inventario.
        </p>
      ) : null}
      {isKit ? (
        kitEligibleProductsState.status === "loaded" ? (
          <KitComponentsEditor
            eligibleProducts={kitEligibleProductsState.data}
            readOnly={!editorData.access.canUpdateProductRelations}
            units={units}
            value={value.kitComponents}
            onChange={(kitComponents) => onChange({ kitComponents })}
          />
        ) : (
          <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--color-text-muted)]">
              {kitEligibleProductsState.status === "error"
                ? kitEligibleProductsState.error
                : "Cargando productos elegibles para el kit..."}
            </p>
            {kitEligibleProductsState.status === "error" ? (
              <Button
                onClick={() => void kitEligibleProductsState.retry()}
                type="button"
                variant="secondary"
              >
                Reintentar
              </Button>
            ) : null}
          </div>
        )
      ) : null}
      {usesStock && inventorySettingsReadOnly ? (
        <p className="rounded-md border border-[var(--color-warning)] bg-[var(--color-app-background)] px-3 py-2 text-sm font-semibold text-[var(--color-text)]">
          La configuración de inventario está disponible solo para consulta.
        </p>
      ) : null}
      {usesStock && editorData.access.canReadInventorySettings && !inventorySettings ? (
        <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--color-text-muted)]">
            {loadState.status === "error"
              ? loadState.error.message
              : loadState.status === "loading"
                ? "Cargando configuración de inventario..."
                : "La configuración de inventario todavía no se ha cargado."}
          </p>
          {loadState.status !== "loading" ? (
            <Button onClick={onLoad} type="button" variant="secondary">
              {loadState.status === "error" ? "Reintentar" : "Cargar configuración"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {usesStock && inventorySettings ? (
        <>
          {loadState.status === "loaded" && loadState.settings === null ? (
            <p className="rounded-md bg-[var(--color-app-background)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
              La configuración de inventario para esta sucursal se creará automáticamente al guardar
              el producto.
            </p>
          ) : null}
          {editorData.access.canReadLocations && locationsState.status !== "loaded" ? (
            <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[var(--color-text-muted)]">
                {locationsState.status === "error"
                  ? locationsState.error
                  : "Cargando ubicaciones de la sucursal..."}
              </p>
              {locationsState.status === "error" ? (
                <Button
                  onClick={() => void locationsState.retry()}
                  type="button"
                  variant="secondary"
                >
                  Reintentar
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <FormField id="inventory-min-stock" label="Stock mínimo">
              <Input
                disabled={inventorySettingsReadOnly}
                id="inventory-min-stock"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) =>
                  onChange({
                    inventorySettings: {
                      ...inventorySettings,
                      minStock: parseIntegerInput(event.target.value),
                    },
                  })
                }
                type="text"
                value={inventorySettings.minStock}
              />
              {error?.includes("stock minimo") ? (
                <p className="mt-2 text-sm font-semibold text-[var(--color-danger)]">{error}</p>
              ) : (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  Define la cantidad mínima que deseas mantener en esta sucursal. No representa las
                  existencias actuales.
                </p>
              )}
            </FormField>
            <FormField id="inventory-reorder-point" label="Punto de reorden">
              <Input
                disabled={inventorySettingsReadOnly}
                id="inventory-reorder-point"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) =>
                  onChange({
                    inventorySettings: {
                      ...inventorySettings,
                      reorderPoint: parseIntegerInput(event.target.value),
                    },
                  })
                }
                type="text"
                value={inventorySettings.reorderPoint ?? ""}
              />
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Cuando las existencias disponibles lleguen a esta cantidad, el sistema podrá sugerir
                reabastecimiento.
              </p>
            </FormField>
            <FormField
              id="default-location-id"
              label="Ubicación predeterminada"
              error={errors.defaultLocationId}
            >
              <Select
                disabled={
                  inventorySettingsReadOnly ||
                  !editorData.access.canReadLocations ||
                  locationsState.status !== "loaded"
                }
                id="default-location-id"
                onChange={(event) =>
                  onChange({
                    inventorySettings: {
                      ...inventorySettings,
                      defaultLocationId: event.target.value,
                    },
                  })
                }
                value={inventorySettings.defaultLocationId}
              >
                <option value="">Sin ubicación predeterminada</option>
                {assignedUnavailableDefaultLocation ? (
                  <option disabled value={currentDefaultLocation.id}>
                    {currentDefaultLocation.name} ({unavailableDefaultLocationStatus})
                  </option>
                ) : null}
                {editorData.storageLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
              {error?.includes("ubicacion") ? (
                <p className="mt-2 text-sm font-semibold text-[var(--color-danger)]">{error}</p>
              ) : assignedUnavailableDefaultLocation ? (
                <p className="mt-2 text-xs font-semibold text-[var(--color-danger)]">
                  La ubicacion asignada actualmente esta {unavailableDefaultLocationStatus}. Elige
                  una activa o deja el campo sin ubicacion.
                </p>
              ) : (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  Solo se muestran ubicaciones activas de la sucursal actual.
                </p>
              )}
            </FormField>
            {renderOption(options[0], true)}
          </div>
        </>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {options
          .filter((option) => !(stockOptionInSettingsRow && option.key === "stock"))
          .map((option) => renderOption(option))}
      </div>
    </section>
  );
}

function KitComponentsEditor({
  eligibleProducts,
  readOnly,
  units,
  value,
  onChange,
}: {
  eligibleProducts: ProductEditorData["kitEligibleProducts"];
  readOnly?: boolean;
  units: ProductFormOptions["units"];
  value: ProductEditorDto["kitComponents"];
  onChange: (value: ProductEditorDto["kitComponents"]) => void;
}) {
  const available = eligibleProducts.filter(
    (product) => !value.some((component) => component.componentProductId === product.id),
  );
  return (
    <div className="space-y-3 rounded-md bg-[var(--color-app-background)] p-3">
      <p className="text-sm text-[var(--color-text)]">
        El inventario de este kit se calcula a partir de sus componentes. El kit no tiene stock ni
        trazabilidad propios.
      </p>
      {value.map((component, index) => {
        const product = eligibleProducts.find((item) => item.id === component.componentProductId);
        const unit = units.find((item) => item.id === product?.baseUnitId);
        return (
          <div
            className="grid gap-2 sm:grid-cols-[1fr_110px_auto]"
            key={component.componentProductId}
          >
            <div className="rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-title)]">
              {product ? `${product.sku} — ${product.name}` : "Componente no disponible"}
            </div>
            <Input
              disabled={readOnly}
              inputMode={unit?.allowsDecimals ? "decimal" : "numeric"}
              maxLength={7}
              type="text"
              value={component.quantityPerKit}
              onChange={(event) =>
                onChange(
                  value.map((item, itemIndex) =>
                    itemIndex === index
                      ? {
                          ...item,
                          quantityPerKit: parseUnitQuantityInput(
                            event.target.value,
                            unit?.allowsDecimals ?? false,
                          ),
                        }
                      : item,
                  ),
                )
              }
            />
            <button
              className="rounded-md border border-[var(--color-danger)] px-3 text-sm font-semibold text-[var(--color-danger)]"
              type="button"
              disabled={readOnly}
              onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
            >
              Eliminar
            </button>
          </div>
        );
      })}
      <Select
        disabled={readOnly}
        value=""
        onChange={(event) => {
          const componentProductId = event.target.value;
          if (componentProductId) onChange([...value, { componentProductId, quantityPerKit: 1 }]);
        }}
      >
        <option value="">Agregar componente físico…</option>
        {available.map((product) => (
          <option key={product.id} value={product.id}>
            {product.sku} — {product.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

function AttributesTab({
  value,
  archivedKit,
  readOnly,
  canRead,
  canCreateDefinitions,
  loadState,
  onLoad,
  onChange,
}: {
  value?: ProductAttributeEditorValue[];
  archivedKit?: boolean;
  readOnly?: boolean;
  canRead: boolean;
  canCreateDefinitions: boolean;
  loadState: ProductAttributesLoadState;
  onLoad: () => void;
  onChange: (value: ProductAttributeEditorValue[]) => void;
}) {
  function update(index: number, patch: Partial<ProductAttributeEditorValue>) {
    if (!value) return;
    onChange(value.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  return (
    <section className="space-y-5 rounded-md border border-[var(--color-border)] bg-white p-4 sm:p-5">
      <SectionTitle
        description={
          archivedKit
            ? "Un kit archivado no admite cambios de atributos. Restáuralo para editarlos."
            : readOnly
              ? "Los atributos existentes se conservan solo para consulta por la configuración del negocio o tus permisos."
              : "Agrega características del producto, como color, material, tamaño o presentación."
        }
        title="Atributos"
      />
      {!canRead ? (
        <p className="rounded-md border border-[var(--color-warning)] bg-[var(--color-app-background)] px-3 py-2 text-sm font-semibold text-[var(--color-text)]">
          No dispone de permiso para consultar los atributos del producto.
        </p>
      ) : value === undefined ? (
        <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[var(--color-text-muted)]">
            {loadState.status === "error"
              ? loadState.error.message
              : loadState.status === "loading"
                ? "Cargando atributos..."
                : "Los atributos todavía no se han cargado."}
          </p>
          {loadState.status !== "loading" ? (
            <Button onClick={onLoad} type="button" variant="secondary">
              {loadState.status === "error" ? "Reintentar" : "Cargar atributos"}
            </Button>
          ) : null}
        </div>
      ) : readOnly ? (
        <p className="rounded-md border border-[var(--color-warning)] bg-[var(--color-app-background)] px-3 py-2 text-sm font-semibold text-[var(--color-text)]">
          Estos atributos no se borran ni se modifican al guardar otros campos del producto.
        </p>
      ) : canCreateDefinitions ? (
        <div className="flex justify-end">
          <Button
            onClick={() => onChange([...value, { name: "", value: "" }])}
            type="button"
            variant="secondary"
          >
            <PlusIcon />
            Agregar
          </Button>
        </div>
      ) : (
        <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-2 text-sm font-semibold text-[var(--color-text)]">
          Puede editar valores existentes. Crear definiciones nuevas requiere el permiso de gestion
          de atributos.
        </p>
      )}
      {value === undefined || !canRead ? null : value.length ? (
        <div className="space-y-3">
          {value.map((attribute, index) => (
            <div
              className="grid gap-3 rounded-md border border-[var(--color-border)] p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
              key={index}
            >
              <Input
                aria-label="Nombre del atributo"
                disabled={
                  readOnly || Boolean(attribute.attributeDefinitionId) || !canCreateDefinitions
                }
                maxLength={TEXT_LIMITS.attributeName}
                onChange={(event) => update(index, { name: event.target.value })}
                placeholder="Nombre"
                value={attribute.name}
              />
              <Input
                aria-label="Valor del atributo"
                disabled={readOnly}
                maxLength={TEXT_LIMITS.attributeValue}
                onChange={(event) => update(index, { value: event.target.value })}
                placeholder="Valor"
                value={attribute.value}
              />
              {readOnly ? null : (
                <Button
                  onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
                  type="button"
                  variant="danger"
                >
                  Eliminar
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState text="No hay atributos configurados en este producto." />
      )}
    </section>
  );
}

function PricesTab({
  value,
  archivedKit,
  errors,
  loadState,
  onLoadTiers,
  onChange,
  readOnlyTiers,
}: {
  value: ProductEditorDto;
  archivedKit?: boolean;
  errors: ProductValidationErrors;
  loadState: ProductSalesPriceTiersLoadState;
  onLoadTiers: () => void;
  onChange: (value: Partial<ProductEditorDto>) => void;
  readOnlyTiers?: boolean;
}) {
  const salesPriceTiers = value.salesPriceTiers;

  function updateTier(index: number, patch: Partial<ProductSalesPriceTierEditorValue>) {
    if (!salesPriceTiers) return;
    onChange({
      salesPriceTiers: salesPriceTiers.map((tier, itemIndex) =>
        itemIndex === index ? { ...tier, ...patch } : tier,
      ),
    });
  }

  function removeTier(index: number) {
    if (!salesPriceTiers) return;
    onChange({
      salesPriceTiers: salesPriceTiers.filter((_, itemIndex) => itemIndex !== index),
    });
  }

  const sortedTiers = salesPriceTiers
    ? salesPriceTiers
        .map((tier, index) => ({ tier, index }))
        .sort(
          (left, right) =>
            toFiniteNumber(left.tier.minQuantity) - toFiniteNumber(right.tier.minQuantity),
        )
    : undefined;

  return (
    <section className="space-y-5 rounded-md border border-[var(--color-border)] bg-white p-4 sm:p-5">
      <SectionTitle description="Precio base y precios mayoristas por cantidad." title="Precios" />
      <div className="grid gap-3 rounded-md bg-[var(--color-app-background)] p-4 md:grid-cols-4">
        <Metric label="Costo referencia" value="-" />
        <Metric label="Precio de venta" value={formatCurrency(toFiniteNumber(value.salePrice))} />
        <Metric label="Margen Q" value="-" />
        <Metric label="Margen %" value="-" />
      </div>
      <FormField id="salePrice" label="Precio normal *" error={errors.salePrice}>
        <Input
          id="salePrice"
          inputMode="decimal"
          maxLength={11}
          onChange={(event) =>
            onChange({
              salePrice: parseDecimalInput(event.target.value, MONEY_DECIMAL_PLACES),
            })
          }
          type="text"
          value={value.salePrice}
        />
      </FormField>
      <div className="space-y-3 rounded-md border border-[var(--color-border)] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-bold text-[var(--color-title)]">Precios por cantidad</h3>
            <p className="text-sm text-[var(--color-text-muted)]">
              {archivedKit
                ? "Un kit archivado no admite cambios de precios por cantidad. Restauralo para editarlos."
                : "Precio unitario desde una cantidad minima."}
            </p>
          </div>
          <Button
            disabled={readOnlyTiers || salesPriceTiers === undefined}
            onClick={() =>
              onChange({
                salesPriceTiers: [
                  ...(salesPriceTiers ?? []),
                  { minQuantity: 2, unitPrice: toFiniteNumber(value.salePrice), active: true },
                ],
              })
            }
            type="button"
            variant="secondary"
          >
            <PlusIcon />
            Agregar tramo
          </Button>
        </div>
        {sortedTiers === undefined ? (
          <div className="flex flex-col gap-3 rounded-md bg-[var(--color-app-background)] p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--color-text-muted)]">
              {loadState.status === "error"
                ? loadState.error.message
                : loadState.status === "loading"
                  ? "Cargando precios por cantidad..."
                  : "Los precios por cantidad todavia no se han cargado."}
            </p>
            {loadState.status !== "loading" ? (
              <Button onClick={onLoadTiers} type="button" variant="secondary">
                {loadState.status === "error" ? "Reintentar" : "Cargar precios"}
              </Button>
            ) : null}
          </div>
        ) : sortedTiers.length ? (
          <div className="space-y-2">
            {sortedTiers.map(({ tier, index }) => {
              return (
                <div
                  className="grid gap-3 rounded-md bg-[var(--color-app-background)] p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                  key={`${tier.id ?? "new"}-${index}`}
                >
                  <Input
                    aria-label="Cantidad minima"
                    disabled={readOnlyTiers}
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) =>
                      updateTier(index, { minQuantity: parseIntegerInput(event.target.value) })
                    }
                    type="text"
                    value={tier.minQuantity}
                  />
                  <Input
                    aria-label="Precio unitario"
                    disabled={readOnlyTiers}
                    inputMode="decimal"
                    maxLength={11}
                    onChange={(event) =>
                      updateTier(index, {
                        unitPrice: parseDecimalInput(event.target.value, MONEY_DECIMAL_PLACES),
                      })
                    }
                    type="text"
                    value={tier.unitPrice}
                  />
                  <Button
                    disabled={readOnlyTiers}
                    onClick={() => removeTier(index)}
                    type="button"
                    variant="danger"
                  >
                    Eliminar
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState text="No hay precios mayoristas configurados." />
        )}
      </div>
    </section>
  );
}

type ProductPromotionsState = ReturnType<typeof useProductPromotions>;

function PromotionTab({
  product,
  canManage,
  state,
}: {
  product: PromotionProduct;
  canManage: boolean;
  state: ProductPromotionsState;
}) {
  return <ProductPromotionWorkspace canManage={canManage} product={product} state={state} />;
}

function ProductPromotionWorkspace({
  product,
  canManage,
  state,
}: {
  product: PromotionProduct;
  canManage: boolean;
  state: ProductPromotionsState;
}) {
  const { data, error, finalize, loading, reload, save } = state;
  const [mode, setMode] = useState<"view" | "form">("view");
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const promotions = (data?.promotions ?? []).filter(
    (promotion) =>
      promotion.status === PromotionStatus.active || promotion.status === PromotionStatus.scheduled,
  );
  const readOnly = product.status === ProductStatus.archived || !canManage;
  const showForm = !readOnly && mode === "form";

  async function handleSave(state: PromotionFormState) {
    const validationError = validatePromotionForm(state, product.salePrice);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      await save({
        promotionId: editingPromotion?.id,
        productId: product.id,
        tenantId: product.tenantId,
        productName: product.name,
        type: state.type,
        value: Number(state.value),
        startAt: toIsoStart(state.startDate),
        endAt: state.endDate ? toIsoEnd(state.endDate) : undefined,
        channels: state.channels,
        untilStockEnds: state.untilStockEnds && product.tracking.stock,
      });
      setMode("view");
      setEditingPromotion(null);
    } catch (caughtError) {
      setFormError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFinalize(promotion: Promotion) {
    setBusy(true);
    setFormError(null);
    try {
      await finalize(promotion.id);
    } catch (caughtError) {
      setFormError(caughtError instanceof Error ? caughtError.message : "No se pudo finalizar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5 rounded-md border border-[var(--color-border)] bg-white p-4 sm:p-5">
      <SectionTitle
        description="Promociones activas o programadas existentes para este producto."
        title="Promocion"
      />
      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Cargando promociones...</p>
      ) : error ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <FieldError>{error}</FieldError>
          <Button onClick={() => void reload()} type="button" variant="secondary">
            Reintentar
          </Button>
        </div>
      ) : showForm ? (
        <PromotionEditor
          busy={busy}
          error={formError}
          initialPromotion={editingPromotion}
          onCancel={() => {
            setMode("view");
            setEditingPromotion(null);
            setFormError(null);
          }}
          onSubmit={handleSave}
          product={product}
        />
      ) : (
        <PromotionOverview
          busy={busy}
          error={formError}
          onCreate={() => {
            setEditingPromotion(null);
            setFormError(null);
            setMode("form");
          }}
          onEdit={(promotion) => {
            setEditingPromotion(promotion);
            setFormError(null);
            setMode("form");
          }}
          onFinalize={handleFinalize}
          product={product}
          promotions={promotions}
          readOnly={readOnly}
        />
      )}
    </section>
  );
}

function PromotionOverview({
  busy,
  error,
  product,
  promotions,
  onCreate,
  onEdit,
  onFinalize,
  readOnly,
}: {
  busy: boolean;
  error: string | null;
  product: PromotionProduct;
  promotions: Promotion[];
  onCreate: () => void;
  onEdit: (promotion: Promotion) => void;
  onFinalize: (promotion: Promotion) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-4">
      {error ? <FieldError>{error}</FieldError> : null}
      {readOnly ? (
        <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] p-3 text-sm font-semibold text-[var(--color-text)]">
          La promocion esta disponible en modo de solo lectura. Para gestionarla se requiere un
          producto activo y el permiso de promociones.
        </p>
      ) : (
        <div className="flex justify-end">
          <Button onClick={onCreate} type="button" variant="secondary">
            <PlusIcon />
            Nueva promocion
          </Button>
        </div>
      )}
      <div className="space-y-3">
        {promotions.map((promotion) => {
          const price = calculateEffectivePrice(product.salePrice, promotion);
          return (
            <article
              className="rounded-md border border-[var(--color-border)] bg-white p-4"
              key={promotion.id}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="font-bold text-[var(--color-title)]">{promotion.name}</h3>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    {promotionTypeLabels[promotion.type]} - {formatPromotionValue(promotion)}
                  </p>
                </div>
                <StatusPill status={promotion.status} />
              </div>
              <div className="mt-4 grid gap-3 rounded-md bg-[var(--color-app-background)] p-3 md:grid-cols-3">
                <Metric label="Precio regular" value={formatCurrency(price.basePrice)} />
                <Metric label="Precio promocional" value={formatCurrency(price.effectivePrice)} />
                <Metric label="Descuento" value={formatCurrency(price.discountAmount)} />
              </div>
              <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                <Detail label="Inicio" value={formatDate(promotion.startAt)} />
                <Detail
                  label="Fin"
                  value={promotion.endAt ? formatDate(promotion.endAt) : "Sin fecha final"}
                />
                <Detail
                  label="Canales"
                  value={<PromotionChannels channels={promotion.channels} />}
                />
                <Detail
                  label="Inventario"
                  value={
                    promotion.untilStockEnds ? "Hasta agotar existencias" : "Sin limite de stock"
                  }
                />
              </dl>
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                {readOnly ? null : (
                  <Button
                    className="min-h-10 px-3 py-2"
                    onClick={() => onEdit(promotion)}
                    type="button"
                    variant="secondary"
                  >
                    Editar
                  </Button>
                )}
                {readOnly ? null : (
                  <Button
                    className="min-h-10 px-3 py-2"
                    disabled={busy}
                    onClick={() => onFinalize(promotion)}
                    type="button"
                    variant="danger"
                  >
                    Finalizar
                  </Button>
                )}
              </div>
            </article>
          );
        })}
        {promotions.length === 0 ? <EmptyState text="No hay promociones activas." /> : null}
      </div>
    </div>
  );
}

function PromotionEditor({
  busy,
  error,
  initialPromotion,
  product,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  initialPromotion: Promotion | null;
  product: PromotionProduct;
  onCancel: () => void;
  onSubmit: (state: PromotionFormState) => void;
}) {
  const [state, setState] = useState<PromotionFormState>(() =>
    initialPromotion ? formFromPromotion(initialPromotion) : defaultPromotionForm(product),
  );
  const [nowTimestamp] = useState(Date.now);
  const preview = useMemo(
    () =>
      calculateEffectivePrice(
        product.salePrice,
        Number(state.value) > 0
          ? { id: initialPromotion?.id ?? "preview", type: state.type, value: Number(state.value) }
          : null,
      ),
    [initialPromotion?.id, product.salePrice, state.type, state.value],
  );

  function update(patch: Partial<PromotionFormState>) {
    setState((current) => ({ ...current, ...patch }));
  }

  function toggleChannel(channel: SalesChannel) {
    update({
      channels: state.channels.includes(channel)
        ? state.channels.filter((item) => item !== channel)
        : [...state.channels, channel],
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-md bg-[var(--color-app-background)] p-3 md:grid-cols-3">
        <Metric label="Precio regular" value={formatCurrency(preview.basePrice)} />
        <Metric label="Precio promocional" value={formatCurrency(preview.effectivePrice)} />
        <Metric
          label="Estado"
          value={
            new Date(toIsoStart(state.startDate)).getTime() > nowTimestamp ? "Programada" : "Activa"
          }
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <NativeField label="Tipo">
          <select
            className={inputClassName}
            onChange={(event) => update({ type: event.target.value as PromotionType })}
            value={state.type}
          >
            <option value={PromotionType.percentage}>Descuento porcentual</option>
            <option value={PromotionType.fixedDiscount}>Descuento fijo</option>
            <option value={PromotionType.fixedPrice}>Precio promocional</option>
          </select>
        </NativeField>
        <NativeField label="Valor">
          <input
            className={inputClassName}
            inputMode="decimal"
            maxLength={11}
            onChange={(event) => {
              if (isDecimalInputText(event.target.value)) update({ value: event.target.value });
            }}
            type="text"
            value={state.value}
          />
        </NativeField>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <NativeField label="Inicio">
          <input
            className={inputClassName}
            onChange={(event) => update({ startDate: event.target.value })}
            type="date"
            value={state.startDate}
          />
        </NativeField>
        <NativeField label="Fin">
          <input
            className={inputClassName}
            onChange={(event) => update({ endDate: event.target.value })}
            type="date"
            value={state.endDate}
          />
        </NativeField>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold text-[var(--color-text)]">Canales</p>
        <div className="flex flex-wrap gap-2">
          <ChannelButton
            active={state.channels.includes(SalesChannel.pos)}
            onClick={() => toggleChannel(SalesChannel.pos)}
          >
            <PosIcon />
            POS
          </ChannelButton>
          <ChannelButton
            active={state.channels.includes(SalesChannel.ecommerce)}
            onClick={() => toggleChannel(SalesChannel.ecommerce)}
          >
            <GlobeIcon />
            Web
          </ChannelButton>
          <ChannelButton
            active={state.channels.includes(SalesChannel.mobileApp)}
            onClick={() => toggleChannel(SalesChannel.mobileApp)}
          >
            <MobileIcon />
            App
          </ChannelButton>
        </div>
      </div>
      <label className="flex items-center gap-3 rounded-md border border-[var(--color-border)] p-3 text-sm font-semibold text-[var(--color-text)]">
        <input
          checked={state.untilStockEnds}
          className="h-4 w-4 accent-[var(--color-structure)]"
          disabled={!product.tracking.stock}
          onChange={(event) => update({ untilStockEnds: event.target.checked })}
          type="checkbox"
        />
        Hasta agotar existencias
      </label>
      {error ? <FieldError>{error}</FieldError> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button className="w-full sm:w-auto" onClick={onCancel} type="button" variant="secondary">
          Cancelar
        </Button>
        <Button
          className="w-full sm:w-auto"
          disabled={busy}
          onClick={() => onSubmit(state)}
          type="button"
        >
          <TagIcon />
          {busy ? "Guardando..." : "Guardar promocion"}
        </Button>
      </div>
    </div>
  );
}

function SuppliersTab({
  baseUnitId,
  baseUnitName,
  getCostTierState,
  onLoadCostTiers,
  value,
  suppliers,
  units,
  onChange,
}: {
  baseUnitId: string;
  baseUnitName: string;
  getCostTierState: (supplierProductId: string) => SupplierCostTierLoadState;
  onLoadCostTiers: (supplierProductId: string) => void;
  value: SupplierProductEditorValue[];
  suppliers: ProductEditorData["suppliers"];
  units: ProductFormOptions["units"];
  onChange: (value: SupplierProductEditorValue[]) => void;
}) {
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const availableSuppliers = suppliers.filter(
    (supplier) => !value.some((item) => item.supplierId === supplier.id),
  );
  const defaultUnitId = baseUnitId || units[0]?.id || "";

  function updateSupplier(index: number, patch: Partial<SupplierProductEditorValue>) {
    let next = value.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
    if (patch.preferred) {
      next = next.map((item, itemIndex) => ({ ...item, preferred: itemIndex === index }));
    }
    onChange(next);
  }

  function updateCostTier(
    supplierIndex: number,
    tierIndex: number,
    patch: Partial<SupplierCostTierEditorValue>,
  ) {
    const costTiers = value[supplierIndex].costTiers;
    if (!costTiers) return;
    updateSupplier(supplierIndex, {
      costTiers: costTiers.map((tier, itemIndex) =>
        itemIndex === tierIndex ? { ...tier, ...patch } : tier,
      ),
    });
  }

  return (
    <section className="space-y-5 rounded-md border border-[var(--color-border)] bg-white p-4 sm:p-5">
      <SectionTitle
        description="Asociaciones producto-proveedor y condiciones reales de compra."
        title="Proveedores"
      />
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <Select
          onChange={(event) => setSelectedSupplierId(event.target.value)}
          value={selectedSupplierId}
        >
          <option value="">Proveedor registrado</option>
          {availableSuppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </Select>
        <Button
          disabled={!selectedSupplierId}
          onClick={() => {
            if (!selectedSupplierId) return;
            onChange([
              ...value,
              {
                supplierId: selectedSupplierId,
                supplierSku: "",
                purchaseUnitId: defaultUnitId,
                purchaseToBaseFactor: 1,
                lastCost: 0,
                minimumOrderQuantity: 1,
                leadTimeDays: 0,
                preferred: value.length === 0,
                active: true,
                costTiers: [],
              },
            ]);
            setSelectedSupplierId("");
          }}
          type="button"
          variant="secondary"
        >
          <PlusIcon />
          Asociar proveedor
        </Button>
      </div>
      {value.length ? (
        <div className="space-y-3">
          {value.map((item, index) => {
            const supplier = suppliers.find((supplierItem) => supplierItem.id === item.supplierId);
            const purchaseUnit = units.find((unit) => unit.id === item.purchaseUnitId);
            const needsPurchaseConversion = item.purchaseUnitId !== baseUnitId;
            const supplierProductId = item.id;
            const costTiers = item.costTiers;
            const costTierState: SupplierCostTierLoadState = supplierProductId
              ? getCostTierState(supplierProductId)
              : { status: "loaded", tiers: costTiers ?? [] };
            return (
              <article
                className="space-y-4 rounded-md border border-[var(--color-border)] p-4"
                key={`${item.id ?? "new"}-${item.supplierId}`}
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="font-bold text-[var(--color-title)]">
                      {supplier?.name ?? "Proveedor"}
                    </h3>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {needsPurchaseConversion
                        ? `1 ${purchaseUnit?.name ?? "unidad de compra"} = ${item.purchaseToBaseFactor || "-"} ${baseUnitName}`
                        : "La compra usa la unidad de inventario."}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap md:justify-end">
                    <Button
                      className="w-full sm:w-auto"
                      onClick={() => updateSupplier(index, { preferred: true })}
                      type="button"
                      variant={item.preferred ? "primary" : "secondary"}
                    >
                      {item.preferred ? "Preferido" : "Marcar preferido"}
                    </Button>
                    <Button
                      className="w-full sm:w-auto"
                      onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
                      type="button"
                      variant="danger"
                    >
                      Eliminar
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <NativeField label="Codigo proveedor">
                    <input
                      className={inputClassName}
                      maxLength={TEXT_LIMITS.supplierCode}
                      onChange={(event) =>
                        updateSupplier(index, { supplierSku: event.target.value })
                      }
                      value={item.supplierSku ?? ""}
                    />
                  </NativeField>
                  <NativeField label="Presentacion/unidad de compra">
                    <select
                      className={inputClassName}
                      onChange={(event) =>
                        updateSupplier(index, {
                          purchaseUnitId: event.target.value,
                          purchaseToBaseFactor: event.target.value === baseUnitId ? 1 : "",
                        })
                      }
                      value={item.purchaseUnitId}
                    >
                      {units.map((unit) => (
                        <option key={unit.id} value={unit.id}>
                          {unit.name} ({unit.symbol})
                        </option>
                      ))}
                    </select>
                  </NativeField>
                  {needsPurchaseConversion ? (
                    <NativeField label="Contenido en inventario">
                      <input
                        className={inputClassName}
                        inputMode="decimal"
                        maxLength={12}
                        onChange={(event) =>
                          updateSupplier(index, {
                            purchaseToBaseFactor: parseDecimalInput(
                              event.target.value,
                              CONVERSION_FACTOR_DECIMAL_PLACES,
                            ),
                          })
                        }
                        placeholder="Cantidad"
                        type="text"
                        value={item.purchaseToBaseFactor}
                      />
                    </NativeField>
                  ) : (
                    <div className="rounded-md bg-[var(--color-app-background)] px-3 py-2 text-sm font-semibold text-[var(--color-title)]">
                      Factor implicito 1
                    </div>
                  )}
                  <NativeField label="Costo">
                    <input
                      className={inputClassName}
                      inputMode="decimal"
                      maxLength={11}
                      onChange={(event) =>
                        updateSupplier(index, {
                          lastCost: parseDecimalInput(event.target.value, MONEY_DECIMAL_PLACES),
                        })
                      }
                      type="text"
                      value={item.lastCost}
                    />
                  </NativeField>
                  <NativeField label="Pedido minimo">
                    <input
                      className={inputClassName}
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(event) =>
                        updateSupplier(index, {
                          minimumOrderQuantity: parseIntegerInput(event.target.value),
                        })
                      }
                      type="text"
                      value={item.minimumOrderQuantity}
                    />
                  </NativeField>
                  <NativeField label="Plazo de entrega (días)">
                    <input
                      className={inputClassName}
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(event) =>
                        updateSupplier(index, {
                          leadTimeDays: parseIntegerInput(event.target.value),
                        })
                      }
                      type="text"
                      value={item.leadTimeDays}
                    />
                  </NativeField>
                </div>
                <div className="space-y-3 rounded-md bg-[var(--color-app-background)] p-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <h4 className="text-sm font-bold text-[var(--color-title)]">
                      Costos por volumen
                    </h4>
                    <Button
                      className="min-h-10 px-3 py-2"
                      disabled={costTiers === undefined}
                      onClick={() =>
                        updateSupplier(index, {
                          costTiers: [
                            ...(costTiers ?? []),
                            { minQuantity: 1, unitCost: item.lastCost },
                          ],
                        })
                      }
                      type="button"
                      variant="secondary"
                    >
                      <PlusIcon />
                      Agregar costo
                    </Button>
                  </div>
                  {costTiers === undefined ? (
                    <div className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-[var(--color-text-muted)]">
                        {costTierState.status === "error"
                          ? costTierState.error.message
                          : costTierState.status === "loading"
                            ? "Cargando costos por volumen..."
                            : "Los costos por volumen todavia no se han cargado."}
                      </p>
                      {supplierProductId && costTierState.status !== "loading" ? (
                        <Button
                          className="min-h-9 px-3 py-1.5"
                          onClick={() => onLoadCostTiers(supplierProductId)}
                          type="button"
                          variant="secondary"
                        >
                          {costTierState.status === "error" ? "Reintentar" : "Cargar costos"}
                        </Button>
                      ) : null}
                    </div>
                  ) : costTiers.length ? (
                    <div className="space-y-2">
                      {costTiers.map((tier, tierIndex) => (
                        <div
                          className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                          key={`${tier.id ?? "new"}-${tierIndex}`}
                        >
                          <input
                            aria-label="Cantidad minima proveedor"
                            className={inputClassName}
                            inputMode="numeric"
                            maxLength={6}
                            onChange={(event) =>
                              updateCostTier(index, tierIndex, {
                                minQuantity: parseIntegerInput(event.target.value),
                              })
                            }
                            type="text"
                            value={tier.minQuantity}
                          />
                          <input
                            aria-label="Costo unitario proveedor"
                            className={inputClassName}
                            inputMode="decimal"
                            maxLength={11}
                            onChange={(event) =>
                              updateCostTier(index, tierIndex, {
                                unitCost: parseDecimalInput(
                                  event.target.value,
                                  MONEY_DECIMAL_PLACES,
                                ),
                              })
                            }
                            type="text"
                            value={tier.unitCost}
                          />
                          <Button
                            onClick={() =>
                              updateSupplier(index, {
                                costTiers: costTiers.filter(
                                  (_, itemIndex) => itemIndex !== tierIndex,
                                ),
                              })
                            }
                            type="button"
                            variant="danger"
                          >
                            Eliminar
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState text="No hay costos por volumen para este proveedor." />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState text="No hay proveedores asociados a este producto." />
      )}
    </section>
  );
}

function MediaTab({
  value,
  errors,
  onChange,
  readOnly,
}: {
  value: ProductMediaEditorValue[];
  errors: ProductValidationErrors;
  onChange: (value: ProductMediaEditorValue[]) => void;
  readOnly: boolean;
}) {
  const primary = value.find((item) => item.isPrimary) ?? value[0];
  const { user } = useCurrentSession();
  const [uploadError, setUploadError] = useState<string | null>(null);

  function update(index: number, patch: Partial<ProductMediaEditorValue>) {
    let next = value.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
    if (patch.isPrimary) {
      next = next.map((item, itemIndex) => ({ ...item, isPrimary: itemIndex === index }));
    }
    onChange(next);
  }

  async function appendFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploadError(null);
    if (value.length + files.length > 6) {
      setUploadError("Puedes guardar hasta 6 imágenes por producto.");
      return;
    }
    try {
      const uploads = await Promise.all([...files].map((file) => processImageUpload(file)));
      onChange([
        ...value,
        ...uploads.map((pendingUpload, index) => ({
          type: "image" as const,
          url: "",
          source: undefined,
          pendingUpload,
          alt: "",
          isPrimary: value.length === 0 && index === 0,
          sortOrder: value.length + index + 1,
        })),
      ]);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "No se pudo procesar la imagen.");
    }
  }

  async function replaceFile(index: number, file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    try {
      update(index, {
        pendingUpload: await processImageUpload(file),
        source: undefined,
        url: "",
      });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "No se pudo procesar la imagen.");
    }
  }

  return (
    <section className="space-y-5 rounded-md border border-[var(--color-border)] bg-white p-4 sm:p-5">
      <SectionTitle
        description="Agrega hasta 6 imágenes en formato JPEG, PNG o WebP. Las imágenes se optimizan automáticamente al subirlas."
        title="Multimedia"
      />
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-app-background)] p-4 text-center">
          {primary ? (
            <>
              <CatalogMediaPreview media={primary} tenantId={user?.tenantId} />
              <span className="mt-3 inline-flex rounded-full bg-white px-3 py-1 text-xs font-bold text-[var(--color-title)]">
                Imagen principal configurada
              </span>
            </>
          ) : (
            <div className="grid aspect-square w-full place-items-center rounded-md border border-dashed border-[var(--color-border)] bg-white px-4 text-sm font-semibold text-[var(--color-text-muted)]">
              Sin imagen configurada
            </div>
          )}
        </div>
        <div className="space-y-4">
          <div className="flex items-center justify-end gap-3">
            {readOnly ? (
              <span className="text-sm text-[var(--color-text-muted)]">
                Sin permiso para modificar multimedia.
              </span>
            ) : null}
            <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white">
              Seleccionar archivos
              <input
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={readOnly || value.length >= 6}
                multiple
                onChange={(event) => {
                  void appendFiles(event.target.files);
                  event.target.value = "";
                }}
                type="file"
              />
            </label>
          </div>
          {uploadError ? <FieldError>{uploadError}</FieldError> : null}
          {errors.primaryImageUrl ? <FieldError>{errors.primaryImageUrl}</FieldError> : null}
          {value.length ? (
            <div className="space-y-3">
              {value.map((media, index) => (
                <div
                  className="grid gap-3 rounded-md border border-[var(--color-border)] p-3 md:grid-cols-[72px_minmax(0,1fr)_minmax(0,1fr)_auto_auto]"
                  key={`${media.id ?? "new"}-${index}`}
                >
                  <CatalogMediaPreview compact media={media} tenantId={user?.tenantId} />
                  <div className="space-y-2">
                    <p className="truncate text-xs text-[var(--color-text-muted)]">
                      {media.pendingUpload
                        ? "Archivo local listo para guardar"
                        : media.source?.kind === "mockAsset"
                          ? "Archivo local guardado"
                          : media.url.startsWith("/api/media/")
                            ? "Archivo administrado"
                            : "Imagen externa"}
                    </p>
                    <label className="block cursor-pointer text-xs font-semibold text-[var(--color-title)] underline">
                      {media.pendingUpload || media.source?.kind === "mockAsset"
                        ? "Reemplazar archivo"
                        : "Usar archivo local"}
                      <input
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        disabled={readOnly}
                        onChange={(event) => {
                          void replaceFile(index, event.target.files?.[0]);
                          event.target.value = "";
                        }}
                        type="file"
                      />
                    </label>
                  </div>
                  <Input
                    aria-label="Texto alternativo"
                    disabled={readOnly}
                    onChange={(event) => update(index, { alt: event.target.value })}
                    placeholder="Texto alternativo"
                    value={media.alt ?? ""}
                  />
                  <Button
                    disabled={readOnly}
                    onClick={() => update(index, { isPrimary: true })}
                    type="button"
                    className="w-full sm:w-auto"
                    variant={media.isPrimary ? "primary" : "secondary"}
                  >
                    Principal
                  </Button>
                  <Button
                    disabled={readOnly}
                    onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
                    type="button"
                    className="w-full sm:w-auto"
                    variant="danger"
                  >
                    Eliminar
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No hay multimedia configurada." />
          )}
        </div>
      </div>
    </section>
  );
}

function CatalogMediaPreview({
  compact,
  media,
  tenantId,
}: {
  compact?: boolean;
  media?: ProductMediaEditorValue;
  tenantId?: string;
}) {
  const source = media
    ? (media.source ??
      (media.url.trim() ? { kind: "url" as const, src: media.url.trim() } : undefined))
    : undefined;
  return (
    <CatalogImage
      alt={media?.alt || "Vista previa de imagen"}
      className={cn(
        "rounded-md border border-[var(--color-border)] bg-white object-cover",
        compact ? "h-16 w-16" : "mx-auto aspect-square w-full max-w-44",
      )}
      previewBlob={media?.pendingUpload?.blob}
      source={source}
      tenantId={tenantId}
    />
  );
}

function ChannelButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
        active
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-title)]"
          : "border-[var(--color-border)] bg-white text-[var(--color-text-muted)] hover:border-[var(--color-structure)] hover:text-[var(--color-title)]",
      )}
      onClick={onClick}
      type="button"
    >
      {active ? <CheckIcon /> : null}
      {children}
    </button>
  );
}

function PromotionChannels({ channels }: { channels: SalesChannel[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {channels.includes(SalesChannel.pos) ? <MiniChannel icon={<PosIcon />} label="POS" /> : null}
      {channels.includes(SalesChannel.ecommerce) ? (
        <MiniChannel icon={<GlobeIcon />} label="Web" />
      ) : null}
      {channels.includes(SalesChannel.mobileApp) ? (
        <MiniChannel icon={<MobileIcon />} label="App" />
      ) : null}
    </div>
  );
}

function MiniChannel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-primary)] bg-[var(--color-primary)]/10 px-2 py-1 text-xs font-semibold text-[var(--color-title)]">
      {icon}
      {label}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-base font-bold text-[var(--color-title)]">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 font-semibold text-[var(--color-text)]">{value}</dd>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 text-sm font-bold text-[var(--color-title)]">{value}</dd>
    </div>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-lg font-bold text-[var(--color-title)]">{title}</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-app-background)] p-6 text-center text-sm font-semibold text-[var(--color-text-muted)]">
      {text}
    </div>
  );
}

function CharacterCount({ current, maximum }: { current: number; maximum: number }) {
  return (
    <p className="text-right text-xs text-[var(--color-text-muted)]">
      {current} / {maximum}
    </p>
  );
}

function FieldError({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-[var(--color-danger)] bg-white p-3 text-sm font-medium text-[var(--color-danger)]">
      {children}
    </p>
  );
}

function NativeField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2 text-sm font-semibold text-[var(--color-text)]">
      {label}
      {children}
    </label>
  );
}

function StatusPill({ status }: { status: PromotionStatus }) {
  return (
    <span className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-1 text-xs font-bold text-[var(--color-title)]">
      {promotionStatusLabels[status]}
    </span>
  );
}

function ProductStatusPill({ status }: { status: ProductStatus }) {
  const label = status === ProductStatus.published ? "Publicado" : "Archivado";

  return (
    <span className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-1 text-xs font-bold text-[var(--color-title)]">
      {label}
    </span>
  );
}

function defaultPromotionForm(product: PromotionProduct): PromotionFormState {
  return {
    type: PromotionType.percentage,
    value: "10",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    channels: enabledProductChannels(product),
    untilStockEnds: product.tracking.stock,
  };
}

function formFromPromotion(promotion: Promotion): PromotionFormState {
  return {
    type: promotion.type,
    value: String(promotion.value),
    startDate: promotion.startAt.slice(0, 10),
    endDate: promotion.endAt?.slice(0, 10) ?? "",
    channels: promotion.channels,
    untilStockEnds: promotion.untilStockEnds,
  };
}

function enabledProductChannels(product: PromotionProduct): SalesChannel[] {
  return [
    product.channels.pos ? SalesChannel.pos : null,
    product.channels.ecommerce ? SalesChannel.ecommerce : null,
    product.channels.mobileApp ? SalesChannel.mobileApp : null,
  ].filter((channel): channel is SalesChannel => Boolean(channel));
}

function validatePromotionForm(state: PromotionFormState, salePrice: number) {
  const value = Number(state.value);
  if (!Number.isFinite(value) || value <= 0) return "Ingresa un valor mayor a 0.";
  const maximumDecimalPlaces =
    state.type === PromotionType.percentage ? PERCENTAGE_DECIMAL_PLACES : MONEY_DECIMAL_PLACES;
  if (!hasAtMostDecimalPlaces(state.value, maximumDecimalPlaces)) {
    return `El valor admite hasta ${maximumDecimalPlaces} decimales.`;
  }
  if (state.type === PromotionType.percentage && value > MAX_PERCENTAGE) {
    return "El porcentaje no puede superar 100.";
  }
  if (state.type !== PromotionType.percentage && value > MAX_SAFE_CURRENCY) {
    return "El valor no puede superar Q9,999,999.99.";
  }
  if (
    (state.type === PromotionType.fixedDiscount || state.type === PromotionType.fixedPrice) &&
    value >= salePrice
  ) {
    return "El valor debe ser menor al precio regular.";
  }
  if (!state.startDate) return "Selecciona una fecha de inicio.";
  if (state.endDate && state.endDate < state.startDate) {
    return "La fecha final no puede ser anterior a la fecha de inicio.";
  }
  if (state.channels.length === 0) return "Selecciona al menos un canal.";
  return null;
}

function validateProductFormFields(value: ProductEditorDto): ProductFormErrors {
  const errors: ProductFormErrors = {
    ...validateProductFormPilot(value),
    ...validateProductDto({
      ...value,
      salePrice: toFiniteNumber(value.salePrice),
      primaryImageUrl: value.media.find((item) => item.isPrimary)?.url,
    }),
  };

  if (value.salePrice === "") {
    errors.salePrice = "Configure al menos un precio de venta.";
  }
  return errors;
}

function validateEditor(
  value: ProductEditorDto,
  editorData: ProductEditorData,
  units: ProductFormOptions["units"],
) {
  if (!hasAtMostDecimalPlaces(value.salePrice, MONEY_DECIMAL_PLACES)) {
    return "El precio de venta admite hasta 2 decimales.";
  }
  const baseUnit = units.find((unit) => unit.id === value.baseUnitId);
  if (value.unitConversions !== undefined) {
    if (
      (value.baseUnitId !== value.inventoryUnitId &&
        !isPositiveNumber(value.inventoryToBaseFactor)) ||
      (value.baseUnitId !== value.saleUnitId && !isPositiveNumber(value.saleToBaseFactor))
    ) {
      return "Cada presentacion debe equivaler a un multiplo positivo de la unidad base.";
    }
    if (
      toFiniteNumber(value.inventoryToBaseFactor) > MAX_SAFE_CONVERSION_FACTOR ||
      toFiniteNumber(value.saleToBaseFactor) > MAX_SAFE_CONVERSION_FACTOR
    ) {
      return "El factor de conversion no puede superar 999,999.99.";
    }
    if (
      !hasAtMostDecimalPlaces(value.inventoryToBaseFactor, CONVERSION_FACTOR_DECIMAL_PLACES) ||
      !hasAtMostDecimalPlaces(value.saleToBaseFactor, CONVERSION_FACTOR_DECIMAL_PLACES)
    ) {
      return "El factor de conversion admite hasta 6 decimales.";
    }
    if (
      baseUnit &&
      [
        ...(value.inventoryUnitId === value.baseUnitId ? [] : [value.inventoryToBaseFactor]),
        ...(value.saleUnitId === value.baseUnitId ? [] : [value.saleToBaseFactor]),
      ].some((factor) => !isConversionFactorCompatibleWithBaseUnit(factor, baseUnit.allowsDecimals))
    ) {
      return baseUnit.allowsDecimals
        ? "El factor de conversion admite hasta 6 decimales."
        : "La conversion debe producir una cantidad entera de la unidad base.";
    }
  }
  if (
    value.kitComponents.some(
      (component) =>
        !isPositiveNumber(component.quantityPerKit) ||
        !hasAtMostDecimalPlaces(component.quantityPerKit, QUANTITY_DECIMAL_PLACES) ||
        toFiniteNumber(component.quantityPerKit) > MAX_KIT_COMPONENT_QUANTITY,
    )
  ) {
    return "Cada componente del kit debe estar entre 0 y 9,999.";
  }
  const salesQuantities = new Set<number>();
  for (const tier of value.salesPriceTiers ?? []) {
    const minQuantity = toFiniteNumber(tier.minQuantity);
    if (!isPositiveInteger(tier.minQuantity) || minQuantity <= 1) {
      return "La cantidad minima mayorista debe ser un entero mayor a 1.";
    }
    if (minQuantity > MAX_SAFE_INTEGER_COUNT) return "La cantidad minima no puede superar 999,999.";
    if (!isPositiveNumber(tier.unitPrice)) return "El precio mayorista debe ser mayor a 0.";
    if (!hasAtMostDecimalPlaces(tier.unitPrice, MONEY_DECIMAL_PLACES))
      return "El precio mayorista admite hasta 2 decimales.";
    if (toFiniteNumber(tier.unitPrice) > MAX_SAFE_CURRENCY)
      return "El precio mayorista no puede superar Q9,999,999.99.";
    if (salesQuantities.has(minQuantity)) return "No repitas cantidades mayoristas.";
    salesQuantities.add(minQuantity);
  }
  const supplierIds = new Set<string>();
  for (const supplierProduct of value.supplierProducts) {
    if (supplierIds.has(supplierProduct.supplierId)) return "No repitas proveedores.";
    supplierIds.add(supplierProduct.supplierId);
    if (!isPositiveNumber(supplierProduct.purchaseToBaseFactor))
      return "El contenido de compra debe ser mayor a 0.";
    if (toFiniteNumber(supplierProduct.purchaseToBaseFactor) > MAX_SAFE_CONVERSION_FACTOR)
      return "El contenido de compra no puede superar 999,999.99.";
    if (
      !hasAtMostDecimalPlaces(
        supplierProduct.purchaseToBaseFactor,
        CONVERSION_FACTOR_DECIMAL_PLACES,
      )
    )
      return "El contenido de compra admite hasta 6 decimales.";
    if (
      baseUnit &&
      !isConversionFactorCompatibleWithBaseUnit(
        supplierProduct.purchaseToBaseFactor,
        baseUnit.allowsDecimals,
      )
    )
      return baseUnit.allowsDecimals
        ? "El contenido de compra admite hasta 6 decimales."
        : "El contenido de compra debe producir unidades base enteras.";
    if (toFiniteNumber(supplierProduct.lastCost, -1) < 0)
      return "El costo del proveedor debe ser mayor o igual a 0.";
    if (toFiniteNumber(supplierProduct.lastCost) > MAX_SAFE_CURRENCY)
      return "El costo del proveedor no puede superar Q9,999,999.99.";
    if (!hasAtMostDecimalPlaces(supplierProduct.lastCost, MONEY_DECIMAL_PLACES))
      return "El costo del proveedor admite hasta 2 decimales.";
    if (!isPositiveInteger(supplierProduct.minimumOrderQuantity)) {
      return "El pedido minimo debe ser un entero mayor a 0.";
    }
    const costQuantities = new Set<number>();
    for (const tier of supplierProduct.costTiers ?? []) {
      const minQuantity = toFiniteNumber(tier.minQuantity);
      if (!isPositiveInteger(tier.minQuantity))
        return "La cantidad minima de costo debe ser un entero mayor a 0.";
      if (minQuantity > MAX_SAFE_INTEGER_COUNT)
        return "La cantidad minima de costo no puede superar 999,999.";
      if (toFiniteNumber(tier.unitCost, -1) < 0)
        return "El costo por volumen debe ser mayor o igual a 0.";
      if (toFiniteNumber(tier.unitCost) > MAX_SAFE_CURRENCY)
        return "El costo por volumen no puede superar Q9,999,999.99.";
      if (!hasAtMostDecimalPlaces(tier.unitCost, MONEY_DECIMAL_PLACES))
        return "El costo por volumen admite hasta 2 decimales.";
      if (costQuantities.has(minQuantity)) return "No repitas cantidades de costo.";
      costQuantities.add(minQuantity);
    }
  }
  const invalidMedia = value.media.find(
    (media) =>
      !media.pendingUpload &&
      media.source?.kind !== "mockAsset" &&
      (!media.url.trim() ||
        !(
          media.url.trim().startsWith("/") ||
          media.url.trim().startsWith("http://") ||
          media.url.trim().startsWith("https://")
        )),
  );
  if (value.media.length > 6) return "Puedes guardar hasta 6 imágenes por producto.";
  if (invalidMedia) return "Cada imagen debe iniciar con / o una URL http(s).";
  if (
    value.tracking.stock &&
    value.inventorySettings !== undefined &&
    (value.inventorySettings.minStock === "" ||
      !Number.isSafeInteger(toFiniteNumber(value.inventorySettings.minStock)) ||
      toFiniteNumber(value.inventorySettings.minStock) < 0)
  ) {
    return "El stock minimo debe ser mayor o igual a 0.";
  }
  if (
    value.inventorySettings !== undefined &&
    toFiniteNumber(value.inventorySettings.minStock) > MAX_SAFE_INTEGER_COUNT
  ) {
    return "El stock minimo no puede superar 999,999.";
  }
  if (
    value.tracking.stock &&
    editorData.access.canReadLocations &&
    // Solo se valida con las ubicaciones de la sucursal ya cargadas: si aun cargan o fallaron, la lista
    // vacia no prueba que la ubicacion asignada este inactiva.
    editorData.branchLocations.length > 0 &&
    value.inventorySettings?.defaultLocationId &&
    !editorData.storageLocations.some(
      (location) => location.id === value.inventorySettings?.defaultLocationId,
    )
  ) {
    return "Selecciona una ubicacion predeterminada activa o deja el campo sin ubicacion.";
  }
  return null;
}

function routeToFirstError(
  errors: ProductFormErrors,
  editorError: string | null,
  setActiveTab: (tab: ProductFormTab) => void,
) {
  const firstError = Object.keys(errors)[0] as keyof ProductFormErrors | undefined;
  if (
    firstError === "sku" ||
    firstError === "name" ||
    firstError === "categoryId" ||
    firstError === "productType"
  ) {
    setActiveTab("general");
  } else if (firstError === "baseUnitId" || firstError === "saleUnitId") {
    setActiveTab("units");
  } else if (firstError === "salePrice") {
    setActiveTab("prices");
  } else if (firstError === "tracking" || firstError === "defaultLocationId") {
    setActiveTab("tracking");
  } else if (firstError === "primaryImageUrl") {
    setActiveTab("media");
  } else if (editorError) {
    setActiveTab(
      editorError.includes("stock minimo") || editorError.includes("ubicacion")
        ? "tracking"
        : editorError.includes("conversion") || editorError.includes("equivalencia")
          ? "units"
          : editorError.includes("mayorista")
            ? "prices"
            : editorError.includes("proveedor") ||
                editorError.includes("compra") ||
                editorError.includes("costo")
              ? "suppliers"
              : editorError.includes("imagen") ||
                  editorError.includes("imágenes") ||
                  editorError.includes("multimedia")
                ? "media"
                : "general",
    );
  }
}

function toIsoStart(date: string) {
  return `${date}T00:00:00.000Z`;
}

function toIsoEnd(date: string) {
  return `${date}T23:59:59.999Z`;
}

function formatPromotionValue(promotion: Promotion) {
  if (promotion.type === PromotionType.percentage) return `${promotion.value}%`;
  return formatCurrency(promotion.value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function buildInitialValue(
  options: ProductFormOptions,
  editorData: ProductEditorData,
): ProductEditorDto {
  const detail = editorData.detail;
  if (detail) {
    const saleUnitId = detail.product.saleUnitId ?? detail.product.baseUnitId;
    const inventoryUnitId = detail.product.inventoryUnitId ?? detail.product.baseUnitId;
    const editedDraft: ProductEditorDto = {
      sku: detail.product.sku,
      barcode: detail.product.barcode,
      name: detail.product.name,
      description: detail.product.description,
      brand: detail.product.brand,
      productType: detail.product.productType,
      categoryId: detail.product.categoryId,
      baseUnitId: detail.product.baseUnitId,
      inventoryUnitId,
      saleUnitId,
      inventoryToBaseFactor: inventoryUnitId === detail.product.baseUnitId ? 1 : "",
      saleToBaseFactor: saleUnitId === detail.product.baseUnitId ? 1 : "",
      unitConversions: undefined,
      salePrice: detail.product.salePrice,
      status: detail.product.status,
      // Se carga el tracking TAL CUAL esta persistido, sin recortar: applyCapabilityRulesToEditor
      // (abajo) recibe el snapshot de lo existente y decide que conservar, no esta funcion.
      tracking: detail.product.tracking,
      inventorySettings: undefined,
      channels: detail.product.channels,
      attributes: editorData.attributes,
      salesPriceTiers: editorData.salesPriceTiers,
      supplierProducts: editorData.supplierProducts,
      media: editorData.media,
      kitComponents: editorData.kitComponents,
    };
    return applyCapabilityRulesToEditor(editedDraft, options.businessCapabilities, {
      saleUnitId,
      inventoryUnitId,
      tracking: detail.product.tracking,
    });
  }

  const unitId = options.units[0]?.id ?? "";
  const newDraft: ProductEditorDto = {
    sku: "",
    barcode: "",
    name: "",
    description: "",
    brand: "",
    productType: ProductType.physical,
    categoryId: options.categories[0]?.id ?? "",
    baseUnitId: unitId,
    inventoryUnitId: unitId,
    saleUnitId: unitId,
    inventoryToBaseFactor: 1,
    saleToBaseFactor: 1,
    unitConversions: undefined,
    salePrice: "",
    status: ProductStatus.published,
    tracking: getDefaultTracking(options.businessCapabilities, ProductType.physical),
    inventorySettings: undefined,
    channels: { ecommerce: true, pos: true, mobileApp: false },
    attributes: undefined,
    salesPriceTiers: undefined,
    supplierProducts: [],
    media: [],
    kitComponents: [],
  };
  return applyCapabilityRulesToEditor(newDraft, options.businessCapabilities);
}

const inputClassName =
  "h-10 w-full rounded-md border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-text)] outline-none transition hover:border-[var(--color-structure)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40";
