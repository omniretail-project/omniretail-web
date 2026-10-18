import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPLOYEE_LAST_ACTIVITY_STORAGE_KEY } from "@/infrastructure/storage/storageKeys";

const state = vi.hoisted(() => ({
  sessionCreatedAt: "",
  getSession: vi.fn(),
  getCurrentSessionId: vi.fn(),
  logout: vi.fn(),
  clearLocalSession: vi.fn(),
  routerReplace: vi.fn(),
  pingSession: vi.fn(),
}));

vi.mock("@/infrastructure/providers/RepositoryProvider", () => {
  const repositories = {
    auth: {
      getSession: state.getSession,
      getCurrentSessionId: state.getCurrentSessionId,
      logout: state.logout,
      clearLocalSession: state.clearLocalSession,
    },
  };
  return { useRepositories: () => repositories };
});
vi.mock("@/modules/auth/hooks/useCurrentSession", () => {
  const session = { user: { id: "user-1", type: "employee" }, sessionId: "session-1" };
  return { useCurrentSession: () => session };
});
vi.mock("@/infrastructure/api/sessionHeartbeat", () => ({ pingSession: state.pingSession }));
vi.mock("next/navigation", () => {
  const router = { replace: state.routerReplace };
  return { useRouter: () => router };
});

import {
  EMPLOYEE_ACTIVITY_WRITE_INTERVAL_MS,
  EMPLOYEE_INACTIVITY_TIMEOUT_MS,
  EMPLOYEE_SESSION_HEARTBEAT_MS,
  EmployeeInactivityTimeout,
  storedActivityForSession,
} from "@/modules/auth/components/EmployeeInactivityTimeout";

const MINUTE = 60 * 1000;
const NOW = new Date("2026-10-18T15:00:00.000Z").getTime();
const TIMEOUT = EMPLOYEE_INACTIVITY_TIMEOUT_MS;

function storedStamp(): string | null {
  return window.localStorage.getItem(EMPLOYEE_LAST_ACTIVITY_STORAGE_KEY);
}

function otherTabWrites(newValue: string | null) {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: EMPLOYEE_LAST_ACTIVITY_STORAGE_KEY, newValue }));
  });
}

/** Monta el componente y deja terminar la revision inicial (lectura de la sesion). */
async function mount() {
  render(<EmployeeInactivityTimeout />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function expectSessionClosed() {
  expect(state.logout).toHaveBeenCalledWith("session-1");
  expect(state.clearLocalSession).toHaveBeenCalledTimes(1);
  expect(state.routerReplace).toHaveBeenCalledWith("/iniciar-sesion");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
  window.localStorage.clear();
  state.sessionCreatedAt = new Date(NOW - 3 * TIMEOUT).toISOString();
  state.getSession.mockReset();
  state.getSession.mockImplementation(async () => ({ id: "session-1", createdAt: state.sessionCreatedAt }));
  state.getCurrentSessionId.mockReset();
  state.getCurrentSessionId.mockResolvedValue("session-1");
  state.logout.mockReset();
  state.logout.mockResolvedValue(undefined);
  state.clearLocalSession.mockReset();
  state.clearLocalSession.mockResolvedValue(undefined);
  state.routerReplace.mockReset();
  state.pingSession.mockReset();
  state.pingSession.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe("EmployeeInactivityTimeout con la marca compartida entre pestañas", () => {
  it("al montar cierra la sesion si la ultima actividad guardada supera el tiempo de inactividad", async () => {
    window.localStorage.setItem(EMPLOYEE_LAST_ACTIVITY_STORAGE_KEY, String(NOW - TIMEOUT - MINUTE));

    await mount();

    expectSessionClosed();
    expect(storedStamp()).toBeNull();
  });

  it("con actividad reciente guardada solo cierra cuando se cumple el tiempo de inactividad desde esa marca", async () => {
    window.localStorage.setItem(EMPLOYEE_LAST_ACTIVITY_STORAGE_KEY, String(NOW - 5 * MINUTE));

    await mount();
    await advance(TIMEOUT - 5 * MINUTE - 1000);
    expect(state.logout).not.toHaveBeenCalled();

    await advance(1000);
    expectSessionClosed();
  });

  it("ignora una marca anterior al inicio de la sesion y empieza a contar desde ahora", async () => {
    state.sessionCreatedAt = new Date(NOW - MINUTE).toISOString();
    window.localStorage.setItem(EMPLOYEE_LAST_ACTIVITY_STORAGE_KEY, String(NOW - 3 * TIMEOUT));

    await mount();

    expect(state.logout).not.toHaveBeenCalled();
    expect(storedStamp()).toBe(String(NOW));
  });

  it("la actividad en otra pestaña aplaza el cierre", async () => {
    await mount();
    await advance(TIMEOUT - 10 * MINUTE);

    otherTabWrites(String(Date.now()));
    // Sin esa actividad la sesion ya se habria cerrado aqui.
    await advance(TIMEOUT - 10 * MINUTE);
    expect(state.logout).not.toHaveBeenCalled();

    await advance(10 * MINUTE);
    expectSessionClosed();
  });

  it("ignora un valor invalido escrito por otra pestaña", async () => {
    await mount();

    otherTabWrites("no-es-una-fecha");
    await advance(MINUTE);

    expect(state.logout).not.toHaveBeenCalled();
  });

  it("cierra la sesion cuando otra pestaña la cerro por inactividad (marca borrada)", async () => {
    await mount();

    otherTabWrites(null);
    await advance(0);

    expectSessionClosed();
  });

  it("al volver a la pestaña cierra la sesion si la marca compartida ya vencio", async () => {
    await mount();
    // Simula una pestaña congelada en segundo plano: el reloj avanza pero su temporizador no corre.
    vi.setSystemTime(NOW + TIMEOUT + MINUTE);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(0);

    expectSessionClosed();
  });

  it("guarda la actividad como maximo cada 10 segundos", async () => {
    await mount();
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    await advance(EMPLOYEE_ACTIVITY_WRITE_INTERVAL_MS);
    for (let i = 0; i < 5; i += 1) window.dispatchEvent(new Event("pointerdown"));
    await advance(EMPLOYEE_ACTIVITY_WRITE_INTERVAL_MS / 2);
    window.dispatchEvent(new Event("scroll"));

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(storedStamp()).toBe(String(NOW + EMPLOYEE_ACTIVITY_WRITE_INTERVAL_MS));
  });

  it("la actividad de la revision inicial no pisa una marca vieja", async () => {
    let finishSession: () => void = () => undefined;
    state.getSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSession = () => resolve({ id: "session-1", createdAt: state.sessionCreatedAt });
        }),
    );
    window.localStorage.setItem(EMPLOYEE_LAST_ACTIVITY_STORAGE_KEY, String(NOW - TIMEOUT - MINUTE));

    render(<EmployeeInactivityTimeout />);
    await advance(EMPLOYEE_ACTIVITY_WRITE_INTERVAL_MS);
    window.dispatchEvent(new Event("pointerdown"));
    expect(storedStamp()).toBe(String(NOW - TIMEOUT - MINUTE));

    finishSession();
    await advance(0);
    expectSessionClosed();
  });

  it("sin localStorage disponible sigue cerrando la sesion en memoria", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    await mount();
    await advance(TIMEOUT - 1000);
    expect(state.logout).not.toHaveBeenCalled();

    await advance(1000);
    expectSessionClosed();
  });
});

