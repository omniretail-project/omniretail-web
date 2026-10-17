import { DeliveryMethod } from "@/core/enums";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { ReturnSaleLookupDto } from "@/modules/pos/application/dto/ReturnSaleLookupDto";
import { requirePosApi } from "@/modules/pos/application/services/posServiceContext";
import {
  requireReturnOperationContext,
  type ReturnOperationContext,
} from "@/modules/pos/application/services/returnOperationContext";

export interface GetReturnSaleLookupInput extends ReturnOperationContext {
  documentNumber: string;
}

export class GetReturnSaleLookupService {
  constructor(private readonly repositories: RepositoryRegistry) {}

  async execute(input: GetReturnSaleLookupInput): Promise<ReturnSaleLookupDto | null> {
    const context = await requireReturnOperationContext(
      this.repositories,
      input,
      "pos.returns.read",
    );
    const documentNumber = input.documentNumber.trim();
    if (!documentNumber) throw new Error("El numero de documento es requerido.");
    if (this.repositories.posDataSource === "api") {
      const eligibility = await requirePosApi(this.repositories).getReturnEligibility(
        context.branchId,
        documentNumber,
      );
      if (!eligibility) return null;
      const items = eligibility.items.map((item) => ({ ...item }));
      const payments = eligibility.payments.map((payment) => ({
        paymentId: payment.id,
        method: payment.method,
        amount: payment.amount,
        status: payment.status,
      }));
      return {
        sale: {
          saleId: eligibility.sale.id,
          documentNumber: eligibility.sale.documentNumber,
          date: eligibility.sale.createdAt,
          customerDisplayName: eligibility.sale.customerDisplayName,
          total: eligibility.sale.total,
          status: eligibility.sale.status,
        },
        items,
        payments,
        returnableItems: items.filter((item) => item.canReturn),
        paymentSummary: payments.map((payment) => payment.method).join(" + "),
        isWithinCurrentShift: eligibility.originalCashShiftOpen,
        allowedOperations: eligibility.allowedOperations,
      };
    }
    const sale = await this.repositories.sales.getByDocumentNumber(
      context.tenantId,
      context.branchId,
      documentNumber,
    );
    if (!sale) return null;
    const inspection = await this.repositories.saleReversals.inspect({
      tenantId: context.tenantId,
      branchId: context.branchId,
      actorUserId: context.actorUserId,
      saleId: sale.id,
    });
    const sourceOrderId = sale.sourceOrderId?.trim();
    const sourceOrders = sourceOrderId
      ? await this.repositories.orders.getByIdsScoped(context.tenantId, context.branchId, [
          sourceOrderId,
        ])
      : [];
    const returnBlockedNotice = getReturnBlockedNotice(
      sourceOrders[0]?.deliveryMethod ?? DeliveryMethod.immediate,
      inspection.partialReturnAllowed,
      inspection.items,
    );
    const itemInspection = new Map(inspection.items.map((item) => [item.saleItemId, item]));
    const items = inspection.sale.items.map((item) => {
      const state = itemInspection.get(item.id);
      if (!state) throw new Error(`No se pudo derivar la linea retornable: ${item.id}`);
      return {
        saleItemId: item.id,
        productId: item.productId,
        sku: item.skuSnapshot,
        name: item.nameSnapshot,
        soldQuantity: item.quantity,
        returnedQuantity: state.returnedQuantity,
        returnableQuantity: state.returnableQuantity,
        unitPrice: item.unitPrice,
        discount: item.discount,
        subtotal: item.subtotal,
        canReturn: state.isSafelyReversible && state.returnableQuantity > 0,
        blockedReason: returnBlockedNotice ? undefined : state.blockedReason,
      };
    });
    const refunds = new Map<string, number>();
    inspection.refunds.forEach((refund) => {
      refunds.set(
        refund.paymentId,
        roundMoney((refunds.get(refund.paymentId) ?? 0) + refund.amount),
      );
    });
    const payments = inspection.payments.map((payment) => {
      const refundedAmount = refunds.get(payment.id) ?? 0;
      return {
        paymentId: payment.id,
        method: payment.method,
        amount: payment.amount,
        refundedAmount,
        refundableAmount: Math.max(0, roundMoney(payment.amount - refundedAmount)),
        status: payment.status,
      };
    });
    return {
      sale: {
        saleId: inspection.sale.id,
        documentNumber: inspection.sale.number,
        date: inspection.sale.createdAt,
        customerDisplayName: inspection.customerDisplayName,
        total: inspection.sale.total,
        status: inspection.sale.status,
      },
      items,
      payments,
      returnableItems: items.filter((item) => item.canReturn),
      paymentSummary: payments.map((payment) => payment.method).join(" + "),
      isWithinCurrentShift: inspection.isWithinCurrentShift,
      allowedOperations: {
        voidTotal: inspection.voidAllowed,
        partialReturn: inspection.partialReturnAllowed,
        voidBlockedReason: inspection.voidBlockedReason,
        returnBlockedReason: returnBlockedNotice ?? inspection.returnBlockedReason,
      },
    };
  }
}

export function getReturnBlockedNotice(
  deliveryMethod: DeliveryMethod,
  partialReturnAllowed: boolean,
  items: Array<{ returnableQuantity: number; isSafelyReversible: boolean }>,
) {
  if (!partialReturnAllowed && deliveryMethod === DeliveryMethod.store_pickup) {
    return "Esta venta no admite devoluciones porque fue realizada con retiro en tienda.";
  }
  if (!partialReturnAllowed && deliveryMethod === DeliveryMethod.home_delivery) {
    return "Esta venta no admite devoluciones porque fue realizada con envío a domicilio.";
  }
  const hasUnsafeReturnableInventory = items.some(
    (item) => item.returnableQuantity > 0 && !item.isSafelyReversible,
  );
  const hasSafelyReturnableInventory = items.some(
    (item) => item.returnableQuantity > 0 && item.isSafelyReversible,
  );
  if (!partialReturnAllowed && hasUnsafeReturnableInventory && !hasSafelyReturnableInventory) {
    return "No es posible procesar la devolución porque no se puede validar de forma segura el movimiento de inventario de esta venta.";
  }
  return undefined;
}

export function isReturnBlockedNotice(reason?: string) {
  return (
    reason === "Esta venta no admite devoluciones porque fue realizada con retiro en tienda." ||
    reason === "Esta venta no admite devoluciones porque fue realizada con envío a domicilio." ||
    reason ===
      "No es posible procesar la devolución porque no se puede validar de forma segura el movimiento de inventario de esta venta."
  );
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
