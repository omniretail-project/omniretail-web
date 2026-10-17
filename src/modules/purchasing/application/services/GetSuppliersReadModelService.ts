import type {
  Product,
  PurchaseOrder,
  Supplier,
  SupplierCostTier,
  SupplierProduct,
  Unit,
} from "@/core/entities";
import { ReceiptStatus, SupplierStatus } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type {
  SupplierContactReadModel,
  SupplierListItemReadModel,
  SupplierProductReadModel,
  SupplierIncidentReadModel,
  SuppliersReadModel,
} from "@/modules/purchasing/application/dto/SupplierReadModel";
import { buildIncidentListItems } from "@/modules/receiving/application/services/buildIncidentListItems";
import type {
  OperationalSupplierDetail,
  OperationalSupplierIncident,
  OperationalSupplierIncidentPageParams,
  OperationalSupplierProduct,
  OperationalSupplierProductPageParams,
  OperationalSupplierSummary,
} from "@/core/repositories";
import type { PaginatedResult } from "@/core/types";
import type { SupplierPurchaseOrderReadModel } from "@/modules/purchasing/application/dto/SupplierReadModel";
import {
  ensureCanReadPurchaseOrders,
  resolvePurchasingContext,
} from "@/modules/purchasing/application/services/serviceHelpers";

