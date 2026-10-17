import type { DispatchApiReadScope, DispatchResultReadModel } from "@/core/repositories/DispatchReadRepository";

export interface ConfirmDispatchPackageApiCommand {
  number: string;
  weight?: number;
  description?: string;
}

export interface ConfirmDispatchApiCommand {
  operationId: string;
  carrierName?: string;
  trackingNumber?: string;
  packages?: ConfirmDispatchPackageApiCommand[];
}

export interface ConfirmTransferDispatchApiCommand {
  operationId: string;
}

/** Comandos REST de Dispatch; tenant y actor se derivan de la sesion autenticada. */
export interface DispatchCommandRepository {
  confirmOrder(
    scope: DispatchApiReadScope,
    orderId: string,
    command: ConfirmDispatchApiCommand,
  ): Promise<DispatchResultReadModel>;
  confirmTransfer(
    scope: DispatchApiReadScope,
    transferId: string,
    command: ConfirmTransferDispatchApiCommand,
  ): Promise<DispatchResultReadModel>;
}
