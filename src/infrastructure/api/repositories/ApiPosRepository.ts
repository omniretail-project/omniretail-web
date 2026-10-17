import type { PosApiConfirmSaleCommand, PosApiRepository } from "@/core/repositories";
import type { DataEventName, DataEventPayload } from "@/core/types/events.types";
import { BackendRequestError, backendFetch } from "@/infrastructure/api/backendClient";
import {
  parseCashMovementCommand,
  parseCloseCashShiftCommand,
  parseConfirmSaleCommand,
  parseOpenCashShiftCommand,
  parsePosCashMovement,
  parsePosCashMovements,
  parsePosCashShift,
  parsePosCashShiftSummary,
  parsePosReturnEligibility,
  parsePosReturnOperation,
  parsePosSaleConfirmation,
  parsePosSaleDetail,
  parsePosSalesHistoryPage,
  parsePosVoidOperation,
  parseReturnCommand,
  parseVoidCommand,
} from "@/infrastructure/api/repositories/posApi.schema";
import { assertApiUuid } from "@/infrastructure/api/uuid";
import type { DataEventBus } from "@/infrastructure/events/DataEventBus";

/**
 * Los eventos se emiten solo despues de una respuesta 2xx validada: el backend ya confirmo el
 * efecto y los listeners se limitan a re-consultar sus fuentes canonicas.
 */
export class ApiPosRepository implements PosApiRepository {
  constructor(private readonly eventBus: DataEventBus) {}

  async getOpenCashShift(branchId: string) {
    assertApiUuid(branchId, "branchId");
    const response = await backendFetch<unknown>("/pos/cash-shifts/open", {
      query: { branchId },
    });
    return response === undefined ? null : parsePosCashShift(response);
  }

  async openCashShift(input: { branchId: string; registerCode: string; openingAmount: number }) {
    const body = parseOpenCashShiftCommand(input);
    const shift = parsePosCashShift(
      await backendFetch<unknown>("/pos/cash-shifts/open", { method: "POST", body }),
    );
    this.emitSafely("cash-shift.changed", {
      entityId: shift.id,
      branchId: shift.branchId,
      action: "created",
    });
    return shift;
  }

  async closeCashShift(input: { cashShiftId: string; countedAmount: number }) {
    const body = parseCloseCashShiftCommand(input);
    const shift = parsePosCashShift(
      await backendFetch<unknown>("/pos/cash-shifts/close", { method: "POST", body }),
    );
    this.emitSafely("cash-shift.changed", {
      entityId: shift.id,
      branchId: shift.branchId,
      action: "status_changed",
    });
    return shift;
  }

  async getCashShiftSummary(cashShiftId: string) {
    assertApiUuid(cashShiftId, "cashShiftId");
    return parsePosCashShiftSummary(
      await backendFetch<unknown>(`/pos/cash-shifts/${cashShiftId}/summary`),
    );
  }

  async getCashShiftMovements(cashShiftId: string) {
    assertApiUuid(cashShiftId, "cashShiftId");
    return parsePosCashMovements(
      await backendFetch<unknown>(`/pos/cash-movements/shift/${cashShiftId}`),
    );
  }

  async registerCashMovement(input: Parameters<PosApiRepository["registerCashMovement"]>[0]) {
    const body = parseCashMovementCommand(input);
    const movement = parsePosCashMovement(
      await backendFetch<unknown>("/pos/cash-movements", { method: "POST", body }),
    );
    this.emitSafely("cash-shift.changed", { entityId: movement.cashShiftId, action: "updated" });
    return movement;
  }

  async confirmSale(input: PosApiConfirmSaleCommand) {
    const body = parseConfirmSaleCommand(input);
    const sale = parsePosSaleConfirmation(
      await backendFetch<unknown>("/pos/sales", { method: "POST", body }),
    );
    this.emitSafely("sale.changed", {
      entityId: sale.id,
      branchId: sale.branchId,
      action: "created",
    });
    this.emitInventoryRefresh(
      sale.branchId,
      sale.items.map((item) => item.productId),
    );
    if (sale.cashMovement) {
      this.emitSafely("cash-shift.changed", {
        entityId: sale.cashMovement.cashShiftId,
        branchId: sale.branchId,
        action: "updated",
      });
    }
    if (sale.order) {
      this.emitSafely("order.changed", {
        entityId: sale.order.id,
        orderId: sale.order.id,
        branchId: sale.branchId,
        action: "created",
      });
    }
    return sale;
  }

