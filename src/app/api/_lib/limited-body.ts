export type LimitedBodyResult =
  | { status: "ok"; body: Uint8Array<ArrayBuffer> | undefined }
  | { status: "too-large" }
  | { status: "read-error" };

// Los archivos admitidos llegan hasta 5 MiB; 1 MiB adicional cubre el envelope multipart y campos.
export const MULTIPART_BODY_MAX_BYTES = 6 * 1024 * 1024;

// El BFF solo recibe JSON estructurado, sin archivos ni base64; 2 MiB cubren holgadamente sus lotes.
export const JSON_BODY_MAX_BYTES = 2 * 1024 * 1024;

function contentLengthExceedsLimit(value: string | null, maxBytes: number): boolean {
  if (!value || !/^\d+$/.test(value)) return false;
  return BigInt(value) > BigInt(maxBytes);
}

async function cancelStream(stream: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!stream) return;
  try {
    await stream.cancel();
  } catch {
    // El error original o el rechazo por tamano manda; cancelar es solo limpieza defensiva.
  }
}

/**
 * Lee un cuerpo con un tope real. Content-Length permite rechazar antes, pero el stream siempre se
 * contabiliza porque el encabezado puede faltar o mentir. El buffer reservado nunca supera el tope.
 */
export async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<LimitedBodyResult> {
  if (contentLengthExceedsLimit(request.headers.get("Content-Length"), maxBytes)) {
    await cancelStream(request.body);
    return { status: "too-large" };
  }

  if (!request.body) return { status: "ok", body: undefined };

  const reader = request.body.getReader();
  const buffer = new Uint8Array(maxBytes);
  let length = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value.byteLength > maxBytes - length) {
        try {
          await reader.cancel();
        } catch {
          // La respuesta 413 no debe convertirse en 500 si el productor falla al cancelarse.
        }
        return { status: "too-large" };
      }

      buffer.set(value, length);
      length += value.byteLength;
    }

    return {
      status: "ok",
      body: length === 0 ? undefined : buffer.subarray(0, length),
    };
  } catch {
    try {
      await reader.cancel();
    } catch {
      // La excepcion de lectura ya determina el resultado controlado.
    }
    return { status: "read-error" };
  } finally {
    reader.releaseLock();
  }
}
