import type {
  CashMovement,
  CreditNote,
  InventoryMovement,
  Payment,
  RefundTransaction,
  ReturnLine,
  ReturnRequest,
  Sale,
  SaleItem,
  SaleVoid,
} from "@/core/entities";
import {
  CashMovementType,
  CashShiftStatus,
  InventoryMovementType,
  PaymentMethod,
  PaymentStatus,
  ProductType,
  ReturnStatus,
  SaleStatus,
  UserStatus,
  UserType,
} from "@/core/enums";
import type {
  InspectSaleReversalInput,
  ProcessSaleReturnInput,
  SaleReversalInspection,
  SaleReversalRepository,
  SaleReversalResult,
  VoidSaleInput,
} from "@/core/repositories";
import type { DataEventName, DataEventPayload } from "@/core/types/events.types";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";
import { registerCashMovementInTransaction } from "@/infrastructure/mock/repositories/cashMovementMutations";

type ReversalReference = { referenceType: "return" | "void"; referenceId: string };
type PlannedInventoryReturn = {
  productId: string;
  quantity: number;
  toLocationId?: string;
};

export class MockSaleReversalRepository
  extends BaseMockRepository
  implements SaleReversalRepository
{
  async inspect(input: InspectSaleReversalInput): Promise<SaleReversalInspection> {
    return this.read((db) => this.inspectInDatabase(input, db));
  }

  async processReturn(input: ProcessSaleReturnInput): Promise<SaleReversalResult> {
    const normalized = normalizeReturnInput(input);
    const fingerprint = returnFingerprint(normalized);
    const result = this.store.transact((db) => {
      const existing = db.returnRequests.find(
        (item) =>
          item.tenantId === normalized.tenantId &&
          item.idempotencyKey === normalized.idempotencyKey,
      );
      if (existing) {
        if (existing.operationFingerprint !== fingerprint) {
          throw new Error("La clave de idempotencia de devolucion ya fue usada con otro payload.");
        }
        return this.rebuildReturnResult(existing, db);
      }

      assertActorAndBranch(normalized, db);
      const sale = requireScopedSale(normalized, db);
      if (db.saleVoids.some((item) => item.saleId === sale.id)) {
        throw new Error("Una venta anulada no admite devoluciones.");
      }
      if (sale.status !== SaleStatus.completed && sale.status !== SaleStatus.partially_returned) {
        throw new Error("El estado de la venta no admite devoluciones.");
      }

      const completedReturns = getCompletedReturns(sale.id, db);
      const lines = this.buildReturnLines(normalized, sale, completedReturns, db);
      const refundTotalCents = lines.reduce((sum, line) => sum + toCents(line.amount), 0);
      const paymentPlan = planRefunds(sale, refundTotalCents, db);
      const currentShift = requireCashShiftForRefund(normalized, paymentPlan, db);
      const inventoryPlan = this.planInventoryReturns(sale, lines, db);
      const now = this.now();
      const returnId = this.id("return");
      const returnLines = lines.map<ReturnLine>((line) => ({
        ...line,
        id: this.id("return-line"),
        returnId,
      }));
      const request: ReturnRequest = {
        id: returnId,
        tenantId: normalized.tenantId,
        branchId: normalized.branchId,
        saleId: sale.id,
        status: ReturnStatus.completed,
        reason: normalized.reason,
        createdByUserId: normalized.actorUserId,
        processedByUserId: normalized.actorUserId,
        createdAt: now,
        processedAt: now,
        updatedAt: now,
        idempotencyKey: normalized.idempotencyKey,
        operationFingerprint: fingerprint,
        refundTotal: fromCents(refundTotalCents),
        lines: returnLines,
      };
      const reference: ReversalReference = { referenceType: "return", referenceId: request.id };
      const refunds = applyRefunds(paymentPlan, normalized, reference, now, db, () =>
        this.id("refund"),
      );
      const inventoryMovements = this.applyInventoryReturns(
        inventoryPlan,
        normalized,
        reference,
        `Devolucion ${sale.number}`,
        now,
        db,
      );
      const cashMovement = createCashMovement(
        refunds,
        currentShift?.id,
        normalized,
        reference,
        `Devolucion ${sale.number}`,
        now,
        db,
        () => this.id("cash-movement"),
      );
      const allReturns = [...completedReturns, request];
      sale.status = isFullyReturned(sale, allReturns)
        ? SaleStatus.returned
        : SaleStatus.partially_returned;
      sale.updatedAt = now;
      const creditNote = createCreditNote(
        sale,
        request.refundTotal,
        normalized,
        { returnId: request.id },
        now,
        db,
        () => this.id("credit-note"),
      );

      db.returnRequests.push(request);
      db.refundTransactions.push(...refunds);
      db.inventoryMovements.push(...inventoryMovements);
      db.creditNotes.push(creditNote);
      return {
        sale,
        returnRequest: request,
        refunds,
        inventoryMovements,
        cashMovement,
        creditNote,
        idempotent: false,
      };
    });
    if (!result.idempotent) this.emitAfterCommit("sale.returned", result);
    return result;
  }

  async voidSale(input: VoidSaleInput): Promise<SaleReversalResult> {
    const normalized = normalizeVoidInput(input);
    const fingerprint = voidFingerprint(normalized);
    const result = this.store.transact((db) => {
      const existing = db.saleVoids.find(
        (item) =>
          item.tenantId === normalized.tenantId &&
          item.idempotencyKey === normalized.idempotencyKey,
      );
      if (existing) {
        if (existing.operationFingerprint !== fingerprint) {
          throw new Error("La clave de idempotencia de anulacion ya fue usada con otro payload.");
        }
        return this.rebuildVoidResult(existing, db);
      }

      assertActorAndBranch(normalized, db);
      const sale = requireScopedSale(normalized, db);
      if (sale.status !== SaleStatus.completed) {
        throw new Error("Solo una venta completada puede anularse.");
      }
      if (sale.items.length === 0 || toCents(sale.total) <= 0) {
        throw new Error("La venta no contiene un importe positivo reversible.");
      }
      if (getCompletedReturns(sale.id, db).length > 0) {
        throw new Error("Una venta con devoluciones previas no puede anularse.");
      }
      if (db.saleVoids.some((item) => item.saleId === sale.id)) {
        throw new Error("La venta ya fue anulada.");
      }
      const currentShift = requireCurrentShift(normalized, db);
      if (sale.cashShiftId !== currentShift.id) {
        throw new Error("La anulacion POS solo esta permitida dentro del turno original abierto.");
      }

      const saleLines = sale.items.map((item) => ({
        saleItemId: item.id,
        productId: item.productId,
        quantity: item.quantity,
        amount: fromCents(toCents(item.subtotal)),
      }));
      const inventoryPlan = this.planInventoryReturns(sale, saleLines, db);
      const paymentPlan = planRefunds(sale, toCents(sale.total), db);
      const now = this.now();
      const voidRecord: SaleVoid = {
        id: this.id("sale-void"),
        tenantId: normalized.tenantId,
        branchId: normalized.branchId,
        saleId: sale.id,
        reason: normalized.reason,
        createdByUserId: normalized.actorUserId,
        createdAt: now,
        idempotencyKey: normalized.idempotencyKey,
        operationFingerprint: fingerprint,
        refundTotal: fromCents(toCents(sale.total)),
      };
      const reference: ReversalReference = { referenceType: "void", referenceId: voidRecord.id };
      const refunds = applyRefunds(paymentPlan, normalized, reference, now, db, () =>
        this.id("refund"),
      );
      const inventoryMovements = this.applyInventoryReturns(
        inventoryPlan,
        normalized,
        reference,
        `Anulacion ${sale.number}`,
        now,
        db,
      );
      const cashMovement = createCashMovement(
        refunds,
        currentShift.id,
        normalized,
        reference,
        `Anulacion ${sale.number}`,
        now,
        db,
        () => this.id("cash-movement"),
      );
      sale.status = SaleStatus.cancelled;
      sale.updatedAt = now;
      const creditNote = createCreditNote(
        sale,
        voidRecord.refundTotal,
        normalized,
        { voidId: voidRecord.id },
        now,
        db,
        () => this.id("credit-note"),
      );

      db.saleVoids.push(voidRecord);
      db.refundTransactions.push(...refunds);
      db.inventoryMovements.push(...inventoryMovements);
      db.creditNotes.push(creditNote);
      return {
        sale,
        void: voidRecord,
        refunds,
        inventoryMovements,
        cashMovement,
        creditNote,
        idempotent: false,
      };
    });
    if (!result.idempotent) this.emitAfterCommit("sale.voided", result);
    return result;
  }

  private inspectInDatabase(
    input: InspectSaleReversalInput,
    db: MockDatabase,
  ): SaleReversalInspection {
    assertActorAndBranch(input, db);
    const sale = requireScopedSale(input, db);
    const completedReturns = getCompletedReturns(sale.id, db);
    const returnedByItem = getReturnedQuantityByItem(completedReturns);
    const items = sale.items.map((item) => {
      const product = db.products.find(
        (candidate) => candidate.id === item.productId && candidate.tenantId === input.tenantId,
      );
      if (!product) throw new Error(`Producto historico no encontrado: ${item.productId}`);
      const returnedQuantity = returnedByItem.get(item.id) ?? 0;
      const isSafelyReversible = isItemSafelyReversible(
        sale,
        item.productId,
        product.productType,
        product.tracking,
        db,
      );
      return {
        saleItemId: item.id,
        productId: item.productId,
        soldQuantity: item.quantity,
        returnedQuantity,
        returnableQuantity: Math.max(0, item.quantity - returnedQuantity),
        productType: product.productType,
        tracking: product.tracking,
        isSafelyReversible,
        blockedReason: isSafelyReversible
          ? undefined
          : getItemBlockedReason(product.productType, product.tracking),
      };
    });
    const shift = db.cashShifts.find(
      (item) =>
        item.id === sale.cashShiftId &&
        item.tenantId === input.tenantId &&
        item.branchId === input.branchId &&
        item.userId === input.actorUserId &&
        item.status === CashShiftStatus.open,
    );
    const isWithinCurrentShift = Boolean(shift);
    const actorOpenShift = db.cashShifts.find(
      (item) =>
        item.tenantId === input.tenantId &&
        item.branchId === input.branchId &&
        item.userId === input.actorUserId &&
        item.status === CashShiftStatus.open,
    );
    const hasPriorReturns = completedReturns.length > 0;
    const alreadyVoided = db.saleVoids.some((item) => item.saleId === sale.id);
    const refunds = db.refundTransactions.filter(
      (refund) =>
        refund.tenantId === input.tenantId &&
        refund.branchId === input.branchId &&
        refund.saleId === sale.id,
    );
    const refundedByPayment = new Map<string, number>();
    refunds.forEach((refund) => {
      refundedByPayment.set(
        refund.paymentId,
        (refundedByPayment.get(refund.paymentId) ?? 0) + toCents(refund.amount),
      );
    });
    const payments = db.payments.filter(
      (payment) => payment.tenantId === input.tenantId && payment.saleId === sale.id,
    );
    const refundablePayments = payments.map((payment) => ({
      payment,
      cents: Math.max(0, toCents(payment.amount) - (refundedByPayment.get(payment.id) ?? 0)),
    }));
    const refundableCents = refundablePayments.reduce((sum, item) => sum + item.cents, 0);
    const hasInvalidPayment = refundablePayments.some(
      (item) => item.cents > 0 && item.payment.status !== PaymentStatus.approved,
    );
    const cashRefundNeedsShift = refundablePayments.some(
      (item) => item.cents > 0 && item.payment.method === PaymentMethod.cash,
    );
    const safeItems = items.filter(
      (item) => item.returnableQuantity > 0 && item.isSafelyReversible,
    );
    const partialReturnAllowed =
      !alreadyVoided &&
      (sale.status === SaleStatus.completed || sale.status === SaleStatus.partially_returned) &&
      safeItems.length > 0 &&
      refundableCents > 0 &&
      !hasInvalidPayment &&
      (!cashRefundNeedsShift || Boolean(actorOpenShift));
    const voidAllowed =
      !alreadyVoided &&
      sale.status === SaleStatus.completed &&
      !hasPriorReturns &&
      isWithinCurrentShift &&
      toCents(sale.total) > 0 &&
      items.length > 0 &&
      !hasInvalidPayment &&
      refundableCents === toCents(sale.total) &&
      items.every((item) =>
        isItemSafelyReversible(sale, item.productId, item.productType, item.tracking, db),
      );
    const customer = sale.customerId
      ? db.customers.find((item) => item.id === sale.customerId && item.tenantId === input.tenantId)
      : null;
    return {
      sale,
      payments,
      refunds,
      customerDisplayName: customer?.name ?? "Consumidor final",
      items,
      isWithinCurrentShift,
      voidAllowed,
      partialReturnAllowed,
      voidBlockedReason: voidAllowed
        ? undefined
        : getVoidBlockedReason(
            sale,
            hasPriorReturns,
            alreadyVoided,
            isWithinCurrentShift,
            refundableCents,
            hasInvalidPayment,
            items,
            db,
          ),
      returnBlockedReason: partialReturnAllowed
        ? undefined
        : getReturnBlockedReason(
            sale,
            alreadyVoided,
            refundableCents,
            hasInvalidPayment,
            cashRefundNeedsShift,
            Boolean(actorOpenShift),
            items,
            db,
          ),
    };
  }

  private buildReturnLines(
    input: ProcessSaleReturnInput,
    sale: Sale,
    completedReturns: ReturnRequest[],
    db: MockDatabase,
  ): Array<Omit<ReturnLine, "id" | "returnId">> {
    const returnedByItem = getReturnedQuantityByItem(completedReturns);
    const refundedByItem = getRefundedAmountByItem(completedReturns);
    const seen = new Set<string>();
    return input.lines.map((line) => {
      if (seen.has(line.saleItemId)) throw new Error("No se permiten lineas duplicadas.");
      seen.add(line.saleItemId);
      if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
        throw new Error("La cantidad a devolver debe ser mayor que cero.");
      }
      const saleItem = sale.items.find((item) => item.id === line.saleItemId);
      if (!saleItem) throw new Error(`La linea no pertenece a la venta: ${line.saleItemId}`);
      const returnedQuantity = returnedByItem.get(saleItem.id) ?? 0;
      const returnableQuantity = saleItem.quantity - returnedQuantity;
      if (line.quantity > returnableQuantity) {
        throw new Error(`La cantidad excede el remanente retornable de ${saleItem.nameSnapshot}.`);
      }
      assertItemSafelyReversible(sale, saleItem, db);
      const previousAmountCents = refundedByItem.get(saleItem.id) ?? 0;
      const cumulativeQuantity = returnedQuantity + line.quantity;
      const cumulativeAmountCents = Math.round(
        (toCents(saleItem.subtotal) * cumulativeQuantity) / saleItem.quantity,
      );
      const amountCents = cumulativeAmountCents - previousAmountCents;
      if (amountCents <= 0) throw new Error("El refund derivado de la linea no es valido.");
      return {
        saleItemId: saleItem.id,
        productId: saleItem.productId,
        quantity: line.quantity,
        amount: fromCents(amountCents),
      };
    });
  }

  private planInventoryReturns(
    sale: Sale,
    lines: Array<Pick<ReturnLine, "productId" | "quantity">>,
    db: MockDatabase,
  ): PlannedInventoryReturn[] {
    const requestedByProduct = new Map<string, number>();
    lines.forEach((line) => {
      const product = db.products.find(
        (item) => item.id === line.productId && item.tenantId === sale.tenantId,
      );
      if (!product) throw new Error(`Producto historico no encontrado: ${line.productId}`);
      if (product.productType === ProductType.service || !product.tracking.stock) return;
      requestedByProduct.set(
        line.productId,
        (requestedByProduct.get(line.productId) ?? 0) + line.quantity,
      );
    });

    const plan: PlannedInventoryReturn[] = [];
    requestedByProduct.forEach((requestedQuantity, productId) => {
      const original = db.inventoryMovements.filter(
        (movement) =>
          movement.tenantId === sale.tenantId &&
          movement.branchId === sale.branchId &&
          movement.productId === productId &&
          movement.type === InventoryMovementType.out &&
          movement.referenceType === "sale" &&
          movement.referenceId === sale.id &&
          !movement.lotId &&
          !movement.serialNumberId,
      );
      const reversedByLocation = getReversedQuantityByLocation(sale.id, productId, db);
      let remaining = requestedQuantity;
      original.forEach((movement) => {
        if (remaining <= 0) return;
        const locationKey = movement.fromLocationId ?? "";
        const alreadyReversed = reversedByLocation.get(locationKey) ?? 0;
        const usedBefore = original
          .slice(0, original.indexOf(movement))
          .filter((item) => (item.fromLocationId ?? "") === locationKey)
          .reduce((sum, item) => sum + item.quantity, 0);
        const available = Math.max(
          0,
          movement.quantity - Math.max(0, alreadyReversed - usedBefore),
        );
        const quantity = Math.min(remaining, available);
        if (quantity > 0) {
          plan.push({ productId, quantity, toLocationId: movement.fromLocationId });
          remaining -= quantity;
        }
      });
      if (remaining > 0) {
        throw new Error("No existe una huella historica suficiente para revertir inventario.");
      }
    });
    return plan;
  }

  private applyInventoryReturns(
    plan: PlannedInventoryReturn[],
    input: Pick<ProcessSaleReturnInput, "tenantId" | "branchId" | "actorUserId">,
    reference: ReversalReference,
    reason: string,
    now: string,
    db: MockDatabase,
  ): InventoryMovement[] {
    return plan.map((planned) => {
      let balance = db.inventoryBalances.find(
        (item) =>
          item.tenantId === input.tenantId &&
          item.branchId === input.branchId &&
          item.productId === planned.productId &&
          item.locationId === planned.toLocationId,
      );
      if (!balance) {
        balance = {
          id: this.id("balance"),
          tenantId: input.tenantId,
          branchId: input.branchId,
          productId: planned.productId,
          locationId: planned.toLocationId,
          quantity: 0,
          reservedQuantity: 0,
          updatedAt: now,
        };
        db.inventoryBalances.push(balance);
      }
      const quantityBefore = balance.quantity;
      balance.quantity += planned.quantity;
      balance.updatedAt = now;
      return {
        id: this.id("movement"),
        tenantId: input.tenantId,
        branchId: input.branchId,
        productId: planned.productId,
        type: InventoryMovementType.in,
        reason,
        quantity: planned.quantity,
        quantityBefore,
        quantityAfter: balance.quantity,
        toLocationId: planned.toLocationId,
        ...reference,
        performedByUserId: input.actorUserId,
        createdAt: now,
      };
    });
  }

  private rebuildReturnResult(request: ReturnRequest, db: MockDatabase): SaleReversalResult {
    return rebuildResult({ returnRequest: request }, db);
  }

  private rebuildVoidResult(voidRecord: SaleVoid, db: MockDatabase): SaleReversalResult {
    return rebuildResult({ void: voidRecord }, db);
  }

  private emitAfterCommit(event: "sale.returned" | "sale.voided", result: SaleReversalResult) {
    this.emitSafely(event, {
      entityId: result.sale.id,
      tenantId: result.sale.tenantId,
      branchId: result.sale.branchId,
      action: "status_changed",
    });
    this.emitSafely("sale.changed", {
      entityId: result.sale.id,
      tenantId: result.sale.tenantId,
      branchId: result.sale.branchId,
      action: "status_changed",
    });
    result.refunds.forEach((refund) =>
      this.emitSafely("payment.changed", {
        entityId: refund.paymentId,
        tenantId: refund.tenantId,
        branchId: refund.branchId,
        action: "status_changed",
      }),
    );
    result.inventoryMovements.forEach((movement) => {
      this.emitSafely("inventory.changed", {
        entityId: movement.id,
        tenantId: movement.tenantId,
        branchId: movement.branchId,
        productId: movement.productId,
        action: "created",
      });
      this.emitSafely("stock.changed", {
        tenantId: movement.tenantId,
        branchId: movement.branchId,
        productId: movement.productId,
        action: "updated",
      });
    });
    if (result.cashMovement) {
      this.emitSafely("cash-shift.changed", {
        entityId: result.cashMovement.cashShiftId,
        tenantId: result.sale.tenantId,
        branchId: result.sale.branchId,
        action: "updated",
      });
    }
  }

  private emitSafely(event: DataEventName, payload: DataEventPayload) {
    try {
      this.emit(event, payload);
    } catch {
      // Persistence already committed; listeners only trigger canonical re-queries.
    }
  }
}

