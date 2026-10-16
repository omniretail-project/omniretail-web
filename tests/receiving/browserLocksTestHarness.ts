import { vi } from "vitest";

export function installBrowserLocksHarness() {
  const heldNames = new Set<string>();
  const request = vi.fn(async <T>(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<T> | T,
  ): Promise<T> => {
    if (options.ifAvailable && heldNames.has(name)) return callback(null);
    heldNames.add(name);
    try {
      return await callback({ name, mode: options.mode ?? "exclusive" } as Lock);
    } finally {
      heldNames.delete(name);
    }
  });
  Object.defineProperty(window.navigator, "locks", {
    configurable: true,
    value: { request },
  });
  return { heldNames, request };
}

export function disableBrowserLocks() {
  Object.defineProperty(window.navigator, "locks", {
    configurable: true,
    value: undefined,
  });
}
