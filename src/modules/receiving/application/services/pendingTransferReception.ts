import { PersistentJsonStore } from "@/infrastructure/storage/PersistentJsonStore";

const STORAGE_KEY = "omniretail.receiving.pending-transfer.v1";
const MAX_PENDING_OPERATIONS = 64;

export interface TransferReceptionOperationScope {
  sessionId: string;
  userId: string;
  tenantId: string;
  branchId: string;
  documentType: "transfer";
  documentId: string;
}

export interface TransferReceptionOperationPayload {
  destinationLocationId: string;
  items: Array<{ itemId: string; productId: string; receivedQuantity: number }>;
}

export interface PendingTransferReception {
  version: 1;
  scope: TransferReceptionOperationScope;
  fingerprint: string;
  confirmationId: string;
  payload: TransferReceptionOperationPayload;
  createdAt: string;
  lastAttemptAt: string;
  attempts: number;
}

export type PendingTransferReceptionLookup =
  | { status: "empty" | "invalid" | "unavailable" }
  | { status: "owned" | "foreign"; record: PendingTransferReception };

interface PendingTransferReceptionEnvelope {
  version: 1;
  records: PendingTransferReception[];
}

export class PendingTransferReceptionError extends Error {}

export function createReceivingConfirmationFingerprint(input: {
  scope: TransferReceptionOperationScope;
  payload: TransferReceptionOperationPayload;
}): string {
  return JSON.stringify({
    action: "confirm-transfer-receiving",
    sessionId: input.scope.sessionId,
    userId: input.scope.userId,
    tenantId: input.scope.tenantId,
    branchId: input.scope.branchId,
    documentType: input.scope.documentType,
    documentId: input.scope.documentId,
    destinationLocationId: input.payload.destinationLocationId,
    items: canonicalItems(input.payload.items),
  });
}

export function receivingOperationScopeKey(scope: TransferReceptionOperationScope): string {
  return JSON.stringify([
    scope.sessionId,
    scope.userId,
    scope.tenantId,
    scope.branchId,
    scope.documentType,
    scope.documentId,
  ]);
}

export function receivingOperationResourceKey(scope: TransferReceptionOperationScope): string {
  return JSON.stringify([
    scope.tenantId,
    scope.branchId,
    scope.documentType,
    scope.documentId,
  ]);
}

export function sameTransferReceptionPayload(
  left: TransferReceptionOperationPayload,
  right: TransferReceptionOperationPayload,
): boolean {
  return JSON.stringify({
    destinationLocationId: left.destinationLocationId,
    items: canonicalItems(left.items),
  }) === JSON.stringify({
    destinationLocationId: right.destinationLocationId,
    items: canonicalItems(right.items),
  });
}

export class PendingTransferReceptionStore {
  constructor(
    private readonly store = new PersistentJsonStore(),
    private readonly maxPendingOperations = MAX_PENDING_OPERATIONS,
  ) {
    if (!Number.isInteger(maxPendingOperations) || maxPendingOperations < 1) {
      throw new Error("Receiving pending operation limit must be a positive integer.");
    }
  }

  lookup(scope: TransferReceptionOperationScope): PendingTransferReceptionLookup {
    const envelope = this.readEnvelope();
    if (envelope.status !== "value") return envelope;
    const scopeKey = receivingOperationScopeKey(scope);
    const resourceKey = receivingOperationResourceKey(scope);
    const owned = envelope.records.find(
      (record) => receivingOperationScopeKey(record.scope) === scopeKey,
    );
    if (owned) return { status: "owned", record: owned };
    const foreign = envelope.records.find(
      (record) => receivingOperationResourceKey(record.scope) === resourceKey,
    );
    return foreign ? { status: "foreign", record: foreign } : { status: "empty" };
  }

  prepare(
    scope: TransferReceptionOperationScope,
    payload: TransferReceptionOperationPayload,
    createId: () => string = () => crypto.randomUUID(),
    now: () => string = () => new Date().toISOString(),
  ): PendingTransferReception {
    const envelope = this.readEnvelope();
    if (envelope.status === "invalid") {
      throw new PendingTransferReceptionError(
        "No se puede verificar una confirmación anterior porque el registro local está dañado.",
      );
    }
    if (envelope.status === "unavailable") {
      throw new PendingTransferReceptionError(
        "No se puede guardar de forma segura la identidad de confirmación en este navegador.",
      );
    }
    const records = envelope.status === "value" ? envelope.records : [];
    const lookup = this.lookupInRecords(records, scope);
    if (lookup.status === "foreign") {
      throw new PendingTransferReceptionError(
        "Existe una confirmación incierta de este traslado iniciada en otra sesión. No se enviará una confirmación nueva.",
      );
    }
    const fingerprint = createReceivingConfirmationFingerprint({ scope, payload });
    const timestamp = now();
    if (lookup.status === "owned") {
      if (
        lookup.record.fingerprint !== fingerprint ||
        !sameTransferReceptionPayload(lookup.record.payload, payload)
      ) {
        throw new PendingTransferReceptionError(
          "Existe una confirmación incierta con cantidades o ubicación diferentes. Reintenta únicamente el payload original.",
        );
      }
      const updated = {
        ...lookup.record,
        lastAttemptAt: timestamp,
        attempts: lookup.record.attempts + 1,
      };
      this.writeOrThrow(records.map((record) =>
        receivingOperationScopeKey(record.scope) === receivingOperationScopeKey(scope)
          ? updated
          : record,
      ));
      return updated;
    }
    if (records.length >= this.maxPendingOperations) {
      throw new PendingTransferReceptionError(
        "Hay demasiadas confirmaciones inciertas pendientes de verificar. No se descartará ninguna automáticamente.",
      );
    }
    const created: PendingTransferReception = {
      version: 1,
      scope,
      fingerprint,
      confirmationId: createId(),
      payload: {
        destinationLocationId: payload.destinationLocationId,
        items: canonicalItems(payload.items),
      },
      createdAt: timestamp,
      lastAttemptAt: timestamp,
      attempts: 1,
    };
    this.writeOrThrow([...records, created]);
    return created;
  }