function normalizeReturnInput(input: ProcessSaleReturnInput): ProcessSaleReturnInput {
  const normalized = {
    ...input,
    tenantId: input.tenantId.trim(),
    branchId: input.branchId.trim(),
    saleId: input.saleId.trim(),
    actorUserId: input.actorUserId.trim(),
    idempotencyKey: input.idempotencyKey.trim(),
    reason: input.reason.trim(),
    lines: input.lines.map((line) => ({ ...line, saleItemId: line.saleItemId.trim() })),
  };
  assertCommonInput(normalized);
  if (normalized.lines.length === 0) throw new Error("La devolucion requiere al menos una linea.");
  return normalized;
}

function normalizeVoidInput(input: VoidSaleInput): VoidSaleInput {
  const normalized = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === "string" ? value.trim() : value,
    ]),
  ) as unknown as VoidSaleInput;
  assertCommonInput(normalized);
  return normalized;
}

function assertCommonInput(
  input: Pick<
    ProcessSaleReturnInput,
    "tenantId" | "branchId" | "saleId" | "actorUserId" | "idempotencyKey" | "reason"
  >,
) {
  if (!input.tenantId || !input.branchId || !input.saleId || !input.actorUserId) {
    throw new Error("El contexto tenant, sucursal, venta y actor es requerido.");
  }
  if (!input.idempotencyKey) throw new Error("idempotencyKey es requerido.");
  if (!input.reason) throw new Error("La razon es requerida.");
}

