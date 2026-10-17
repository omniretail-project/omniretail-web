import type {
  CreatePickingIncidentCommand,
  PickingCommandActionResult,
  PickingCommandRepository,
  PickingDetailReadModel,
  PickingIncidentReadModel,
  PickingQueueReadModel,
  PickingReadLine,
  PickingReadRepository,
  PickingReleaseReadModel,
  PickingScope,
  UpdatePickingLineCommand,
} from "@/core/repositories";
import { backendFetch } from "@/infrastructure/api/backendClient";
import { assertApiUuid } from "@/infrastructure/api/uuid";
import {
  parseApiPickingDetail,
  parseApiPickingAction,
  parseApiPickingIncident,
  parseApiPickingLine,
  parseApiPickingQueue,
  parseApiPickingRelease,
} from "@/infrastructure/api/repositories/pickingApi.schema";

export class ApiPickingRepository implements PickingReadRepository, PickingCommandRepository {
  async getQueue(scope: PickingScope): Promise<PickingQueueReadModel[]> {
    assertApiUuid(scope.branchId, "branchId");
    return parseApiPickingQueue(
      await backendFetch<unknown>("/logistics/picking", {
        query: { branchId: scope.branchId },
      }),
    );
  }

  async getDetail(scope: PickingScope, pickingOrderId: string): Promise<PickingDetailReadModel> {
    assertApiUuid(scope.branchId, "branchId");
    assertApiUuid(pickingOrderId, "pickingOrderId");
    return parseApiPickingDetail(
      await backendFetch<unknown>(`/logistics/picking/${pickingOrderId}`, {
        query: { branchId: scope.branchId },
      }),
    );
  }

  async assign(scope: PickingScope, pickingOrderId: string): Promise<PickingCommandActionResult> {
    this.assertCommandIds(scope, pickingOrderId);
    return parseApiPickingAction(
      await backendFetch<unknown>(`/logistics/picking/${pickingOrderId}/assign`, {
        method: "POST",
        query: { branchId: scope.branchId },
      }),
    );
  }

  async release(
    scope: PickingScope,
    pickingOrderId: string,
    reason: string,
  ): Promise<PickingReleaseReadModel> {
    this.assertCommandIds(scope, pickingOrderId);
    return parseApiPickingRelease(
      await backendFetch<unknown>(`/logistics/picking/${pickingOrderId}/release`, {
        method: "POST",
        query: { branchId: scope.branchId },
        body: { reason },
      }),
    );
  }

  async updateItem(
    scope: PickingScope,
    pickingOrderId: string,
    pickingItemId: string,
    command: UpdatePickingLineCommand,
  ): Promise<PickingReadLine> {
    this.assertCommandIds(scope, pickingOrderId);
    assertApiUuid(pickingItemId, "pickingItemId");
    return parseApiPickingLine(
      await backendFetch<unknown>(
        `/logistics/picking/${pickingOrderId}/items/${pickingItemId}`,
        {
          method: "PATCH",
          query: { branchId: scope.branchId },
          body: command,
        },
      ),
    );
  }

  async createIncident(
    scope: PickingScope,
    pickingOrderId: string,
    command: CreatePickingIncidentCommand,
  ): Promise<PickingIncidentReadModel> {
    this.assertCommandIds(scope, pickingOrderId);
    if (command.pickingLineId) assertApiUuid(command.pickingLineId, "pickingLineId");
    return parseApiPickingIncident(
      await backendFetch<unknown>(`/logistics/picking/${pickingOrderId}/incidents`, {
        method: "POST",
        query: { branchId: scope.branchId },
        body: command,
      }),
    );
  }

  async resolveIncident(
    scope: PickingScope,
    pickingOrderId: string,
    incidentId: string,
  ): Promise<PickingIncidentReadModel> {
    this.assertCommandIds(scope, pickingOrderId);
    assertApiUuid(incidentId, "incidentId");
    return parseApiPickingIncident(
      await backendFetch<unknown>(
        `/logistics/picking/${pickingOrderId}/incidents/${incidentId}/resolve`,
        { method: "PATCH", query: { branchId: scope.branchId } },
      ),
    );
  }

  async complete(scope: PickingScope, pickingOrderId: string): Promise<PickingCommandActionResult> {
    this.assertCommandIds(scope, pickingOrderId);
    return parseApiPickingAction(
      await backendFetch<unknown>(`/logistics/picking/${pickingOrderId}/complete`, {
        method: "POST",
        query: { branchId: scope.branchId },
      }),
    );
  }

  private assertCommandIds(scope: PickingScope, pickingOrderId: string) {
    assertApiUuid(scope.branchId, "branchId");
    assertApiUuid(pickingOrderId, "pickingOrderId");
  }
}
