import type { CatalogImageAsset } from "@/core/entities";
import type { ImageUploadDraft } from "@/shared/application/dto/ImageUploadDraft";

export const IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_UPLOAD_MAX_SIDE = 1600;
const MAX_DECODED_SIDE = 12_000;
const MAX_DECODED_PIXELS = 80_000_000;
const ALLOWED_MIME_TYPES = new Set<CatalogImageAsset["mimeType"]>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface ImageUploadCodec {
  decodeAndResize(
    blob: Blob,
    options: { maxSide: number; preservePng: boolean },
  ): Promise<{ blob: Blob; width: number; height: number }>;
}

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];

function hasSignature(bytes: Uint8Array, signature: number[], offset = 0) {
  return (
    bytes.length >= offset + signature.length &&
    signature.every((value, index) => bytes[offset + index] === value)
  );
}

/**
 * Tipo REAL de la imagen segun sus primeros bytes (el backend hace la misma comprobacion).
 * File.type sale de la extension y puede mentir; nunca se usa para decidir el formato.
 */
export async function detectImageMimeType(
  blob: Blob,
): Promise<CatalogImageAsset["mimeType"] | null> {
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (hasSignature(bytes, JPEG_SIGNATURE)) return "image/jpeg";
  if (hasSignature(bytes, PNG_SIGNATURE)) return "image/png";
  if (hasSignature(bytes, RIFF_SIGNATURE) && hasSignature(bytes, WEBP_SIGNATURE, 8)) {
    return "image/webp";
  }
  return null;
}

export async function processImageUpload(
  original: Blob,
  codec: ImageUploadCodec = browserImageUploadCodec,
): Promise<ImageUploadDraft> {
  if (original.size <= 0 || original.size > IMAGE_UPLOAD_MAX_BYTES) {
    throw new Error("La imagen debe pesar como maximo 5 MB.");
  }
  const detectedType = await detectImageMimeType(original);
  if (!detectedType) {
    throw new Error("Formato no permitido. Usa JPEG, PNG o WebP.");
  }
  // Si el tipo declarado no coincide con los bytes, se normaliza al tipo real (no se rechaza).
  const input =
    original.type === detectedType ? original : new Blob([original], { type: detectedType });

  let processed: Awaited<ReturnType<ImageUploadCodec["decodeAndResize"]>>;
  try {
    processed = await codec.decodeAndResize(input, {
      maxSide: IMAGE_UPLOAD_MAX_SIDE,
      preservePng: input.type === "image/png",
    });
  } catch {
    throw new Error("El archivo no contiene una imagen decodificable.");
  }
  if (
    !Number.isSafeInteger(processed.width) ||
    !Number.isSafeInteger(processed.height) ||
    processed.width <= 0 ||
    processed.height <= 0 ||
    processed.width > MAX_DECODED_SIDE ||
    processed.height > MAX_DECODED_SIDE ||
    processed.width * processed.height > MAX_DECODED_PIXELS
  ) {
    throw new Error("Las dimensiones de la imagen no son validas.");
  }
  if (!ALLOWED_MIME_TYPES.has(processed.blob.type as CatalogImageAsset["mimeType"])) {
    throw new Error("El procesamiento produjo un formato no permitido.");
  }

  return {
    blob: processed.blob,
    mimeType: processed.blob.type as CatalogImageAsset["mimeType"],
    byteSize: processed.blob.size,
    width: processed.width,
    height: processed.height,
  };
}

const browserImageUploadCodec: ImageUploadCodec = {
  async decodeAndResize(blob, { maxSide, preservePng }) {
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
      throw new Error("No existe un decoder de imagen disponible.");
    }
    const bitmap = await createImageBitmap(blob);
    try {
      if (
        bitmap.width <= 0 ||
        bitmap.height <= 0 ||
        bitmap.width > MAX_DECODED_SIDE ||
        bitmap.height > MAX_DECODED_SIDE ||
        bitmap.width * bitmap.height > MAX_DECODED_PIXELS
      ) {
        throw new Error("Las dimensiones originales no son validas.");
      }
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      if (scale === 1) return { blob, width: bitmap.width, height: bitmap.height };
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No se pudo procesar la imagen.");
      context.drawImage(bitmap, 0, 0, width, height);
      const outputType = preservePng ? "image/png" : "image/webp";
      const output = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, outputType, preservePng ? undefined : 0.86),
      );
      if (!output) throw new Error("No se pudo codificar la imagen.");
      return { blob: output, width, height };
    } finally {
      bitmap.close();
    }
  },
};