function assertActorAndBranch(
  input: Pick<InspectSaleReversalInput, "tenantId" | "branchId" | "actorUserId">,
  db: MockDatabase,
) {
  const branch = db.branches.find(
    (item) => item.id === input.branchId && item.tenantId === input.tenantId,
  );
  if (!branch) throw new Error("La sucursal no pertenece al tenant.");
  const actor = db.users.find(
    (item) => item.id === input.actorUserId && item.tenantId === input.tenantId,
  );
  if (!actor || actor.type !== UserType.employee || actor.status !== UserStatus.active) {
    throw new Error("El actor no es un empleado activo del tenant.");
  }
}

function requireScopedSale(
  input: Pick<InspectSaleReversalInput, "tenantId" | "branchId" | "saleId">,
  db: MockDatabase,
): Sale {
  const sale = db.sales.find(
    (item) =>
      item.id === input.saleId &&
      item.tenantId === input.tenantId &&
      item.branchId === input.branchId,
  );
  if (!sale) throw new Error("Venta no encontrada para el tenant y sucursal.");
  return sale;
}

function getCompletedReturns(saleId: string, db: MockDatabase) {
  return db.returnRequests.filter(
    (item) => item.saleId === saleId && item.status === ReturnStatus.completed,
  );
}

function getReturnedQuantityByItem(returns: ReturnRequest[]) {
  const result = new Map<string, number>();
  returns
    .flatMap((item) => item.lines)
    .forEach((line) => {
      result.set(line.saleItemId, (result.get(line.saleItemId) ?? 0) + line.quantity);
    });
  return result;
}

