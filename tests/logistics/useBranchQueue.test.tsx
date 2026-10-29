import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBranchQueue } from "@/modules/logistics/hooks/useBranchQueue";
import { deferred } from "./dispatchFixtures";

type Options = Parameters<typeof useBranchQueue<string>>[0];

function setup(overrides: Partial<Options> = {}) {
  const activeBranchIdRef = { current: "branch-a" as string | null };
  const fetchQueue = vi.fn(async (branchId: string) => [`${branchId}-1`]);
  const branchA = { id: "branch-a" };
  const options: Options = {
    branchLoading: false,
    sessionLoading: false,
    currentBranch: branchA,
    hasBranchAccess: true,
    canRead: true,
    sessionError: null,
    activeBranchIdRef,
    fetchQueue,
    fallbackError: "No se pudo cargar la cola.",
    ...overrides,
  };
  const loadings: boolean[] = [];
  const view = renderHook(
    (props: Options) => {
      const queue = useBranchQueue<string>(props);
      loadings.push(queue.loading);
      return queue;
    },
    { initialProps: options },
  );
  return { ...view, options, activeBranchIdRef, fetchQueue, branchA, loadings };
}

const reload = (result: { current: { reload: () => Promise<void> } }) =>
  act(async () => {
    await result.current.reload();
  });

