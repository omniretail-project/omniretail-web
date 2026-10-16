import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { BrowserExclusiveLock } from "@/infrastructure/concurrency/BrowserExclusiveLock";
import {
  createReceivingConfirmationFingerprint,
  PendingTransferReceptionError,
  PendingTransferReceptionStore,
  receivingOperationResourceKey,
  type PendingTransferReceptionLookup,
  type TransferReceptionOperationPayload,
  type TransferReceptionOperationScope,
} from "@/modules/receiving/application/services/pendingTransferReception";

export { createReceivingConfirmationFingerprint };

type ReceivingExclusiveLock = Pick<BrowserExclusiveLock, "runIfAvailable">;

export class ReceivingMutationCoordinator {
  private activeRequestToken: number | null = null;
  private nextRequestToken = 0;
  private revision = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly pendingStore = new PendingTransferReceptionStore(),
    private readonly exclusiveLock: ReceivingExclusiveLock = new BrowserExclusiveLock(),
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getRevision = (): number => this.revision;

  isRequestInFlight(): boolean {
    return this.activeRequestToken !== null;
  }

  runWithTransferLock<T>(
    scope: TransferReceptionOperationScope,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.exclusiveLock.runIfAvailable(
      `omniretail.receiving.transfer:${receivingOperationResourceKey(scope)}`,
      operation,
    );
  }

  beginRequest(): number | null {
    if (this.activeRequestToken !== null) return null;
    const token = ++this.nextRequestToken;
    this.activeRequestToken = token;
    this.emitChange();
    return token;
  }

  finishRequest(token: number): boolean {
    if (this.activeRequestToken !== token) return false;
    this.activeRequestToken = null;
    this.emitChange();
    return true;
  }

  lookupTransferConfirmation(
    scope: TransferReceptionOperationScope,
  ): PendingTransferReceptionLookup {
    return this.pendingStore.lookup(scope);
  }

  prepareTransferConfirmation(
    scope: TransferReceptionOperationScope,
    payload: TransferReceptionOperationPayload,
    createId?: () => string,
  ) {
    const pending = this.pendingStore.prepare(scope, payload, createId);
    this.emitChange();
    return pending;
  }

  clearTransferConfirmation(scope: TransferReceptionOperationScope): void {
    this.pendingStore.clear(scope);
    this.emitChange();
  }

  retainedConfirmationCount(): number {
    return this.pendingStore.count();
  }

  private emitChange(): void {
    this.revision += 1;
    this.listeners.forEach((listener) => listener());
  }
}

export function shouldRetainReceivingConfirmationIdentity(cause: unknown): boolean {
  if (cause instanceof PendingTransferReceptionError) return true;
  if (cause instanceof BackendRequestError) {
    return cause.status === 0 || cause.status === 408 || cause.status === 429 || cause.status >= 500;
  }
  if (cause instanceof Error) return cause instanceof TypeError;
  return true;
}

export function canDiscardReceivingConfirmation(cause: unknown, attempts: number): boolean {
  return attempts <= 1 && !shouldRetainReceivingConfirmationIdentity(cause);
}