function getRefundedAmountByItem(returns: ReturnRequest[]) {
  const result = new Map<string, number>();
  returns
    .flatMap((item) => item.lines)
    .forEach((line) => {
      result.set(line.saleItemId, (result.get(line.saleItemId) ?? 0) + toCents(line.amount));
    });
  return result;
}

function assertItemSafelyReversible(sale: Sale, saleItem: SaleItem, db: MockDatabase) {
  const product = db.products.find(
    (item) => item.id === saleItem.productId && item.tenantId === sale.tenantId,
  );
  if (!product) throw new Error(`Producto historico no encontrado: ${saleItem.productId}`);
  if (product.productType === ProductType.kit) {
    throw new Error("Los kits sin huella historica por linea no pueden revertirse con seguridad.");
  }
  if (product.tracking.lot || product.tracking.serial || product.tracking.expiration) {
    throw new Error(
      "Los productos con lote o serie no pueden revertirse sin trazabilidad explicita.",
    );
  }
  if (
    product.productType === ProductType.physical &&
    product.tracking.stock &&
    !hasSaleInventoryFootprint(sale, product.id, db)
  ) {
    throw new Error("No existe una huella historica suficiente para revertir inventario.");
  }
}

function isItemSafelyReversible(
  sale: Sale,
  productId: string,
  productType: ProductType,
  tracking: { stock: boolean; lot: boolean; serial: boolean; expiration: boolean },
  db: MockDatabase,
) {
  if (productType === ProductType.kit || tracking.lot || tracking.serial || tracking.expiration) {
    return false;
  }
  return (
    productType !== ProductType.physical ||
    !tracking.stock ||
    hasSaleInventoryFootprint(sale, productId, db)
  );
}

