import type {
  Branch,
  IncidentType,
  Product,
  PurchaseOrder,
  Receipt,
  ReceiptIncident,
  ReceiptLine,
  Supplier,
  User,
} from "@/core/entities";
import { ReceiptStatus } from "@/core/enums";
import type { IncidentListItemViewModel } from "@/modules/receiving/application/dto/IncidentListItemViewModel";

interface IncidentListItemSources {
  incidents: ReceiptIncident[];
  receipts: Receipt[];
  receiptLines: ReceiptLine[];
  incidentTypes: IncidentType[];
  products: Product[];
  purchaseOrders: PurchaseOrder[];
  suppliers: Supplier[];
  branches: Branch[];
  users: User[];
}

export function buildIncidentListItems({
  incidents,
  receipts,
  receiptLines,
  incidentTypes,
  products,
  purchaseOrders,
  suppliers,
  branches,
  users,
}: IncidentListItemSources): IncidentListItemViewModel[] {
  const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const receiptLineById = new Map(receiptLines.map((line) => [line.id, line]));
  const incidentTypeById = new Map(incidentTypes.map((type) => [type.id, type]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const purchaseOrderById = new Map(purchaseOrders.map((order) => [order.id, order]));
  const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const branchById = new Map(branches.map((branch) => [branch.id, branch]));
  const userById = new Map(users.map((user) => [user.id, user]));

  return incidents
    .flatMap((incident) => {
      const receipt = receiptById.get(incident.receiptId);
      if (!receipt) return [];

      const receiptLine = incident.receiptLineId
        ? receiptLineById.get(incident.receiptLineId)
        : undefined;
      const product = receiptLine ? productById.get(receiptLine.productId) : undefined;
      const purchaseOrder = receipt.purchaseOrderId
        ? purchaseOrderById.get(receipt.purchaseOrderId)
        : undefined;
      const supplierId = purchaseOrder?.supplierId;
      const supplier = supplierById.get(supplierId ?? receipt.supplierId ?? "");

      return [
        {
          id: incident.id,
          receiptId: receipt.id,
          receiptNumber: receipt.number,
          ...(purchaseOrder
            ? {
                purchaseOrderId: purchaseOrder.id,
                purchaseOrderNumber: purchaseOrder.number,
              }
            : {}),
          productName: product?.name ?? "Producto no disponible",
          sku: product?.sku ?? "No disponible",
          ...(supplierId ? { supplierId } : {}),
          ...(supplier ? { supplierName: supplier.name } : {}),
          ...(branchById.get(receipt.branchId)
            ? { branchName: branchById.get(receipt.branchId)?.name }
            : {}),
          typeName: incidentTypeById.get(incident.incidentTypeId)?.name ?? "Tipo archivado",
          ...(typeof incident.quantityAffected === "number"
            ? { quantityAffected: incident.quantityAffected }
            : {}),
          observation: incident.description,
          date: incident.createdAt,
          ...(userById.get(incident.createdByUserId)
            ? { responsibleName: userById.get(incident.createdByUserId)?.name }
            : {}),
          evidence: incident.evidence ?? [],
          confirmed:
            receipt.status === ReceiptStatus.partial || receipt.status === ReceiptStatus.received,
        },
      ];
    })
    .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
}
