import type {
  InformationRequestFieldErrors,
  InformationRequestPayload,
  SubmitInformationRequestResult,
} from "@/modules/information-request/application/dto/InformationRequestDto";
import {
  informationRequestSchema,
  toFieldErrors,
} from "@/modules/information-request/validation/informationRequest.schema";

export const INFORMATION_REQUEST_ENDPOINT = "/api/public/contact-requests";
export const INFORMATION_REQUEST_TIMEOUT_MS = 15_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UNCERTAIN_MESSAGE =
  "No pudimos confirmar si recibimos tu solicitud. Puedes volver a intentarlo: usaremos la misma referencia para evitar duplicados.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readFieldErrors(body: unknown): InformationRequestFieldErrors {
  if (!isRecord(body) || !isRecord(body.fields)) return {};
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(body.fields)) {
    if (typeof value === "string") fields[key] = value;
  }
  return fields;
}

function readRetryAfter(response: Response): number | undefined {
  const raw = response.headers.get("Retry-After");
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

/**
 * Envia la solicitud al Route Handler de mismo origen. Nunca informa exito sin un 202 con
 * `requestId` valido. Una respuesta de aceptacion mal formada, un fallo de red o un timeout son
 * "inciertos": el backend pudo haber registrado la solicitud. El mismo `idempotencyKey` debe
 * reutilizarse en cada reintento de la misma peticion.
 */
export class SubmitInformationRequestService {
  constructor(
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly timeoutMs: number = INFORMATION_REQUEST_TIMEOUT_MS,
  ) {}

  async execute(
    payload: InformationRequestPayload,
    idempotencyKey: string,
  ): Promise<SubmitInformationRequestResult> {
    const validation = informationRequestSchema.safeParse(payload);
    if (!validation.success) {
      return {
        status: "invalid",
        fields: toFieldErrors(validation.error),
        message: "Revisa los datos marcados e inténtalo nuevamente.",
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(INFORMATION_REQUEST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(validation.data),
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      return { status: "uncertain", message: UNCERTAIN_MESSAGE };
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 202) {
      const body = await readJson(response);
      if (
        isRecord(body) &&
        typeof body.requestId === "string" &&
        UUID_PATTERN.test(body.requestId) &&
        body.status === "RECEIVED"
      ) {
        return { status: "received", requestId: body.requestId };
      }
      return { status: "uncertain", message: UNCERTAIN_MESSAGE };
    }

    if (response.status === 400) {
      const fields = readFieldErrors(await readJson(response));
      return {
        status: "invalid",
        fields,
        message: "Revisa los datos marcados e inténtalo nuevamente.",
      };
    }
    if (response.status === 403) {
      return {
        status: "failed",
        kind: "forbidden",
        message: "No pudimos validar el origen de la solicitud. Recarga la página e inténtalo de nuevo.",
      };
    }
    if (response.status === 404) {
      return {
        status: "failed",
        kind: "disabled",
        message:
          "El formulario no está disponible por el momento. Tu solicitud no fue enviada; inténtalo más tarde.",
      };
    }
    if (response.status === 411 || response.status === 413) {
      return {
        status: "failed",
        kind: "too_large",
        message: "La solicitud no pudo procesarse por su tamaño. Acorta los comentarios e inténtalo de nuevo.",
      };
    }
    if (response.status === 429) {
      return {
        status: "failed",
        kind: "rate_limited",
        message: "Recibimos demasiadas solicitudes. Espera unos minutos antes de volver a intentarlo.",
        retryAfterSeconds: readRetryAfter(response),
      };
    }
    if (response.status === 503) {
      return {
        status: "failed",
        kind: "unavailable",
        message:
          "El servicio no está disponible temporalmente. Tu solicitud no fue confirmada; puedes reintentar en unos minutos.",
      };
    }
    if (response.status >= 500) {
      // 500/502/504: el backend pudo haber registrado la solicitud antes de fallar.
      return { status: "uncertain", message: UNCERTAIN_MESSAGE };
    }
    return {
      status: "failed",
      kind: "rejected",
      message: "No pudimos procesar tu solicitud. Revisa los datos e inténtalo de nuevo.",
    };
  }
}