  async getSalesHistory(input: Parameters<PosApiRepository["getSalesHistory"]>[0]) {
    assertApiUuid(input.branchId, "branchId");
    return parsePosSalesHistoryPage(
      await backendFetch<unknown>("/pos/sales/history", {
        query: {
          branchId: input.branchId,
          search: input.search?.trim() || undefined,
          from: input.from,
          to: input.to,
          status: input.status,
          deliveryMethod: input.deliveryMethod,
          operationalStatus: input.operationalStatus,
          page: input.page,
          size: input.pageSize,
          sort: "createdAt,desc",
        },
      }),
    );
  }

  async getSaleDetail(saleId: string) {
    assertApiUuid(saleId, "saleId");
    return parsePosSaleDetail(await backendFetch<unknown>(`/pos/sales/${saleId}`));
  }

  async getReturnEligibility(branchId: string, documentNumber: string) {
    assertApiUuid(branchId, "branchId");
    try {
      return parsePosReturnEligibility(
        await backendFetch<unknown>("/pos/sales/returns/eligibility", {
          query: { branchId, documentNumber },
        }),
      );
    } catch (error) {
      if (error instanceof BackendRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async processReturn(
    saleId: string,
    idempotencyKey: string,
    input: Parameters<PosApiRepository["processReturn"]>[2],
  ) {
    assertApiUuid(saleId, "saleId");
    assertApiUuid(idempotencyKey, "idempotencyKey");
    const body = parseReturnCommand(input);
    const result = parsePosReturnOperation(
      await backendFetch<unknown>(`/pos/sales/${saleId}/returns`, {
        method: "POST",
        body,
        headers: { "Idempotency-Key": idempotencyKey },
      }),
    );
    this.emitReversal("sale.returned", saleId, result);
    return result;
  }

  async voidSale(
    saleId: string,
    idempotencyKey: string,
    input: Parameters<PosApiRepository["voidSale"]>[2],
  ) {
    assertApiUuid(saleId, "saleId");
    assertApiUuid(idempotencyKey, "idempotencyKey");
    const body = parseVoidCommand(input);
    const result = parsePosVoidOperation(
      await backendFetch<unknown>(`/pos/sales/${saleId}/void`, {
        method: "POST",
        body,
        headers: { "Idempotency-Key": idempotencyKey },
      }),
    );
    this.emitReversal("sale.voided", saleId, result);
    return result;
  }

  private emitReversal(
    event: "sale.returned" | "sale.voided",
    saleId: string,
    result: Pick<Awaited<ReturnType<PosApiRepository["voidSale"]>>, "inventory" | "cashMovement">,
  ) {
    this.emitSafely(event, { entityId: saleId, action: "status_changed" });
    this.emitSafely("sale.changed", { entityId: saleId, action: "status_changed" });
    if (result.inventory.inventoryRestored || result.inventory.movementIds.length > 0) {
      this.emitInventoryRefresh(undefined, []);
    }
    if (result.cashMovement.recorded) {
      this.emitSafely("cash-shift.changed", { action: "updated" });
    }
  }

  /** Un solo evento por operacion: cada listener de stock dispara una re-consulta completa. */
  private emitInventoryRefresh(branchId: string | undefined, productIds: string[]) {
    const payload: DataEventPayload = {
      branchId,
      action: "updated",
      metadata: { productIds: [...new Set(productIds)] },
    };
    this.emitSafely("inventory.changed", payload);
    this.emitSafely("stock.changed", payload);
  }

  private emitSafely(event: DataEventName, payload: DataEventPayload) {
    try {
      this.eventBus.emit(event, payload);
    } catch {
      // El backend ya confirmo la operacion; un listener fallido no debe convertirla en error.
    }
  }
}
