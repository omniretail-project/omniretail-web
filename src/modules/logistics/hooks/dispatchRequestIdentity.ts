import { BackendRequestError } from "@/infrastructure/api/backendClient";

const DEFAULT_MAX_RETAINED_OPERATION_IDS = 64;

export function createDispatchOperationFingerprint(input: {
  action: "confirm-order" | "confirm-transfer";
  sessionId: string;
  userId: string;
  tenantId: string;
  branchId: string;
  sourceType: "order" | "transfer";
  sourceId: string;
  payload?: unknown;
}): string {
  return JSON.stringify({
    action: input.action,
    sessionId: input.sessionId,
    userId: input.userId,
    tenantId: input.tenantId,
    branchId: input.branchId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    payload: input.payload ?? null,
  });
}

export class DispatchMutationCoordinator {
  private activeRequestToken: number | null = null;
  private nextRequestToken = 0;
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  private readonly pendingOperationIds = new Map<string, string>();

  constructor(private readonly maxRetainedOperationIds = DEFAULT_MAX_RETAINED_OPERATION_IDS) {
    if (!Number.isInteger(maxRetainedOperationIds) || maxRetainedOperationIds < 1) {
      throw new Error("Dispatch operation identity retention must be a positive integer.");
    }
  }

  isRequestInFlight(): boolean {
    return this.activeRequestToken !== null;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getRevision = (): number => this.revision;

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

  getOrCreateOperationId(fingerprint: string, createId = () => crypto.randomUUID()): string {
    const current = this.pendingOperationIds.get(fingerprint);
    if (current) {
      this.pendingOperationIds.delete(fingerprint);
      this.pendingOperationIds.set(fingerprint, current);
      return current;
    }
    while (this.pendingOperationIds.size >= this.maxRetainedOperationIds) {
      const oldest = this.pendingOperationIds.keys().next().value;
      if (oldest === undefined) break;
      this.pendingOperationIds.delete(oldest);
    }
    const operationId = createId();
    this.pendingOperationIds.set(fingerprint, operationId);
    return operationId;
  }

  markOperationDefinitive(fingerprint: string): void {
    this.pendingOperationIds.delete(fingerprint);
  }

  retainedOperationCount(): number {
    return this.pendingOperationIds.size;
  }

  private emitChange(): void {
    this.revision += 1;
    this.listeners.forEach((listener) => listener());
  }
}

export function shouldRetainDispatchOperationIdentity(cause: unknown): boolean {
  if (!(cause instanceof BackendRequestError)) return true;
  return cause.status === 0 || cause.status === 408 || cause.status >= 500;
}
