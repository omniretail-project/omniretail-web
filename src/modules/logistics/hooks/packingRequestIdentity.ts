import { BackendRequestError } from "@/infrastructure/api/backendClient";

const DEFAULT_MAX_RETAINED_OPERATION_IDS = 64;

export interface PackingRequestIdentity {
  sequence: number;
  currentSequence: number;
  requestedBranchId: string;
  activeBranchId: string | null;
  requestedPackingId?: string;
  selectedPackingId?: string | null;
}

export function isCurrentPackingRequest(identity: PackingRequestIdentity): boolean {
  return identity.sequence === identity.currentSequence &&
    identity.requestedBranchId === identity.activeBranchId &&
    (identity.requestedPackingId === undefined ||
      identity.requestedPackingId === identity.selectedPackingId);
}

export function createPackingOperationFingerprint(input: {
  action: string;
  branchId: string;
  packingId: string;
  expectedVersion: number;
  payload?: unknown;
}): string {
  return JSON.stringify({
    action: input.action,
    branchId: input.branchId,
    packingId: input.packingId,
    expectedVersion: input.expectedVersion,
    payload: input.payload ?? null,
  });
}

export function getOrCreatePackingOperationId(
  pending: Map<string, string>,
  fingerprint: string,
  createId: () => string = () => crypto.randomUUID(),
): string {
  const current = pending.get(fingerprint);
  if (current) return current;
  const created = createId();
  pending.set(fingerprint, created);
  return created;
}

export class PackingMutationCoordinator {
  private activeRequestToken: number | null = null;
  private nextRequestToken = 0;
  private readonly pendingOperationIds = new Map<string, string>();

  constructor(
    private readonly maxRetainedOperationIds = DEFAULT_MAX_RETAINED_OPERATION_IDS,
  ) {
    if (!Number.isInteger(maxRetainedOperationIds) || maxRetainedOperationIds < 1) {
      throw new Error("Packing operation identity retention must be a positive integer.");
    }
  }

  isRequestInFlight(): boolean {
    return this.activeRequestToken !== null;
  }

  beginRequest(): number | null {
    if (this.activeRequestToken !== null) return null;
    const token = ++this.nextRequestToken;
    this.activeRequestToken = token;
    return token;
  }

  finishRequest(token: number): boolean {
    if (this.activeRequestToken !== token) return false;
    this.activeRequestToken = null;
    return true;
  }

  getOrCreateOperationId(
    fingerprint: string,
    createId?: () => string,
  ): string {
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
    return getOrCreatePackingOperationId(this.pendingOperationIds, fingerprint, createId);
  }

  markOperationDefinitive(fingerprint: string): void {
    this.pendingOperationIds.delete(fingerprint);
  }

  retainedOperationCount(): number {
    return this.pendingOperationIds.size;
  }
}

export function shouldRetainPackingOperationIdentity(cause: unknown): boolean {
  if (!(cause instanceof BackendRequestError)) return true;
  return cause.status === 0 || cause.status === 408 || cause.status >= 500;
}

export function isPackingVersionCurrentOrNewer(
  currentVersion: number | null | undefined,
  incomingVersion: number,
): boolean {
  return currentVersion === null || currentVersion === undefined || incomingVersion >= currentVersion;
}

export async function resolvePackingMutationSnapshot<TPacking>(input: {
  packing: TPacking;
  idempotent: boolean;
  readCurrent: () => Promise<TPacking>;
}): Promise<TPacking> {
  return input.idempotent ? input.readCurrent() : input.packing;
}
