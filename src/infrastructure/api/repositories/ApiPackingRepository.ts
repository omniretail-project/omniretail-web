import type {
  FinalizePackingCommandResult,
  PackingCommandActionResult,
  PackingCommandRepository,
  PackingDetailReadModel,
  PackingQueueReadModel,
  PackingReadRepository,
  PackingScope,
  PackingVersionedApiCommand,
  RegisterPackingLabelPrintApiCommand,
  SavePackingPreparationApiCommand,
} from "@/core/repositories";
import { backendFetch } from "@/infrastructure/api/backendClient";
import {
  parseApiPackingAction,
  parseApiPackingDetail,
  parseApiPackingFinalize,
  parseApiPackingQueue,
  parsePackingVersionedCommand,
  parseRegisterPackingLabelPrintCommand,
  parseSavePackingPreparationCommand,
} from "@/infrastructure/api/repositories/packingApi.schema";
import { assertApiUuid } from "@/infrastructure/api/uuid";

export class ApiPackingRepository implements PackingReadRepository, PackingCommandRepository {
  async getQueue(scope: PackingScope): Promise<PackingQueueReadModel[]> {
    assertApiUuid(scope.branchId, "branchId");
    return parseApiPackingQueue(
      await backendFetch<unknown>("/logistics/packing", {
        query: { branchId: scope.branchId },
      }),
    );
  }

  async getDetail(scope: PackingScope, packingId: string): Promise<PackingDetailReadModel> {
    this.assertIds(scope, packingId);
    return parseApiPackingDetail(
      await backendFetch<unknown>(`/logistics/packing/${packingId}`, {
        query: { branchId: scope.branchId },
      }),
    );
  }

  async savePreparation(
    scope: PackingScope,
    packingId: string,
    command: SavePackingPreparationApiCommand,
  ): Promise<PackingCommandActionResult> {
    this.assertIds(scope, packingId);
    const body = parseSavePackingPreparationCommand(command);
    return parseApiPackingAction(
      await backendFetch<unknown>(`/logistics/packing/${packingId}/preparation`, {
        method: "PATCH",
        query: { branchId: scope.branchId },
        body,
      }),
    );
  }

  async generateLabel(
    scope: PackingScope,
    packingId: string,
    command: PackingVersionedApiCommand,
  ): Promise<PackingCommandActionResult> {
    this.assertIds(scope, packingId);
    const body = parsePackingVersionedCommand(command);
    return parseApiPackingAction(
      await backendFetch<unknown>(`/logistics/packing/${packingId}/label`, {
        method: "POST",
        query: { branchId: scope.branchId },
        body,
      }),
    );
  }

  async registerLabelPrint(
    scope: PackingScope,
    packingId: string,
    command: RegisterPackingLabelPrintApiCommand,
  ): Promise<PackingCommandActionResult> {
    this.assertIds(scope, packingId);
    const body = parseRegisterPackingLabelPrintCommand(command);
    return parseApiPackingAction(
      await backendFetch<unknown>(`/logistics/packing/${packingId}/label/print`, {
        method: "POST",
        query: { branchId: scope.branchId },
        body,
      }),
    );
  }

  async finalize(
    scope: PackingScope,
    packingId: string,
    command: PackingVersionedApiCommand,
  ): Promise<FinalizePackingCommandResult> {
    this.assertIds(scope, packingId);
    const body = parsePackingVersionedCommand(command);
    return parseApiPackingFinalize(
      await backendFetch<unknown>(`/logistics/packing/${packingId}/finalize`, {
        method: "POST",
        query: { branchId: scope.branchId },
        body,
      }),
    );
  }

  private assertIds(scope: PackingScope, packingId: string) {
    assertApiUuid(scope.branchId, "branchId");
    assertApiUuid(packingId, "packingId");
  }
}
