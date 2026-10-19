import { z } from "zod";
import type { StorePickupHandoverResult } from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const storePickupHandoverResultSchema = z.object({
  orderId: z.string().refine(isApiUuid, { message: "UUID de backend invalido." }),
  status: z.literal("delivered"),
  deliveredAt: z.iso.datetime({ offset: true }),
  idempotent: z.boolean(),
}).strict() satisfies z.ZodType<StorePickupHandoverResult>;

export function parseStorePickupHandoverResult(value: unknown): StorePickupHandoverResult {
  const parsed = storePickupHandoverResultSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "Respuesta de entrega en tienda invalida:",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  throw new BackendRequestError(
    "El backend devolvio una confirmacion de entrega en tienda invalida.",
    502,
    "INVALID_BACKEND_RESPONSE",
  );
}