describe("useBranchQueue", () => {
  it("empieza cargando y la primera lectura de una sucursal muestra y limpia la carga", async () => {
    const { result, fetchQueue } = setup();
    expect(result.current).toMatchObject({ queue: [], loading: true, queueError: null });

    await reload(result);

    expect(fetchQueue).toHaveBeenCalledWith("branch-a");
    expect(result.current).toMatchObject({ queue: ["branch-a-1"], loading: false, queueError: null });
  });

  it("las lecturas siguientes son silenciosas: la cola visible se conserva y loading nunca vuelve a true", async () => {
    const { result, fetchQueue, loadings } = setup();
    await reload(result);
    loadings.length = 0;
    const pending = deferred<string[]>();
    fetchQueue.mockReturnValueOnce(pending.promise);

    let refreshing!: Promise<void>;
    act(() => {
      refreshing = result.current.reload();
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.queue).toEqual(["branch-a-1"]);

    await act(async () => {
      pending.resolve(["nuevo"]);
      await refreshing;
    });

    expect(result.current.queue).toEqual(["nuevo"]);
    expect(loadings.every((value) => value === false)).toBe(true);
  });

  it("no consulta mientras la sucursal o la sesion siguen cargando", async () => {
    const { result, fetchQueue, rerender, options } = setup({ branchLoading: true });
    await reload(result);
    expect(fetchQueue).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    rerender({ ...options, branchLoading: false, sessionLoading: true });
    await reload(result);
    expect(fetchQueue).not.toHaveBeenCalled();
  });

  it("sin acceso o sin permiso de lectura vacia la cola, no consulta y termina la carga", async () => {
    const { result, fetchQueue, rerender, options } = setup();
    await reload(result);
    expect(result.current.queue).toHaveLength(1);
    fetchQueue.mockClear();

    rerender({ ...options, canRead: false });
    await reload(result);
    expect(result.current).toMatchObject({ queue: [], loading: false });

    rerender({ ...options, hasBranchAccess: false });
    await reload(result);
    expect(result.current).toMatchObject({ queue: [], loading: false });
    expect(fetchQueue).not.toHaveBeenCalled();
  });

  it("al recuperar el acceso la primera lectura vuelve a mostrar la carga (ya no hay cola mostrada)", async () => {
    const { result, fetchQueue, rerender, options } = setup();
    await reload(result);
    rerender({ ...options, canRead: false });
    await reload(result);
    rerender(options);
    const pending = deferred<string[]>();
    fetchQueue.mockReturnValueOnce(pending.promise);

    let reading!: Promise<void>;
    act(() => {
      reading = result.current.reload();
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      pending.resolve(["otra"]);
      await reading;
    });
    expect(result.current).toMatchObject({ queue: ["otra"], loading: false });
  });

  it("un cambio de sucursal es una lectura inicial: muestra la carga y no mezcla colas", async () => {
    const { result, fetchQueue, rerender, options, activeBranchIdRef } = setup();
    await reload(result);
    const pending = deferred<string[]>();
    fetchQueue.mockReturnValueOnce(pending.promise);
    activeBranchIdRef.current = "branch-b";
    rerender({ ...options, currentBranch: { id: "branch-b" } });

    let reading!: Promise<void>;
    act(() => {
      reading = result.current.reload();
    });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      pending.resolve(["branch-b-1"]);
      await reading;
    });

    expect(fetchQueue).toHaveBeenLastCalledWith("branch-b");
    expect(result.current.queue).toEqual(["branch-b-1"]);
  });

  describe("errores", () => {
    it("un fallo en la primera lectura muestra el mensaje del error y termina la carga", async () => {
      const { result, fetchQueue } = setup();
      fetchQueue.mockRejectedValueOnce(new Error("Servicio no disponible"));

      await reload(result);

      expect(result.current).toMatchObject({ queue: [], loading: false, queueError: "Servicio no disponible" });
    });

    it("un fallo en segundo plano conserva la cola visible y la siguiente lectura valida limpia el error", async () => {
      const { result, fetchQueue } = setup();
      await reload(result);
      fetchQueue.mockRejectedValueOnce(new Error("Red caida"));

      await reload(result);
      expect(result.current).toMatchObject({ queue: ["branch-a-1"], loading: false, queueError: "Red caida" });

      await reload(result);
      expect(result.current).toMatchObject({ queue: ["branch-a-1"], queueError: null });
    });

    it("sin mensaje usa el error de sesion y, si no hay, el mensaje por defecto", async () => {
      const first = setup({ sessionError: "Sesion expirada" });
      first.fetchQueue.mockRejectedValueOnce("sin mensaje");
      await reload(first.result);
      expect(first.result.current.queueError).toBe("Sesion expirada");

      const second = setup();
      second.fetchQueue.mockRejectedValueOnce("sin mensaje");
      await reload(second.result);
      expect(second.result.current.queueError).toBe("No se pudo cargar la cola.");
    });
  });

  describe("respuestas tardias", () => {
    it("una lectura anterior que termina despues de una mas reciente no la sobrescribe", async () => {
      const { result, fetchQueue } = setup();
      const older = deferred<string[]>();
      fetchQueue.mockReturnValueOnce(older.promise).mockResolvedValueOnce(["reciente"]);

      let first!: Promise<void>;
      act(() => {
        first = result.current.reload();
      });
      await reload(result);
      expect(result.current.queue).toEqual(["reciente"]);

      await act(async () => {
        older.resolve(["vieja"]);
        await first;
      });

      expect(result.current.queue).toEqual(["reciente"]);
      expect(result.current.loading).toBe(false);
    });

    it("una respuesta de la sucursal anterior se descarta cuando la activa ya es otra", async () => {
      const { result, fetchQueue, activeBranchIdRef } = setup();
      const late = deferred<string[]>();
      fetchQueue.mockReturnValueOnce(late.promise);

      let reading!: Promise<void>;
      act(() => {
        reading = result.current.reload();
      });
      activeBranchIdRef.current = "branch-b";
      await act(async () => {
        late.resolve(["de-branch-a"]);
        await reading;
      });

      expect(result.current.queue).toEqual([]);
    });
  });

  describe("identidad de reload", () => {
    it("es estable mientras no cambian sus dependencias, y asi no provoca consultas repetidas", () => {
      const { result, rerender, options } = setup();
      const first = result.current.reload;

      rerender({ ...options });
      rerender({ ...options });

      expect(result.current.reload).toBe(first);
    });

    it.each<[string, (options: Options) => Options]>([
      ["el objeto de la sucursal", (options) => ({ ...options, currentBranch: { id: "branch-a" } })],
      ["el permiso de lectura", (options) => ({ ...options, canRead: false })],
      ["el acceso a la sucursal", (options) => ({ ...options, hasBranchAccess: false })],
      ["la carga de la sesion", (options) => ({ ...options, sessionLoading: true })],
      ["el error de sesion", (options) => ({ ...options, sessionError: "otro" })],
      ["la funcion de consulta", (options) => ({ ...options, fetchQueue: vi.fn(async () => []) })],
    ])("cambia cuando cambia %s (el hook que llama vuelve a consultar)", (_label, change) => {
      const { result, rerender, options } = setup();
      const first = result.current.reload;

      rerender(change(options));

      expect(result.current.reload).not.toBe(first);
    });
  });
});
