import type {
  ConfirmDispatchApiCommand,
  ConfirmTransferDispatchApiCommand,
  DispatchApiReadScope,
  DispatchCommandRepository,
  DispatchReadRepository,
} from "@/core/repositories";
import { backendFetch } from "@/infrastructure/api/backendClient";
import {
  parseApiDispatchQueue,
  parseApiDispatchResult,
  parseApiPreparedDispatch,
  parseConfirmDispatchCommand,
  parseConfirmTransferDispatchCommand,
} from "@/infrastructure/api/repositories/dispatchApi.schema";
import { assertApiUuid } from "@/infrastructure/api/uuid";

export class ApiDispatchRepository implements DispatchReadRepository, DispatchCommandRepository {
  async getQueue(scope: DispatchApiReadScope) {
    assertApiUuid(scope.branchId, "branchId");
    return parseApiDispatchQueue(
      await backendFetch<unknown>("/logistics/dispatch", {
        query: { branchId: scope.branchId },
      }),
    );
  }

  async getPreparedDetail(scope: DispatchApiReadScope, orderId: string) {
    assertApiUuid(scope.branchId, "branchId");
    assertApiUuid(orderId, "orderId");
    return parseApiPreparedDispatch(
      await backendFetch<unknown>(`/logistics/dispatch/${orderId}/prepared`, {
        query: { branchId: scope.branchId },
      }),
    );
  }

  async getDetail(scope: DispatchApiReadScope, orderId: string) {
    this.assertIds(scope, orderId, "orderId");
    return parseApiDispatchResult(
      await backendFetch<unknown>(`/logistics/dispatch/${orderId}`, {
        query: { branchId: scope.branchId },
      }),
    );
  }

  async getTransferDetail(scope: DispatchApiReadScope, transferId: string) {
    this.assertIds(scope, transferId, "transferId");
    return parseApiDispatchResult(
      await backendFetch<unknown>(`/logistics/dispatch/transfers/${transferId}`, {
        query: { branchId: scope.branchId },
      }),
    );
  }

  async confirmOrder(
    scope: DispatchApiReadScope,
    orderId: string,
    command: ConfirmDispatchApiCommand,
  ) {
    this.assertIds(scope, orderId, "orderId");
    return parseApiDispatchResult(
      await backendFetch<unknown>(`/logistics/dispatch/${orderId}/confirm`, {
        method: "POST",
        query: { branchId: scope.branchId },
        body: parseConfirmDispatchCommand(command),
      }),
    );
  }

  async confirmTransfer(
    scope: DispatchApiReadScope,
    transferId: string,
    command: ConfirmTransferDispatchApiCommand,
  ) {
    this.assertIds(scope, transferId, "transferId");
    return parseApiDispatchResult(
      await backendFetch<unknown>(`/logistics/dispatch/transfers/${transferId}/confirm`, {
        method: "POST",
        query: { branchId: scope.branchId },
        body: parseConfirmTransferDispatchCommand(command),
      }),
    );
  }

  private assertIds(scope: DispatchApiReadScope, resourceId: string, resourceName: string) {
    assertApiUuid(scope.branchId, "branchId");
    assertApiUuid(resourceId, resourceName);
  }
}
