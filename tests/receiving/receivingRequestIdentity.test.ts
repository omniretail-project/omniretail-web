import { beforeEach, describe, expect, it } from "vitest";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import {
  PersistentJsonStore,
  type PersistentJsonReadResult,
} from "@/infrastructure/storage/PersistentJsonStore";
import {
  PendingTransferReceptionError,
  PendingTransferReceptionStore,
  createReceivingConfirmationFingerprint,
  type TransferReceptionOperationPayload,
  type TransferReceptionOperationScope,
} from "@/modules/receiving/application/services/pendingTransferReception";
import {
  ReceivingMutationCoordinator,
  canDiscardReceivingConfirmation,
  shouldRetainReceivingConfirmationIdentity,
} from "@/modules/receiving/hooks/receivingRequestIdentity";
import { disableBrowserLocks, installBrowserLocksHarness } from "./browserLocksTestHarness";

const scope: TransferReceptionOperationScope = {
  sessionId: "session-1",
  userId: "user-1",
  tenantId: "tenant-1",
  branchId: "branch-1",
  documentType: "transfer",
  documentId: "transfer-1",
};
const payload: TransferReceptionOperationPayload = {
  destinationLocationId: "location-1",
  items: [{ itemId: "item-1", productId: "product-1", receivedQuantity: 2 }],
};