function getItemBlockedReason(
  productType: ProductType,
  tracking: { lot: boolean; serial: boolean; expiration: boolean },
) {
  if (productType === ProductType.kit) {
    return "El kit no conserva una huella historica por linea suficiente.";
  }
  if (tracking.lot || tracking.serial || tracking.expiration) {
    return "La linea requiere trazabilidad explicita de lote o serie.";
  }
  return "La linea no conserva una huella historica de inventario suficiente.";
}

function hasSaleInventoryFootprint(sale: Sale, productId: string, db: MockDatabase) {
  const soldQuantity = sale.items
    .filter((item) => item.productId === productId)
    .reduce((sum, item) => sum + item.quantity, 0);
  const movedQuantity = db.inventoryMovements
    .filter(
      (movement) =>
        movement.tenantId === sale.tenantId &&
        movement.branchId === sale.branchId &&
        movement.productId === productId &&
        movement.type === InventoryMovementType.out &&
        movement.referenceType === "sale" &&
        movement.referenceId === sale.id &&
        !movement.lotId &&
        !movement.serialNumberId,
    )
    .reduce((sum, movement) => sum + movement.quantity, 0);
  return movedQuantity >= soldQuantity;
}

function isFullyReturned(sale: Sale, returns: ReturnRequest[]) {
  const returned = getReturnedQuantityByItem(returns);
  return sale.items.every((item) => (returned.get(item.id) ?? 0) >= item.quantity);
}