describe("EmployeeInactivityTimeout: heartbeat de sesion (modo api)", () => {
  const HEARTBEAT = EMPLOYEE_SESSION_HEARTBEAT_MS;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "api");
  });

  /** Actividad real cada 10 s durante `ms` (teclear en un formulario largo). */
  async function typeDuring(ms: number) {
    for (let elapsed = 0; elapsed < ms; elapsed += 10 * 1000) {
      window.dispatchEvent(new Event("keydown"));
      await advance(10 * 1000);
    }
  }

  it("con actividad continua llama como maximo una vez cada 5 minutos", async () => {
    await mount();

    await typeDuring(HEARTBEAT - 10 * 1000);
    expect(state.pingSession).not.toHaveBeenCalled();

    await typeDuring(20 * MINUTE);
    // Pings a los 5, 10, 15 y 20 minutos de actividad.
    expect(state.pingSession).toHaveBeenCalledTimes(4);
  });

  it("deja al menos 5 minutos entre dos llamadas", async () => {
    await mount();
    const pingAt: number[] = [];
    state.pingSession.mockImplementation(async () => {
      pingAt.push(Date.now());
    });

    await typeDuring(30 * MINUTE);

    expect(pingAt.length).toBeGreaterThan(0);
    pingAt.forEach((at, index) => {
      const previous = index === 0 ? NOW : pingAt[index - 1];
      expect(at - previous).toBeGreaterThanOrEqual(HEARTBEAT);
    });
  });

  it("sin actividad no llama, y la inactividad real cierra la sesion", async () => {
    await mount();

    await advance(TIMEOUT);

    expect(state.pingSession).not.toHaveBeenCalled();
    expectSessionClosed();
  });

  it("la actividad de otra pestaña no hace ping en esta", async () => {
    await mount();

    for (let i = 1; i <= 4; i += 1) {
      await advance(HEARTBEAT);
      otherTabWrites(String(Date.now()));
    }

    expect(state.pingSession).not.toHaveBeenCalled();
  });

  it("en modo mock no llama nunca", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MODE", "mock");
    await mount();

    await typeDuring(20 * MINUTE);

    expect(state.pingSession).not.toHaveBeenCalled();
  });
});

describe("EMPLOYEE_INACTIVITY_TIMEOUT_MS", () => {
  it("es de 60 minutos, igual que el backend", () => {
    expect(TIMEOUT).toBe(60 * MINUTE);
  });
});

describe("storedActivityForSession", () => {
  it("solo cuenta marcas de la sesion actual", () => {
    expect(storedActivityForSession(200, 100)).toBe(200);
    expect(storedActivityForSession(100, 100)).toBe(100);
    expect(storedActivityForSession(50, 100)).toBeNull();
    expect(storedActivityForSession(null, 100)).toBeNull();
    expect(storedActivityForSession(200, null)).toBeNull();
  });
});