describe("receiving confirmation identity", () => {
  beforeEach(() => {
    window.localStorage.clear();
    installBrowserLocksHarness();
  });

  it("changes when security scope, document, location or item payload changes", () => {
    const fingerprint = createReceivingConfirmationFingerprint({ scope, payload });

    expect(createReceivingConfirmationFingerprint({
      scope: { ...scope, branchId: "branch-2" },
      payload,
    })).not.toBe(fingerprint);
    expect(createReceivingConfirmationFingerprint({
      scope: { ...scope, documentId: "transfer-2" },
      payload,
    })).not.toBe(fingerprint);
    expect(createReceivingConfirmationFingerprint({
      scope,
      payload: { ...payload, destinationLocationId: "location-2" },
    })).not.toBe(fingerprint);
    expect(createReceivingConfirmationFingerprint({
      scope,
      payload: {
        ...payload,
        items: [{ ...payload.items[0], receivedQuantity: 3 }],
      },
    })).not.toBe(fingerprint);
  });

  it("persists and reuses the exact operation after closing and reopening a tab", () => {
    const first = new ReceivingMutationCoordinator();
    const prepared = first.prepareTransferConfirmation(scope, payload, () => "confirmation-1");
    const reloaded = new ReceivingMutationCoordinator();

    expect(reloaded.lookupTransferConfirmation(scope)).toMatchObject({
      status: "owned",
      record: { confirmationId: "confirmation-1", attempts: 1, payload },
    });
    expect(reloaded.prepareTransferConfirmation(scope, payload)).toMatchObject({
      confirmationId: prepared.confirmationId,
      attempts: 2,
    });
  });

  it("blocks a different payload and a different session for the same resource", () => {
    const coordinator = new ReceivingMutationCoordinator();
    coordinator.prepareTransferConfirmation(scope, payload, () => "confirmation-1");

    expect(() => coordinator.prepareTransferConfirmation(scope, {
      ...payload,
      items: [{ ...payload.items[0], receivedQuantity: 3 }],
    })).toThrow(PendingTransferReceptionError);
    expect(() => coordinator.prepareTransferConfirmation(
      { ...scope, sessionId: "session-2" },
      payload,
    )).toThrow(/otra sesión/i);
    expect(coordinator.lookupTransferConfirmation({
      ...scope,
      sessionId: "session-2",
      userId: "user-2",
    }).status).toBe("foreign");
    expect(coordinator.lookupTransferConfirmation({
      ...scope,
      sessionId: "session-2",
      userId: "user-2",
      tenantId: "tenant-2",
    })).toEqual({ status: "empty" });
  });

  it("blocks a new confirmation when the persisted operation cannot be verified", () => {
    window.localStorage.setItem(
      "omniretail.receiving.pending-transfer.v1",
      JSON.stringify({ version: 1, records: [{ invalid: true }] }),
    );
    const coordinator = new ReceivingMutationCoordinator();

    expect(coordinator.lookupTransferConfirmation(scope)).toEqual({ status: "invalid" });
    expect(() => coordinator.prepareTransferConfirmation(scope, payload))
      .toThrow(/registro local está dañado/i);
  });

  it("blocks before executing when safe browser coordination is unavailable", async () => {
    disableBrowserLocks();
    const coordinator = new ReceivingMutationCoordinator();
    let executed = false;

    await expect(coordinator.runWithTransferLock(scope, async () => {
      executed = true;
    })).rejects.toThrow(/no ofrece coordinación segura/i);

    expect(executed).toBe(false);
    expect(coordinator.lookupTransferConfirmation(scope)).toEqual({ status: "empty" });
  });

  it("blocks when persistent storage is inaccessible", () => {
    class UnavailableStore extends PersistentJsonStore {
      override read<T>(): PersistentJsonReadResult<T> {
        return { status: "unavailable" as const };
      }

      override set<T>(key: string, value: T): boolean {
        void key;
        void value;
        return false;
      }
    }
    const coordinator = new ReceivingMutationCoordinator(
      new PendingTransferReceptionStore(new UnavailableStore()),
    );

    expect(coordinator.lookupTransferConfirmation(scope)).toEqual({ status: "unavailable" });
    expect(() => coordinator.prepareTransferConfirmation(scope, payload))
      .toThrow(/no se puede guardar de forma segura/i);
  });

  it("prevents two independent tabs from starting the same transfer simultaneously", async () => {
    const firstTab = new ReceivingMutationCoordinator();
    const secondTab = new ReceivingMutationCoordinator();
    let releaseFirst!: () => void;
    const firstInFlight = firstTab.runWithTransferLock(scope, async () => {
      firstTab.prepareTransferConfirmation(scope, payload, () => "confirmation-1");
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
    });
    await Promise.resolve();
    let secondExecuted = false;

    await expect(secondTab.runWithTransferLock(scope, async () => {
      secondExecuted = true;
      secondTab.prepareTransferConfirmation(scope, payload, () => "confirmation-2");
    })).rejects.toThrow(/otra pestaña está confirmando/i);

    expect(secondExecuted).toBe(false);
    expect(secondTab.lookupTransferConfirmation(scope)).toMatchObject({
      status: "owned",
      record: { confirmationId: "confirmation-1", payload },
    });
    releaseFirst();
    await firstInFlight;

    const retried = await secondTab.runWithTransferLock(scope, async () =>
      secondTab.prepareTransferConfirmation(scope, payload, () => "confirmation-2"),
    );
    expect(retried).toMatchObject({ confirmationId: "confirmation-1", attempts: 2, payload });
  });

  it("clears only after an authoritative outcome and never evicts uncertain records", () => {
    const store = new PendingTransferReceptionStore(new PersistentJsonStore(), 1);
    const coordinator = new ReceivingMutationCoordinator(store);
    coordinator.prepareTransferConfirmation(scope, payload, () => "confirmation-1");

    expect(() => coordinator.prepareTransferConfirmation(
      { ...scope, documentId: "transfer-2" },
      payload,
    )).toThrow(/demasiadas confirmaciones inciertas/i);
    expect(coordinator.retainedConfirmationCount()).toBe(1);

    coordinator.clearTransferConfirmation(scope);
    expect(coordinator.lookupTransferConfirmation(scope)).toEqual({ status: "empty" });
    expect(coordinator.retainedConfirmationCount()).toBe(0);
  });

  it("distinguishes uncertain failures and only discards a first definitive rejection", () => {
    for (const status of [0, 408, 429, 500, 503]) {
      expect(shouldRetainReceivingConfirmationIdentity(new BackendRequestError("x", status)))
        .toBe(true);
    }
    expect(shouldRetainReceivingConfirmationIdentity(new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldRetainReceivingConfirmationIdentity(new BackendRequestError("Invalid", 400)))
      .toBe(false);
    expect(shouldRetainReceivingConfirmationIdentity(new Error("Validación local"))).toBe(false);
    expect(canDiscardReceivingConfirmation(new BackendRequestError("Invalid", 400), 1))
      .toBe(true);
    expect(canDiscardReceivingConfirmation(new BackendRequestError("Invalid", 400), 2))
      .toBe(false);
  });

  it("allows only the owner token to release the active mutation", () => {
    const coordinator = new ReceivingMutationCoordinator();
    const token = coordinator.beginRequest();

    expect(token).not.toBeNull();
    expect(coordinator.beginRequest()).toBeNull();
    expect(coordinator.finishRequest((token ?? 0) + 1)).toBe(false);
    expect(coordinator.isRequestInFlight()).toBe(true);
    expect(coordinator.finishRequest(token ?? 0)).toBe(true);
    expect(coordinator.isRequestInFlight()).toBe(false);
  });
});