function planRefunds(sale: Sale, refundCents: number, db: MockDatabase) {
  if (refundCents <= 0) throw new Error("El refund debe ser mayor que cero.");
  const payments = db.payments.filter(
    (item) => item.tenantId === sale.tenantId && item.saleId === sale.id,
  );
  if (payments.length === 0) throw new Error("La venta no tiene pagos reembolsables.");
  if (payments.some((payment) => payment.method === PaymentMethod.mixed)) {
    throw new Error("Un pago mixed agregado no puede distribuirse de forma segura.");
  }
  const refundedByPayment = new Map<string, number>();
  db.refundTransactions
    .filter((refund) => refund.saleId === sale.id)
    .forEach((refund) => {
      refundedByPayment.set(
        refund.paymentId,
        (refundedByPayment.get(refund.paymentId) ?? 0) + toCents(refund.amount),
      );
    });
  const remaining = payments.map((payment) => ({
    payment,
    cents: Math.max(0, toCents(payment.amount) - (refundedByPayment.get(payment.id) ?? 0)),
  }));
  if (remaining.some((item) => item.cents > 0 && item.payment.status !== PaymentStatus.approved)) {
    throw new Error("La venta contiene pagos que no estan aprobados para refund.");
  }
  const totalRemaining = remaining.reduce((sum, item) => sum + item.cents, 0);
  if (refundCents > totalRemaining) throw new Error("El refund excede el saldo pagado disponible.");
  const candidates = remaining.filter((item) => item.cents > 0);
  const allocations = candidates.map((item) => ({
    payment: item.payment,
    capacity: item.cents,
    cents: Math.floor((refundCents * item.cents) / totalRemaining),
  }));
  let remainder = refundCents - allocations.reduce((sum, item) => sum + item.cents, 0);
  while (remainder > 0) {
    const candidate = allocations.find((item) => item.cents < item.capacity);
    if (!candidate) throw new Error("No fue posible distribuir el refund entre los pagos.");
    candidate.cents += 1;
    remainder -= 1;
  }
  return allocations
    .filter((item) => item.cents > 0)
    .map(({ payment, cents }) => ({ payment, cents }));
}

