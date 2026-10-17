import type { InventoryReservation, Order, Payment, PickingOrder } from "@/core/entities";
import { ecommercePaymentPolicy } from "@/config/ecommerce-payment-policy";
import { BranchStatus, OrderSource, OrderStatus, PaymentStatus } from "@/core/enums";
import { InsufficientInventoryAvailabilityError } from "@/core/inventory/stockAvailability";
import type {
  ConfirmOrderPaymentInput,
  ConfirmOrderPaymentResult,
  OrderPaymentConfirmationRepository,
} from "@/core/repositories";
import type { DataEventName, DataEventPayload } from "@/core/types/events.types";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";
import type { MockDatabaseStore } from "@/infrastructure/mock/database/MockDatabaseStore";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";
import type { InventoryReservationMutationResult } from "@/infrastructure/mock/repositories/inventoryReservationMutations";
import { scheduleDeferredFulfillmentInTransaction } from "@/infrastructure/mock/repositories/orderFulfillmentMutations";

export interface MockOrderPaymentConfirmationRepositoryTestHooks {
  afterPickingCreated?: () => void;
}

interface ConfirmationMutationResult extends ConfirmOrderPaymentResult {
  orderChanged: boolean;
  paymentChanged: boolean;
  reservationChanges: InventoryReservationMutationResult[];
  pickingOrder?: PickingOrder;
  pickingCreated: boolean;
}

interface DiscardedCheckout {
  order: Order;
  payment: Payment;
}

