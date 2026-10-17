export const MAX_SAFE_INVENTORY_QUANTITY = 999_999.99;
export const MAX_SAFE_INTEGER_COUNT = 999_999;
export const MAX_SAFE_CURRENCY = 9_999_999.99;
export const MAX_SAFE_CONVERSION_FACTOR = 999_999.99;
export const MAX_KIT_COMPONENT_QUANTITY = 9_999;
export const MAX_PERCENTAGE = 100;

export const QUANTITY_DECIMAL_PLACES = 3;
export const MONEY_DECIMAL_PLACES = 2;
export const PERCENTAGE_DECIMAL_PLACES = 2;
export const CONVERSION_FACTOR_DECIMAL_PLACES = 6;

export const TEXT_LIMITS = {
  sku: 50,
  productName: 120,
  description: 1_000,
  brand: 80,
  barcode: 80,
  lotNumber: 50,
  serialNumbers: 5_000,
  reason: 200,
  notes: 500,
  search: 100,
  categoryName: 60,
  categoryCode: 30,
  locationName: 60,
  locationCode: 30,
  unitName: 40,
  unitSymbol: 10,
  attributeName: 50,
  attributeValue: 100,
  supplierName: 120,
  supplierLegalName: 160,
  supplierTaxId: 30,
  supplierPhone: 30,
  supplierEmail: 254,
  supplierContact: 120,
  supplierCode: 50,
  incidentName: 80,
} as const;

export function exceedsTextLimit(value: string | undefined, maximum: number) {
  return (value?.length ?? 0) > maximum;
}
