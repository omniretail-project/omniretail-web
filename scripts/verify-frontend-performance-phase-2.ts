import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function between(source: string, start: string, end: string) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `No se encontro el inicio: ${start}`);
  assert.notEqual(to, -1, `No se encontro el final: ${end}`);
  return source.slice(from, to);
}

const productEditorService = read(
  "src/modules/catalog/application/services/GetProductEditorDataService.ts",
);
const productInitialLoad = between(
  productEditorService,
  "async execute(",
  "async getKitEligibleProducts(",
);
assert.doesNotMatch(productInitialLoad, /products\.getByTenant/);
assert.doesNotMatch(productInitialLoad, /inventory\.getLocations/);
assert.doesNotMatch(productInitialLoad, /categories\.getByIdScoped/);
assert.doesNotMatch(productInitialLoad, /units\.getByIdScoped/);
assert.match(productInitialLoad, /supplierProducts/);
assert.match(productInitialLoad, /productKitComponents/);
assert.match(productInitialLoad, /loadEditorDetailWithMedia/);
assert.match(productEditorService, /kitEligibleLoads\.delete\(key\)/);
assert.match(productEditorService, /locationLoads\.delete\(key\)/);
assert.match(productEditorService, /const existing = this\.kitEligibleLoads\.get\(key\)/);

const deferredProductData = read(
  "src/modules/catalog/hooks/useProductEditorDeferredData.ts",
);
assert.match(deferredProductData, /if \(!enabled/);
assert.match(deferredProductData, /useDataEvent\("product\.changed"/);
assert.match(deferredProductData, /invalidateKitEligibleProducts\(tenantId\)/);
// Sin persistencia, sin timers de workaround y sin TTL: identificadores inocentes como `settled`
// contienen "ttl" como subcadena, por eso se buscan tokens completos.
assert.doesNotMatch(deferredProductData, /\blocalStorage\b/);
assert.doesNotMatch(deferredProductData, /\bsetTimeout\b/);
assert.doesNotMatch(deferredProductData, /\bttl\b/i);

const productForm = read("src/modules/catalog/components/ProductForm.tsx");
assert.match(
  productForm,
  /activeTab === "tracking" && value\.productType === ProductType\.kit/,
);
assert.match(productForm, /Cargando ubicaciones de la sucursal/);

const purchaseOrderService = read(
  "src/modules/purchasing/application/services/PurchaseOrderEditorService.ts",
);
const newCatalogLoad = between(
  purchaseOrderService,
  "async startAvailableProductsLoad(",
  "private getActiveSuppliersForTenant(",
);
assert.match(newCatalogLoad, /Cargando inventario/);
// El stock del flujo NEW ya no pasa por un mapa propio: una sola carga logica (startInventorySnapshots,
// stock batch en modo API) y el resultado se asocia a cada producto por productId.
assert.match(newCatalogLoad, /this\.startInventorySnapshots\(/);
assert.match(newCatalogLoad, /results\.get\(product\.productId\)/);
const inventorySnapshots = between(
  purchaseOrderService,
  "private async startInventorySnapshots(",
  "private async getMockInventorySnapshot(",
);
assert.equal(
  inventorySnapshots.match(/getStockBatch\(/g)?.length,
  1,
  "El stock de la orden nueva debe leerse con una sola llamada batch.",
);
assert.match(inventorySnapshots, /productIds: eligibleIds/);
assert.match(
  inventorySnapshots,
  /product\.productType === ProductType\.physical && product\.tracking\.stock/,
);
// La rama API (desde la seleccion de elegibles) no tiene fallback N+1 por producto.
const apiStockBranch = inventorySnapshots.slice(inventorySnapshots.indexOf("const eligibleIds"));
assert.doesNotMatch(apiStockBranch, /getBalanceByProduct|getProductInventorySettings|getStockPage/);
assert.doesNotMatch(apiStockBranch, /\.map\(\s*async/);
assert.match(newCatalogLoad, /return \{ products: availableProducts, inventory \}/);
assert.match(purchaseOrderService, /referenceDataKeys\.activeSuppliers\(tenantId\)/);
const authoritativeSave = between(
  purchaseOrderService,
  "private async ensureSaveInputTenantSafe(",
  "function toPurchaseOrderPayload",
);
assert.match(authoritativeSave, /suppliers\.getActiveByTenant/);
assert.match(authoritativeSave, /products\.getById/);

const purchaseOrderHook = read("src/modules/purchasing/hooks/usePurchaseOrderEditor.ts");
assert.match(purchaseOrderHook, /startAvailableProductsLoad/);
assert.match(purchaseOrderHook, /useDataEvent\("supplier\.changed"/);
assert.match(purchaseOrderHook, /mergeLineInventory/);
const visualMerge = between(
  purchaseOrderHook,
  "function mergeLineInventory(",
  "function getInitialQuantity(",
);
assert.doesNotMatch(visualMerge, /quantity:|agreedCost:|suggestedCost:|tiers:/);
assert.match(purchaseOrderHook, /productsRequestIdRef\.current !== requestId/);

const receivingPage = read("src/modules/receiving/pages/ReceivingDocumentPage.tsx");
assert.match(receivingPage, /dynamic\(/);
assert.match(receivingPage, /ReceivingIncidentForms/);
assert.match(receivingPage, /ReceivingHistoryDialogs/);
assert.doesNotMatch(receivingPage, /function ApiIncidentForm/);
assert.doesNotMatch(receivingPage, /function PreviousReceiptModal/);
assert.equal(receivingPage.match(/const \w+ = dynamic\(/g)?.length, 2);

const storefrontHome = read("src/modules/storefront/pages/HomePage.tsx");
const storefrontDetail = read("src/modules/storefront/pages/ProductDetailPage.tsx");
const storefrontCard = read("src/modules/storefront/components/StorefrontProductCard.tsx");
const storefrontImage = read("src/modules/storefront/components/StorefrontCatalogImage.tsx");
const catalogImage = read("src/modules/catalog/components/CatalogImage.tsx");
const imageUrlHook = read("src/infrastructure/media/useCatalogImageUrl.ts");
assert.match(storefrontHome, /fetchPriority="high"/);
assert.match(storefrontDetail, /fetchPriority="high"/);
assert.match(storefrontCard, /loading="lazy"/);
assert.match(storefrontImage, /ImgHTMLAttributes<HTMLImageElement>/);
assert.match(catalogImage, /previewBlob/);
assert.match(imageUrlHook, /URL\.createObjectURL/);
assert.doesNotMatch(`${storefrontImage}\n${catalogImage}`, /next\/image/);

console.log("Frontend performance phase 2 invariants: OK");