function applyRefunds(
  plan: Array<{ payment: Payment; cents: number }>,
  input: Pick<ProcessSaleReturnInput, "tenantId" | "branchId" | "saleId" | "actorUserId">,
  reference: ReversalReference,
  now: string,
  db: MockDatabase,
  id: () => string,
) {
  const refunds = plan.map<RefundTransaction>(({ payment, cents }) => ({
    id: id(),
    tenantId: input.tenantId,
    branchId: input.branchId,
    saleId: input.saleId,
    returnId: reference.referenceType === "return" ? reference.referenceId : undefined,
    voidId: reference.referenceType === "void" ? reference.referenceId : undefined,
    paymentId: payment.id,
    method: payment.method as Exclude<PaymentMethod, "mixed">,
    amount: fromCents(cents),
    createdByUserId: input.actorUserId,
    createdAt: now,
  }));
  plan.forEach(({ payment, cents }) => {
    const previous = db.refundTransactions
      .filter((refund) => refund.paymentId === payment.id)
      .reduce((sum, refund) => sum + toCents(refund.amount), 0);
    if (previous + cents >= toCents(payment.amount)) {
      payment.status = PaymentStatus.refunded;
    }
  });
  return refunds;
}

function requireCurrentShift(
  input: Pick<ProcessSaleReturnInput, "tenantId" | "branchId" | "actorUserId">,
  db: MockDatabase,
) {
  const shift = db.cashShifts.find(
    (item) =>
      item.tenantId === input.tenantId &&
      item.branchId === input.branchId &&
      item.userId === input.actorUserId &&
      item.status === CashShiftStatus.open,
  );
  if (!shift) throw new Error("La operacion requiere un turno de caja abierto del actor.");
  return shift;
}

function requireCashShiftForRefund(
  input: Pick<ProcessSaleReturnInput, "tenantId" | "branchId" | "actorUserId">,
  plan: Array<{ payment: Payment; cents: number }>,
  db: MockDatabase,
) {
  return plan.some((item) => item.payment.method === PaymentMethod.cash)
    ? requireCurrentShift(input, db)
    : undefined;
}

function createCashMovement(
  refunds: RefundTransaction[],
  cashShiftId: string | undefined,
  input: Pick<ProcessSaleReturnInput, "tenantId" | "actorUserId">,
  reference: ReversalReference,
  reason: string,
  now: string,
  db: MockDatabase,
  id: () => string,
): CashMovement | undefined {
  const amountCents = refunds
    .filter((refund) => refund.method === PaymentMethod.cash)
    .reduce((sum, refund) => sum + toCents(refund.amount), 0);
  if (amountCents === 0) return undefined;
  if (!cashShiftId) throw new Error("El refund cash requiere turno abierto.");
  return registerCashMovementInTransaction(
    db,
    {
      tenantId: input.tenantId,
      cashShiftId,
      type: CashMovementType.out,
      amount: fromCents(amountCents),
      reason,
      ...reference,
      createdByUserId: input.actorUserId,
    },
    { createId: () => id(), now: () => now },
  ).movement;
}

function createCreditNote(
  sale: Sale,
  amount: number,
  input: Pick<ProcessSaleReturnInput, "tenantId" | "branchId" | "actorUserId" | "reason">,
  operation: { returnId?: string; voidId?: string },
  now: string,
  db: MockDatabase,
  id: () => string,
): CreditNote {
  const year = new Date(now).getUTCFullYear();
  const prefix = `NC-${year}-`;
  const next =
    db.creditNotes
      .filter((item) => item.tenantId === input.tenantId && item.documentNumber.startsWith(prefix))
      .map((item) => Number(item.documentNumber.slice(prefix.length)))
      .filter(Number.isInteger)
      .reduce((max, value) => Math.max(max, value), 0) + 1;
  return {
    id: id(),
    tenantId: input.tenantId,
    branchId: input.branchId,
    saleId: sale.id,
    ...operation,
    documentNumber: `${prefix}${String(next).padStart(5, "0")}`,
    originalDocumentNumber: sale.number,
    amount,
    reason: input.reason,
    createdAt: now,
    createdByUserId: input.actorUserId,
  };
}