export class GetSuppliersReadModelService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  /**
   * `activeBranchId`/`activeTenantId` (parametros historicos del cliente) ya NO deciden el
   * tenant autoritativo -- permission-hardening (feature/permission-hardening-purchasing-
   * receiving): el tenant SIEMPRE sale de la sesion (`resolvePurchasingContext`). Se conservan
   * solo como filtro de VISTA (que ordenes/recepciones de ESTA sucursal mostrar en las stats de
   * cada proveedor), nunca como limite de seguridad.
   */
  async execute(activeBranchId?: string, activeTenantId?: string): Promise<SuppliersReadModel> {
    void activeTenantId;
    const { tenantId } = await resolvePurchasingContext(this.repositories);
    const [
      allSuppliers,
      products,
      units,
      allPurchaseOrders,
      receipts,
      incidentTypes,
      users,
      branches,
    ] = await Promise.all([
      this.repositories.suppliers.getAll(),
      this.repositories.products.getAll(),
      this.repositories.units.getAll(),
      this.repositories.purchaseOrders.listByTenant(tenantId),
      this.repositories.receipts.listByTenant(tenantId),
      this.repositories.incidentTypes.getAll(),
      this.repositories.users.getAll(),
      this.repositories.branches.getAll(),
    ]);

    const suppliers = allSuppliers.filter((supplier) => supplier.tenantId === tenantId);
    const purchaseOrders = allPurchaseOrders;
    const branchPurchaseOrders = purchaseOrders.filter(
      (order) => order.branchId === activeBranchId,
    );
    const confirmedReceipts = receipts.filter(
      (receipt) =>
        Boolean(activeBranchId && tenantId) &&
        receipt.branchId === activeBranchId &&
        receipt.tenantId === tenantId &&
        (receipt.status === ReceiptStatus.partial || receipt.status === ReceiptStatus.received),
    );
    const confirmedReceiptIds = new Set(confirmedReceipts.map((receipt) => receipt.id));
    const [receiptLines, allIncidents] = await Promise.all([
      Promise.all(
        confirmedReceipts.map((receipt) =>
          this.repositories.receipts.getLinesByReceipt(receipt.id),
        ),
      ).then((lines) => lines.flat()),
      this.repositories.receipts.getIncidents(),
    ]);
    const incidents = buildIncidentListItems({
      incidents: allIncidents.filter((incident) => confirmedReceiptIds.has(incident.receiptId)),
      receipts: confirmedReceipts,
      receiptLines,
      incidentTypes: tenantId
        ? incidentTypes.filter((incidentType) => incidentType.tenantId === tenantId)
        : [],
      products,
      purchaseOrders: branchPurchaseOrders,
      suppliers,
      branches,
      users,
    });

    const productById = new Map(products.map((product) => [product.id, product]));
    const unitById = new Map(units.map((unit) => [unit.id, unit]));

    const supplierItems = await Promise.all(
      suppliers.map(async (supplier) => {
        const supplierProducts = await this.repositories.supplierProducts.getBySupplier(
          supplier.id,
        );
        const productsWithCosts = await Promise.all(
          supplierProducts.map((supplierProduct) =>
            this.toSupplierProductReadModel(supplierProduct, productById, unitById),
          ),
        );
        return this.toSupplierReadModel(
          supplier,
          productsWithCosts,
          branchPurchaseOrders.filter((order) => order.supplierId === supplier.id),
          incidents.filter((incident) => incident.supplierId === supplier.id),
        );
      }),
    );

    return {
      suppliers: supplierItems.sort((left, right) => left.name.localeCompare(right.name)),
    };
  }

  /**
   * API: listado informativo paginado en servidor (page base 1). Sin fetch-all, sin N+1 y sin
   * lecturas de productos/usuarios/sucursales: solo GET /purchasing/suppliers.
   */
  async executeApiPage(params: {
    status?: SupplierStatus;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<PaginatedResult<SupplierListItemReadModel>> {
    const { permissions } = await resolvePurchasingContext(this.repositories);
    ensureCanReadPurchaseOrders(permissions);
    const result = await this.repositories.suppliers.getOperationalPage(params);
    return { ...result, items: result.items.map((supplier) => toApiSupplierReadModel(supplier)) };
  }

  /** API: detalle bajo demanda al abrir el panel; nunca por cada fila. */
  async getApiDetail(supplierId: string): Promise<SupplierListItemReadModel> {
    const { permissions } = await resolvePurchasingContext(this.repositories);
    ensureCanReadPurchaseOrders(permissions);
    const detail = await this.repositories.suppliers.getOperationalById(supplierId);
    if (!detail) throw new Error("Proveedor no encontrado.");
    return toApiSupplierReadModel(detail);
  }

  /** API: productos del proveedor (on-demand al abrir la pestana; paginado en servidor). */
  async getApiProducts(
    supplierId: string,
    params: OperationalSupplierProductPageParams,
  ): Promise<PaginatedResult<OperationalSupplierProduct>> {
    const { permissions } = await resolvePurchasingContext(this.repositories);
    ensureCanReadPurchaseOrders(permissions);
    return this.repositories.suppliers.getOperationalProducts(supplierId, params);
  }

  /** API: incidencias del proveedor (on-demand al abrir la pestana; paginado en servidor). */
  async getApiIncidents(
    supplierId: string,
    params: OperationalSupplierIncidentPageParams,
  ): Promise<PaginatedResult<OperationalSupplierIncident>> {
    const { permissions } = await resolvePurchasingContext(this.repositories);
    ensureCanReadPurchaseOrders(permissions);
    return this.repositories.suppliers.getOperationalIncidents(supplierId, params);
  }

  /** API: ordenes recientes del proveedor (una pagina de GET /purchasing/orders?supplierId). */
  async getApiPurchaseOrders(
    supplierId: string,
    branchId?: string,
  ): Promise<SupplierPurchaseOrderReadModel[]> {
    const { tenantId, permissions } = await resolvePurchasingContext(this.repositories);
    ensureCanReadPurchaseOrders(permissions);
    const page = await this.repositories.purchaseOrders.getPageScoped(tenantId, {
      supplierId,
      ...(branchId ? { branchId } : {}),
      page: 1,
      pageSize: 10,
    });
    return page.items.map((order) => ({
      id: order.id,
      number: order.number,
      createdAt: order.createdAt,
      expectedDate: order.expectedDate,
      total: order.total,
      status: order.status,
    }));
  }

  private async toSupplierProductReadModel(
    supplierProduct: SupplierProduct,
    productById: Map<string, Product>,
    unitById: Map<string, Unit>,
  ): Promise<SupplierProductReadModel> {
    const product = productById.get(supplierProduct.productId);
    const unit = unitById.get(supplierProduct.purchaseUnitId);
    const costTiers = await this.repositories.supplierProducts.getCostTiers(supplierProduct.id);

    return {
      id: supplierProduct.id,
      productName: product?.name ?? "Producto no disponible",
      productSku: product?.sku ?? supplierProduct.productId,
      supplierSku: supplierProduct.supplierSku,
      purchaseUnitLabel: unit?.symbol ?? unit?.name ?? supplierProduct.purchaseUnitId,
      minimumOrderQuantity: supplierProduct.minimumOrderQuantity,
      lastCost: supplierProduct.lastCost,
      leadTimeDays: supplierProduct.leadTimeDays,
      preferred: supplierProduct.preferred,
      active: supplierProduct.active,
      costTiers: this.sortCostTiers(costTiers),
    };
  }

  private toSupplierReadModel(
    supplier: Supplier,
    products: SupplierProductReadModel[],
    purchaseOrders: PurchaseOrder[],
    incidents: SupplierIncidentReadModel[],
  ): SupplierListItemReadModel {
    const contacts = this.getContacts(supplier);
    const deliveryLabel =
      typeof supplier.leadTimeDays === "number" ? `${supplier.leadTimeDays} dias` : "Sin plazo";
    const purchaseOrderItems = purchaseOrders
      .map((order) => ({
        id: order.id,
        number: order.number,
        createdAt: order.createdAt,
        expectedDate: order.expectedDate,
        total: order.total,
        status: order.status,
      }))
      .sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
      );

    return {
      id: supplier.id,
      name: supplier.name,
      legalName: supplier.legalName,
      taxId: supplier.taxId,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      notes: supplier.notes,
      status: supplier.status,
      archived: supplier.status === SupplierStatus.archived,
      paymentConditionLabel: "No definido",
      creditDaysLabel: "No definido",
      currencyLabel: "No definido",
      deliveryLabel,
      searchText: [
        supplier.name,
        supplier.legalName,
        supplier.taxId,
        supplier.email,
        supplier.phone,
        supplier.address,
        ...contacts.flatMap((contact) => [
          contact.name,
          contact.role,
          contact.phone,
          contact.email,
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
      contacts,
      products,
      purchaseOrders: purchaseOrderItems,
      incidents,
    };
  }

  private getContacts(supplier: Supplier): SupplierContactReadModel[] {
    if (!supplier.email && !supplier.phone) return [];
    return [
      {
        id: `${supplier.id}-main-contact`,
        name: supplier.name,
        role: "Contacto principal",
        phone: supplier.phone,
        email: supplier.email,
        primary: true,
      },
    ];
  }

  private sortCostTiers(costTiers: SupplierCostTier[]) {
    return [...costTiers]
      .map((tier) => ({
        id: tier.id,
        minQuantity: tier.minQuantity,
        unitCost: tier.unitCost,
      }))
      .sort((left, right) => left.minQuantity - right.minQuantity);
  }
}

/** Solo datos reales del backend; condicion de pago, credito y moneda no existen y no se inventan. */
function toApiSupplierReadModel(
  supplier: OperationalSupplierSummary | OperationalSupplierDetail,
): SupplierListItemReadModel {
  const detail = supplier as Partial<OperationalSupplierDetail>;
  return {
    id: supplier.id,
    name: supplier.name,
    legalName: supplier.legalName,
    taxId: supplier.taxId,
    email: supplier.email,
    phone: supplier.phone,
    address: detail.address,
    notes: detail.notes,
    status: supplier.status,
    archived: supplier.status === SupplierStatus.archived,
    paymentConditionLabel: "",
    creditDaysLabel: "",
    currencyLabel: "",
    deliveryLabel:
      typeof supplier.leadTimeDays === "number" ? `${supplier.leadTimeDays} dias` : "Sin plazo",
    searchText: "",
    contacts: [],
    products: [],
    purchaseOrders: [],
    incidents: [],
  };
}
