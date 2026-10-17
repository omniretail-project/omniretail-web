export type SupplierStatusFilter = "active" | "archived";

export interface SupplierCostTierReadModel {
  id: string;
  minQuantity: number;
  unitCost: number;
}

export interface SupplierProductReadModel {
  id: string;
  productName: string;
  productSku: string;
  supplierSku?: string;
  purchaseUnitLabel: string;
  minimumOrderQuantity: number;
  lastCost: number;
  leadTimeDays: number;
  preferred: boolean;
  active: boolean;
  costTiers: SupplierCostTierReadModel[];
}

export interface SupplierPurchaseOrderReadModel {
  id: string;
  number: string;
  createdAt: string;
  expectedDate?: string;
  total: number;
  status: string;
}

export interface SupplierContactReadModel {
  id: string;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  primary: boolean;
}

export type SupplierIncidentReadModel =
  import("@/modules/receiving/application/dto/IncidentListItemViewModel").IncidentListItemViewModel;

export interface SupplierListItemReadModel {
  id: string;
  name: string;
  legalName?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  status: string;
  archived: boolean;
  paymentConditionLabel: string;
  creditDaysLabel: string;
  currencyLabel: string;
  deliveryLabel: string;
  searchText: string;
  contacts: SupplierContactReadModel[];
  products: SupplierProductReadModel[];
  purchaseOrders: SupplierPurchaseOrderReadModel[];
  incidents: SupplierIncidentReadModel[];
}

export interface SuppliersReadModel {
  suppliers: SupplierListItemReadModel[];
}