function rebuildResult(
  operation: { returnRequest?: ReturnRequest; void?: SaleVoid },
  db: MockDatabase,
): SaleReversalResult {
  const referenceType = operation.returnRequest ? "return" : "void";
  const record = operation.returnRequest ?? operation.void;
  if (!record) throw new Error("Operacion idempotente invalida.");
  const sale = db.sales.find(
    (item) => item.id === record.saleId && item.tenantId === record.tenantId,
  );
  if (!sale) throw new Error("La operacion idempotente perdio su venta.");
  const refunds = db.refundTransactions.filter((item) =>
    referenceType === "return" ? item.returnId === record.id : item.voidId === record.id,
  );
  const inventoryMovements = db.inventoryMovements.filter(
    (item) => item.referenceType === referenceType && item.referenceId === record.id,
  );
  const cashMovement = db.cashMovements.find(
    (item) => item.referenceType === referenceType && item.referenceId === record.id,
  );
  const creditNote = db.creditNotes.find((item) =>
    referenceType === "return" ? item.returnId === record.id : item.voidId === record.id,
  );
  if (!creditNote) throw new Error("La operacion idempotente perdio su nota de credito.");
  return {
    sale,
    ...operation,
    refunds,
    inventoryMovements,
    cashMovement,
    creditNote,
    idempotent: true,
  };
}

function getReversedQuantityByLocation(saleId: string, productId: string, db: MockDatabase) {
  const returnIds = new Set(getCompletedReturns(saleId, db).map((item) => item.id));
  const voidIds = new Set(
    db.saleVoids.filter((item) => item.saleId === saleId).map((item) => item.id),
  );
  const result = new Map<string, number>();
  db.inventoryMovements
    .filter(
      (movement) =>
        movement.productId === productId &&
        movement.type === InventoryMovementType.in &&
        ((movement.referenceType === "return" && returnIds.has(movement.referenceId ?? "")) ||
          (movement.referenceType === "void" && voidIds.has(movement.referenceId ?? ""))),
    )
    .forEach((movement) => {
      const key = movement.toLocationId ?? "";
      result.set(key, (result.get(key) ?? 0) + movement.quantity);
    });
  return result;
}

function getVoidBlockedReason(
  sale: Sale,
  hasPriorReturns: boolean,
  alreadyVoided: boolean,
  isWithinCurrentShift: boolean,
  refundableCents: number,
  hasInvalidPayment: boolean,
  items: SaleReversalInspection["items"],
  db: MockDatabase,
) {
  if (alreadyVoided || sale.status === SaleStatus.cancelled) return "La venta ya fue anulada.";
  if (sale.status !== SaleStatus.completed) return "Solo una venta completada puede anularse.";
  if (hasPriorReturns) return "La venta posee devoluciones previas.";
  if (!isWithinCurrentShift) return "La venta no pertenece al turno abierto actual.";
  if (sale.items.length === 0 || toCents(sale.total) <= 0) {
    return "La venta no contiene un importe positivo reversible.";
  }
  if (hasInvalidPayment) return "La venta contiene pagos que no estan aprobados para refund.";
  if (refundableCents !== toCents(sale.total)) return "Los pagos no permiten una reversion total.";
  if (
    items.some(
      (item) => !isItemSafelyReversible(sale, item.productId, item.productType, item.tracking, db),
    )
  ) {
    return "La venta contiene inventario sin una huella historica reversible segura.";
  }
  return "La venta no es anulable.";
}

function getReturnBlockedReason(
  sale: Sale,
  alreadyVoided: boolean,
  refundableCents: number,
  hasInvalidPayment: boolean,
  cashRefundNeedsShift: boolean,
  hasActorOpenShift: boolean,
  items: SaleReversalInspection["items"],
  db: MockDatabase,
) {
  if (alreadyVoided || sale.status === SaleStatus.cancelled) return "La venta fue anulada.";
  if (sale.status === SaleStatus.returned || items.every((item) => item.returnableQuantity <= 0)) {
    return "La venta ya fue devuelta completamente.";
  }
  if (refundableCents <= 0) return "La venta no conserva saldo pagado reembolsable.";
  if (hasInvalidPayment) return "La venta contiene pagos que no estan aprobados para refund.";
  if (cashRefundNeedsShift && !hasActorOpenShift) {
    return "El refund cash requiere un turno abierto del actor en la sucursal.";
  }
  if (
    !items.some(
      (item) =>
        item.returnableQuantity > 0 &&
        isItemSafelyReversible(sale, item.productId, item.productType, item.tracking, db),
    )
  ) {
    return "No hay lineas retornables con una reversion de inventario segura.";
  }
  return "La venta no admite devoluciones.";
}

function returnFingerprint(input: ProcessSaleReturnInput) {
  return JSON.stringify({
    tenantId: input.tenantId,
    branchId: input.branchId,
    saleId: input.saleId,
    actorUserId: input.actorUserId,
    reason: input.reason,
    lines: [...input.lines].sort((a, b) => a.saleItemId.localeCompare(b.saleItemId)),
  });
}

function voidFingerprint(input: VoidSaleInput) {
  return JSON.stringify({
    tenantId: input.tenantId,
    branchId: input.branchId,
    saleId: input.saleId,
    actorUserId: input.actorUserId,
    reason: input.reason,
  });
}

function toCents(value: number) {
  if (!Number.isFinite(value)) throw new Error("Importe monetario invalido.");
  return Math.round((value + Number.EPSILON) * 100);
}

function fromCents(value: number) {
  return value / 100;
}