export class MockOrderPaymentConfirmationRepository
  extends BaseMockRepository
  implements OrderPaymentConfirmationRepository
{
  constructor(
    store: MockDatabaseStore,
    eventBus: DataEventBus,
    private readonly testHooks: MockOrderPaymentConfirmationRepositoryTestHooks = {},
  ) {
    super(store, eventBus);
  }

  async confirm(input: ConfirmOrderPaymentInput): Promise<ConfirmOrderPaymentResult> {
    assertInput(input);

    let result: ConfirmationMutationResult;
    try {
      result = this.store.transact<ConfirmationMutationResult>((db) => {
        const order = db.orders.find(
          (item) => item.id === input.orderId && item.tenantId === input.tenantId,
        );
        if (!order) throw new Error(`Order not found for tenant: ${input.orderId}`);
        if (order.source !== OrderSource.ecommerce) {
          throw new Error(`Order is not an ecommerce order: ${order.id}`);
        }
        if (order.branchId !== input.branchId) {
          throw new Error(`Order branch conflict: ${order.id}`);
        }
        const branch = db.branches.find(
          (item) => item.id === input.branchId && item.tenantId === input.tenantId,
        );
        if (!branch || branch.status !== BranchStatus.active) {
          throw new Error(`Active branch not found for tenant: ${input.branchId}`);
        }

        const payment = db.payments.find(
          (item) => item.id === input.paymentId && item.tenantId === input.tenantId,
        );
        if (!payment) throw new Error(`Payment not found for tenant: ${input.paymentId}`);
        if (payment.orderId !== order.id) {
          throw new Error(`Payment does not belong to Order: ${payment.id}`);
        }
        if (!ecommercePaymentPolicy.isImmediateMockMethod(payment.method)) {
          throw new Error(
            `Payment method does not allow immediate mock approval: ${payment.method}`,
          );
        }
        if (roundMoney(payment.amount) !== roundMoney(order.total)) {
          throw new Error(`Payment amount does not match Order total: ${payment.id}`);
        }

        const alreadyConfirmed =
          payment.status === PaymentStatus.approved && order.status === OrderStatus.confirmed;
        const canConfirm =
          payment.status === PaymentStatus.pending && order.status === OrderStatus.pending;
        if (!alreadyConfirmed && !canConfirm) {
          throw new Error(
            `Payment/Order cannot be confirmed from ${payment.status}/${order.status}: ${payment.id}`,
          );
        }

        const fulfillment = scheduleDeferredFulfillmentInTransaction(order, db, {
          id: (prefix) => this.id(prefix),
          now: () => this.now(),
        });
        if (fulfillment.pickingCreated) this.testHooks.afterPickingCreated?.();
        const changedReservations = fulfillment.reservationChanges.filter(
          (change) => change.changed,
        );
        if (canConfirm) {
          const now = this.now();
          payment.status = PaymentStatus.approved;
          order.status = OrderStatus.confirmed;
          order.updatedAt = now;
        }

        return {
          order,
          payment,
          inventoryReservations: fulfillment.reservationChanges.map(
            (change) => change.reservation,
          ),
          idempotent:
            alreadyConfirmed && changedReservations.length === 0 && !fulfillment.pickingCreated,
          orderChanged: canConfirm,
          paymentChanged: canConfirm,
          reservationChanges: fulfillment.reservationChanges,
          pickingOrder: fulfillment.pickingOrder,
          pickingCreated: fulfillment.pickingCreated,
        };
      });
    } catch (cause) {
      if (cause instanceof InsufficientInventoryAvailabilityError) {
        const discarded = this.discardFailedImmediateCheckout(input);
        if (discarded) this.emitDiscardedCheckout(discarded);
      }
      throw cause;
    }

    this.emitAfterCommit(result);
    return {
      order: result.order,
      payment: result.payment,
      inventoryReservations: result.inventoryReservations,
      idempotent: result.idempotent,
    };
  }

  private discardFailedImmediateCheckout(
    input: ConfirmOrderPaymentInput,
  ): DiscardedCheckout | null {
    return this.store.transact((db) => {
      const orderIndex = db.orders.findIndex(
        (item) =>
          item.id === input.orderId &&
          item.tenantId === input.tenantId &&
          item.branchId === input.branchId &&
          item.source === OrderSource.ecommerce &&
          item.status === OrderStatus.pending,
      );
      if (orderIndex < 0) return null;
      const order = db.orders[orderIndex];
      const orderPayments = db.payments.filter(
        (item) => item.tenantId === input.tenantId && item.orderId === order.id,
      );
      if (orderPayments.length !== 1) return null;
      const payment = orderPayments[0];
      if (
        payment.id !== input.paymentId ||
        payment.status !== PaymentStatus.pending ||
        !ecommercePaymentPolicy.isImmediateMockMethod(payment.method)
      ) {
        return null;
      }
      const hasDependencies =
        db.inventoryReservations.some((item) => item.orderId === order.id) ||
        db.orderItems.some((item) => item.orderId === order.id) ||
        db.pickingOrders.some((item) => item.orderId === order.id) ||
        db.dispatches.some((item) => item.orderId === order.id) ||
        db.sales.some((item) => item.sourceOrderId === order.id);
      if (hasDependencies) return null;

      db.payments.splice(db.payments.indexOf(payment), 1);
      db.orders.splice(orderIndex, 1);
      return { order, payment };
    });
  }

  private emitDiscardedCheckout(discarded: DiscardedCheckout): void {
    this.emitSafely("payment.changed", {
      entityId: discarded.payment.id,
      tenantId: discarded.payment.tenantId,
      action: "deleted",
    });
    this.emitSafely("order.changed", {
      entityId: discarded.order.id,
      tenantId: discarded.order.tenantId,
      branchId: discarded.order.branchId,
      action: "deleted",
    });
  }

  private emitAfterCommit(result: ConfirmationMutationResult): void {
    result.reservationChanges
      .filter((change) => change.changed)
      .forEach((change) => this.emitReservationChanged(change.reservation));
    if (result.paymentChanged) {
      this.emitSafely("payment.changed", {
        entityId: result.payment.id,
        tenantId: result.payment.tenantId,
        action: "status_changed",
      });
    }
    if (result.orderChanged) {
      this.emitSafely("order.changed", {
        entityId: result.order.id,
        tenantId: result.order.tenantId,
        branchId: result.order.branchId,
        action: "status_changed",
      });
    }
    if (result.pickingCreated && result.pickingOrder) {
      this.emitSafely("picking.changed", {
        entityId: result.pickingOrder.id,
        tenantId: result.pickingOrder.tenantId,
        branchId: result.pickingOrder.branchId,
        orderId: result.order.id,
        pickingOrderId: result.pickingOrder.id,
        action: "created",
      });
    }
  }

  private emitReservationChanged(reservation: InventoryReservation): void {
    this.emitSafely("stock.changed", {
      entityId: reservation.id,
      tenantId: reservation.tenantId,
      branchId: reservation.branchId,
      productId: reservation.productId,
      action: "updated",
      metadata: { entity: "InventoryReservation", status: reservation.status },
    });
  }

  private emitSafely(event: DataEventName, payload: DataEventPayload): void {
    try {
      this.emit(event, payload);
    } catch {
      // Persistence is already committed; refresh/listener failures must not fail confirmation.
    }
  }
}

function assertInput(input: ConfirmOrderPaymentInput): void {
  if (!input.tenantId.trim()) throw new Error("Payment confirmation tenantId is required");
  if (!input.branchId.trim()) throw new Error("Payment confirmation branchId is required");
  if (!input.orderId.trim()) throw new Error("Payment confirmation orderId is required");
  if (!input.paymentId.trim()) throw new Error("Payment confirmation paymentId is required");
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
