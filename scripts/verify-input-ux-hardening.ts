import assert from "node:assert/strict";
import {
  CategoryStatus,
  LocationStatus,
  ProductStatus,
  ProductType,
  PromotionType,
  UnitCategory,
  UnitStatus,
} from "@/core/enums";
import { assertValidPromotionValue } from "@/modules/catalog/application/services/SaveProductPromotionService";
import { validateCategoryDto } from "@/modules/catalog/validation/category.validation";
import { validateLocationDto } from "@/modules/catalog/validation/location.validation";
import { assertValidTransferQuantity } from "@/modules/inventory/application/services/TransferRequestServices";
import { assertValidInventoryQuantity } from "@/modules/inventory/application/services/RegisterInventoryAdjustmentService";
import { validateProductDto } from "@/modules/catalog/validation/product.validation";
import { validateUnitDto } from "@/modules/catalog/validation/unit.validation";
import { assertValidPurchaseOrderQuantity } from "@/modules/purchasing/application/services/PurchaseOrderEditorService";
import {
  CONVERSION_FACTOR_DECIMAL_PLACES,
  MAX_SAFE_CURRENCY,
  MAX_SAFE_INVENTORY_QUANTITY,
  MONEY_DECIMAL_PLACES,
  PERCENTAGE_DECIMAL_PLACES,
  QUANTITY_DECIMAL_PLACES,
  TEXT_LIMITS,
} from "@/shared/utils/inputLimits";
import {
  hasAtMostDecimalPlaces,
  isConversionFactorCompatibleWithBaseUnit,
  isQuantityCompatibleWithUnit,
  parseDecimalInput,
  parseIntegerInput,
  parseUnitQuantityInput,
} from "@/shared/utils/numberInput";

assert.equal(parseDecimalInput("1e20"), "");
assert.equal(parseDecimalInput("1e5"), "");
assert.equal(parseDecimalInput("Infinity"), "");
assert.equal(parseDecimalInput("NaN"), "");
assert.equal(parseDecimalInput("+1"), "");
assert.equal(parseDecimalInput("-1"), "");
assert.equal(parseDecimalInput("1.2.3"), "");
assert.equal(parseDecimalInput(" 0.25 "), 0.25);
assert.equal(parseDecimalInput("0."), "0.");
assert.equal(parseDecimalInput("1.2345", QUANTITY_DECIMAL_PLACES), "1.2345");
assert.equal(hasAtMostDecimalPlaces("1.250", QUANTITY_DECIMAL_PLACES), true);
assert.equal(hasAtMostDecimalPlaces("1.2501", QUANTITY_DECIMAL_PLACES), false);
assert.equal(parseUnitQuantityInput("1.2", false), "1.2");
assert.equal(isQuantityCompatibleWithUnit(parseUnitQuantityInput("1.2", false), false), false);
assert.equal(hasAtMostDecimalPlaces("4.10", MONEY_DECIMAL_PLACES), true);
assert.equal(hasAtMostDecimalPlaces("4.123", MONEY_DECIMAL_PLACES), false);
assert.equal(hasAtMostDecimalPlaces("10.25", PERCENTAGE_DECIMAL_PLACES), true);
assert.equal(hasAtMostDecimalPlaces("10.255", PERCENTAGE_DECIMAL_PLACES), false);
assert.equal(parseIntegerInput("1.5"), "");
assert.equal(parseIntegerInput("42"), 42);

assert.throws(() => assertValidTransferQuantity(Number.POSITIVE_INFINITY));
assert.throws(() => assertValidTransferQuantity(Number.NaN));
assert.throws(() => assertValidTransferQuantity(MAX_SAFE_INVENTORY_QUANTITY + 0.01));
assert.doesNotThrow(() => assertValidTransferQuantity(0.5));
assert.doesNotThrow(() => assertValidTransferQuantity(1, false));
assert.throws(() => assertValidTransferQuantity(1.2, false));
assert.doesNotThrow(() => assertValidTransferQuantity(1.234, true));
assert.throws(() => assertValidTransferQuantity(1.2345, true));
assert.doesNotThrow(() => assertValidInventoryQuantity(1, false));
assert.throws(() => assertValidInventoryQuantity(1.22, false));
assert.throws(() => assertValidPromotionValue(PromotionType.percentage, 100.01));
assert.doesNotThrow(() => assertValidPromotionValue(PromotionType.percentage, 100));
assert.doesNotThrow(() => assertValidPromotionValue(PromotionType.fixedDiscount, 150));
assert.doesNotThrow(() => assertValidPromotionValue(PromotionType.fixedDiscount, 4.1));
assert.throws(() => assertValidPromotionValue(PromotionType.fixedDiscount, 4.123));
assert.doesNotThrow(() => assertValidPromotionValue(PromotionType.percentage, 10.25));
assert.throws(() => assertValidPromotionValue(PromotionType.percentage, 10.255));