  clear(scope: TransferReceptionOperationScope): void {
    const envelope = this.readEnvelope();
    if (envelope.status !== "value") return;
    const scopeKey = receivingOperationScopeKey(scope);
    const records = envelope.records.filter(
      (record) => receivingOperationScopeKey(record.scope) !== scopeKey,
    );
    if (records.length === envelope.records.length) return;
    if (records.length === 0) {
      this.store.remove(STORAGE_KEY);
      return;
    }
    this.writeOrThrow(records);
  }

  count(): number {
    const envelope = this.readEnvelope();
    return envelope.status === "value" ? envelope.records.length : 0;
  }

  private lookupInRecords(
    records: PendingTransferReception[],
    scope: TransferReceptionOperationScope,
  ): PendingTransferReceptionLookup {
    const scopeKey = receivingOperationScopeKey(scope);
    const resourceKey = receivingOperationResourceKey(scope);
    const owned = records.find((record) => receivingOperationScopeKey(record.scope) === scopeKey);
    if (owned) return { status: "owned", record: owned };
    const foreign = records.find(
      (record) => receivingOperationResourceKey(record.scope) === resourceKey,
    );
    return foreign ? { status: "foreign", record: foreign } : { status: "empty" };
  }

  private readEnvelope():
    | { status: "empty" | "invalid" | "unavailable" }
    | { status: "value"; records: PendingTransferReception[] } {
    const result = this.store.read<unknown>(STORAGE_KEY);
    if (result.status !== "value") return result;
    if (!isEnvelope(result.value)) return { status: "invalid" };
    return { status: "value", records: result.value.records };
  }

  private writeOrThrow(records: PendingTransferReception[]): void {
    const envelope: PendingTransferReceptionEnvelope = { version: 1, records };
    if (!this.store.set(STORAGE_KEY, envelope)) {
      throw new PendingTransferReceptionError(
        "No se pudo conservar la identidad de confirmación. No se enviará la operación.",
      );
    }
  }
}

function canonicalItems(items: TransferReceptionOperationPayload["items"]) {
  return items
    .map((item) => ({
      itemId: item.itemId,
      productId: item.productId,
      receivedQuantity: item.receivedQuantity,
    }))
    .sort((left, right) =>
      left.itemId.localeCompare(right.itemId) || left.productId.localeCompare(right.productId),
    );
}

function isEnvelope(value: unknown): value is PendingTransferReceptionEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { version?: unknown; records?: unknown };
  return candidate.version === 1 && Array.isArray(candidate.records) &&
    candidate.records.every(isPendingTransferReception);
}

function isPendingTransferReception(value: unknown): value is PendingTransferReception {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PendingTransferReception>;
  if (
    candidate.version !== 1 ||
    !candidate.scope ||
    !candidate.payload ||
    typeof candidate.confirmationId !== "string" ||
    !candidate.confirmationId ||
    typeof candidate.fingerprint !== "string" ||
    typeof candidate.createdAt !== "string" ||
    typeof candidate.lastAttemptAt !== "string" ||
    !Number.isInteger(candidate.attempts) ||
    (candidate.attempts ?? 0) < 1
  ) return false;
  const scope = candidate.scope;
  const payload = candidate.payload;
  if (
    scope.documentType !== "transfer" ||
    [scope.sessionId, scope.userId, scope.tenantId, scope.branchId, scope.documentId]
      .some((entry) => typeof entry !== "string" || !entry)
  ) return false;
  if (
    typeof payload.destinationLocationId !== "string" ||
    !payload.destinationLocationId ||
    !Array.isArray(payload.items) ||
    payload.items.length === 0 ||
    payload.items.some((item) =>
      !item ||
      typeof item.itemId !== "string" ||
      !item.itemId ||
      typeof item.productId !== "string" ||
      !item.productId ||
      typeof item.receivedQuantity !== "number" ||
      !Number.isFinite(item.receivedQuantity) ||
      item.receivedQuantity <= 0,
    )
  ) return false;
  return candidate.fingerprint === createReceivingConfirmationFingerprint({ scope, payload });
}
