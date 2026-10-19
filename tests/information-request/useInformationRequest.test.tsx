import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SubmitInformationRequestResult } from "@/modules/information-request/application/dto/InformationRequestDto";
import type { SubmitInformationRequestService } from "@/modules/information-request/application/services/SubmitInformationRequestService";
import { useInformationRequest } from "@/modules/information-request/hooks/useInformationRequest";

const REQUEST_ID = "7d444840-9dc0-41d3-8a59-6a8a6c0f1e11";
const UNCERTAIN: SubmitInformationRequestResult = { status: "uncertain", message: "incierto" };

function setup(results: SubmitInformationRequestResult[], captchaRequired = false) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  const service = { execute } as unknown as SubmitInformationRequestService;
  const hook = renderHook(() => useInformationRequest({ service, captchaRequired }));
  return { execute, ...hook };
}

function fill(result: ReturnType<typeof setup>["result"], consent = true) {
  act(() => {
    result.current.setField("fullName", "Ana Pérez");
    result.current.setField("businessName", "Ferretería Los Altos");
    result.current.setField("email", "ana@example.com");
    result.current.setField("phone", "+502 1234 5678");
    result.current.setField("industry", "hardware");
    result.current.toggleModule("inventory");
    result.current.setField("consentAccepted", consent);
  });
}

describe("useInformationRequest", () => {
  it("no envia con campos vacios ni sin consentimiento", async () => {
    const { result, execute } = setup([]);
    await act(() => result.current.submit());
    expect(execute).not.toHaveBeenCalled();
    expect(result.current.fieldErrors.fullName).toBeTruthy();
    expect(result.current.fieldErrors.consentAccepted).toBeTruthy();

    fill(result, false);
    await act(() => result.current.submit());
    expect(execute).not.toHaveBeenCalled();
    expect(result.current.fieldErrors.consentAccepted).toBeTruthy();
  });

  it("exige token CAPTCHA solo cuando esta configurado", async () => {
    const { result, execute } = setup([], true);
    fill(result);
    await act(() => result.current.submit());
    expect(execute).not.toHaveBeenCalled();
    expect(result.current.fieldErrors.captchaToken).toBeTruthy();
  });

  it("muestra exito y numero de solicitud solo tras un resultado received", async () => {
    const { result, execute } = setup([{ status: "received", requestId: REQUEST_ID }]);
    fill(result);
    await act(() => result.current.submit());
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("received");
    expect(result.current.requestId).toBe(REQUEST_ID);
  });

  it("evita doble envio mientras hay una peticion en curso", async () => {
    let resolve!: (value: SubmitInformationRequestResult) => void;
    const execute = vi.fn(() => new Promise<SubmitInformationRequestResult>((r) => (resolve = r)));
    const service = { execute } as unknown as SubmitInformationRequestService;
    const { result } = renderHook(() => useInformationRequest({ service }));
    fill(result);

    let first!: Promise<void>;
    act(() => {
      first = result.current.submit();
      void result.current.submit();
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.current.isSubmitting).toBe(true);

    await act(async () => {
      resolve({ status: "received", requestId: REQUEST_ID });
      await first;
    });
    expect(result.current.isSubmitting).toBe(false);
  });

  it("reutiliza la Idempotency-Key en reintentos y la cambia al editar datos", async () => {
    const { result, execute } = setup([UNCERTAIN, UNCERTAIN, UNCERTAIN]);
    fill(result);
    await act(() => result.current.submit());
    expect(result.current.status).toBe("uncertain");
    await act(() => result.current.submit());
    expect(execute.mock.calls[1][1]).toBe(execute.mock.calls[0][1]);

    act(() => result.current.setField("businessName", "Otra Empresa"));
    await act(() => result.current.submit());
    expect(execute.mock.calls[2][1]).not.toBe(execute.mock.calls[0][1]);
  });

  it("un fallo definitivo no muestra exito", async () => {
    const { result } = setup([{ status: "failed", kind: "unavailable", message: "no disponible" }]);
    fill(result);
    await act(() => result.current.submit());
    expect(result.current.status).toBe("failed");
    expect(result.current.requestId).toBeNull();
  });
});