const integerPurchaseUnit = {
  purchaseToBaseFactor: 1,
  purchaseUnitAllowsDecimals: false,
  baseUnitAllowsDecimals: false,
  serialTracked: false,
};
const decimalPurchaseUnit = {
  purchaseToBaseFactor: 1,
  purchaseUnitAllowsDecimals: true,
  baseUnitAllowsDecimals: true,
  serialTracked: false,
};
assert.equal(assertValidPurchaseOrderQuantity({ ...integerPurchaseUnit, quantity: 2 }), 2);
assert.throws(() => assertValidPurchaseOrderQuantity({ ...integerPurchaseUnit, quantity: 2.5 }));
assert.equal(assertValidPurchaseOrderQuantity({ ...decimalPurchaseUnit, quantity: 2.5 }), 2.5);
assert.equal(assertValidPurchaseOrderQuantity({ ...decimalPurchaseUnit, quantity: 0.25 }), 0.25);
assert.equal(assertValidPurchaseOrderQuantity({ ...decimalPurchaseUnit, quantity: 1.251 }), 1.251);
assert.throws(() =>
  assertValidPurchaseOrderQuantity({ ...decimalPurchaseUnit, quantity: 1.25151515 }),
);
assert.throws(() => assertValidPurchaseOrderQuantity({ ...decimalPurchaseUnit, quantity: 0 }));
assert.throws(() =>
  assertValidPurchaseOrderQuantity({ ...decimalPurchaseUnit, quantity: Number.NaN }),
);
assert.throws(() =>
  assertValidPurchaseOrderQuantity({ ...decimalPurchaseUnit, quantity: Number.POSITIVE_INFINITY }),
);
assert.throws(() =>
  assertValidPurchaseOrderQuantity({
    ...decimalPurchaseUnit,
    quantity: MAX_SAFE_INVENTORY_QUANTITY + 0.01,
  }),
);
assert.equal(
  assertValidPurchaseOrderQuantity({
    quantity: 0.5,
    purchaseToBaseFactor: 10,
    purchaseUnitAllowsDecimals: true,
    baseUnitAllowsDecimals: false,
    serialTracked: true,
  }),
  5,
);
assert.equal(isConversionFactorCompatibleWithBaseUnit(1.2, false), false);
assert.equal(isConversionFactorCompatibleWithBaseUnit(10, false), true);
assert.equal(isConversionFactorCompatibleWithBaseUnit(1.25, true), true);
// Precision vigente de factores de conversion: CONVERSION_FACTOR_DECIMAL_PLACES = 6.
assert.equal(isConversionFactorCompatibleWithBaseUnit(1.23456, true), true);
assert.equal(isConversionFactorCompatibleWithBaseUnit(1.234567, true), true);
assert.equal(isConversionFactorCompatibleWithBaseUnit(1.2345678, true), false);
assert.equal(isConversionFactorCompatibleWithBaseUnit(1.234567, false), false);

const validProduct = {
  sku: "SKU-1",
  name: "Producto",
  description: "",
  brand: "",
  barcode: "",
  productType: ProductType.physical,
  categoryId: "category-1",
  baseUnitId: "unit-1",
  inventoryUnitId: "unit-1",
  saleUnitId: "unit-1",
  salePrice: 10.5,
  status: ProductStatus.published,
  tracking: { stock: true, lot: false, expiration: false, serial: false },
  channels: { pos: true, ecommerce: false, mobileApp: false },
};
assert.deepEqual(validateProductDto(validProduct), {});
assert.match(validateProductDto({ ...validProduct, salePrice: 4.123 }).salePrice ?? "", /2/);
assert.match(
  validateProductDto({ ...validProduct, salePrice: MAX_SAFE_CURRENCY + 0.01 }).salePrice ?? "",
  /superar/,
);
assert.match(
  validateProductDto({ ...validProduct, name: "x".repeat(TEXT_LIMITS.productName + 1) }).name ?? "",
  /120/,
);

assert.equal(TEXT_LIMITS.categoryName, 60);
assert.equal(TEXT_LIMITS.categoryCode, 30);
assert.equal(TEXT_LIMITS.locationName, 60);
assert.equal(TEXT_LIMITS.locationCode, 30);
assert.equal(TEXT_LIMITS.unitName, 40);
assert.equal(TEXT_LIMITS.unitSymbol, 10);
assert.equal(QUANTITY_DECIMAL_PLACES, 3);
assert.equal(MONEY_DECIMAL_PLACES, 2);
assert.equal(PERCENTAGE_DECIMAL_PLACES, 2);
assert.equal(CONVERSION_FACTOR_DECIMAL_PLACES, 6);
assert.match(
  validateCategoryDto(
    {
      name: "x".repeat(TEXT_LIMITS.categoryName + 1),
      code: "CAT",
      description: "",
      parentId: "",
      status: CategoryStatus.active,
    },
    [],
  ).name ?? "",
  /60/,
);
assert.match(
  validateCategoryDto(
    {
      name: "Categoria",
      code: "X".repeat(TEXT_LIMITS.categoryCode + 1),
      description: "",
      parentId: "",
      status: CategoryStatus.active,
    },
    [],
  ).code ?? "",
  /30/,
);
assert.match(
  validateLocationDto(
    {
      name: "x".repeat(TEXT_LIMITS.locationName + 1),
      code: "LOC",
      description: "",
      branchId: "branch-1",
      parentId: "",
      type: "warehouse",
      status: LocationStatus.active,
    },
    [],
  ).name ?? "",
  /60/,
);
assert.match(
  validateUnitDto(
    {
      name: "x".repeat(TEXT_LIMITS.unitName + 1),
      symbol: "u",
      category: UnitCategory.unit,
      allowsDecimals: false,
      status: UnitStatus.active,
    },
    [],
  ).name ?? "",
  /40/,
);

console.log("Input UX hardening harness passed.");
