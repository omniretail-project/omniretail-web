import { z } from "zod";
import { RECEIPT_INCIDENT_TYPES } from "@/core/entities";
import { RECEIPT_INCIDENT_NOTES_MAX_LENGTH } from "@/core/repositories";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";

const apiUuidSchema = z.string().refine(isApiUuid, {
  message: "UUID de backend invalido.",
});
const instantSchema = z.string().datetime({ offset: true });
const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
// Las cantidades ausentes/null son errores de contrato, no ceros implicitos.
const finiteNumberSchema = z.number().finite();

const trackingDetailSchema = z.object({
  baseQuantity: finiteNumberSchema.positive(),
  lotNumber: z.string().nullable(),
  expirationDate: localDateSchema.nullable(),
  serialNumbers: z.array(z.string()),
});

const goodsReceiptItemSchema = z.object({
  id: apiUuidSchema,
  purchaseOrderItemId: apiUuidSchema,
  productId: apiUuidSchema,
  // GoodsReceiptService puede producir null si falta el snapshot historico relacionado.
  productNameSnapshot: z.string().nullable(),
  productSkuSnapshot: z.string().nullable(),
  receivedQuantity: finiteNumberSchema.positive(),
  unitId: apiUuidSchema,
  unitSymbolSnapshot: z.string(),
  purchaseToBaseFactor: finiteNumberSchema.positive(),
  baseQuantity: finiteNumberSchema.positive(),
  locationId: apiUuidSchema.nullable(),
  unitCost: finiteNumberSchema.nonnegative(),
  trackingDetails: z.array(trackingDetailSchema),
});

const goodsReceiptSchema = z.object({
  id: apiUuidSchema,
  branchId: apiUuidSchema,
  purchaseOrderId: apiUuidSchema,
  // El servicio backend conserva nullability si no logra resolver el contexto de la orden.
  purchaseOrderNumber: z.string().nullable(),
  number: z.string(),
  status: z.enum(["draft", "confirmed"]),
  receivedAt: instantSchema.nullable(),
  notes: z.string().nullable(),
  receivedByUserId: apiUuidSchema.nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
  items: z.array(goodsReceiptItemSchema),
  // Agregados aditivos del backend: evitan sumar items o pedir incidencias solo para contarlas.
  // Opcionales para tolerar un backend que todavia no los envie.
  totalReceivedQuantity: finiteNumberSchema.nonnegative().optional(),
  incidentCount: z.number().int().nonnegative().optional(),
});

const goodsReceiptPageSchema = z.object({
  items: z.array(goodsReceiptSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

const draftItemSchema = z.object({
  purchaseOrderItemId: apiUuidSchema,
  receivedQuantity: z.number().finite().positive(),
  locationId: apiUuidSchema.nullable(),
  trackingDetails: z.array(
    z.object({
      baseQuantity: z.number().finite().positive(),
      lotNumber: z.string().max(100).nullable(),
      expirationDate: localDateSchema.nullable(),
      serialNumbers: z.array(z.string().trim().min(1).max(100)),
    }),
  ),
});

const createGoodsReceiptRequestSchema = z.object({
  purchaseOrderId: apiUuidSchema,
  notes: z.string().max(1000).nullable(),
  items: z.array(draftItemSchema).min(1),
});

const updateGoodsReceiptRequestSchema = z.object({
  notes: z.string().max(1000).nullable(),
  items: z.array(draftItemSchema).min(1),
});

const receiptIncidentSchema = z.object({
  id: apiUuidSchema,
  branchId: apiUuidSchema,
  goodsReceiptId: apiUuidSchema,
  goodsReceiptItemId: apiUuidSchema.nullable(),
  incidentType: z.enum(RECEIPT_INCIDENT_TYPES),
  status: z.enum(["open", "resolved"]),
  quantityAffected: finiteNumberSchema.positive().nullable(),
  notes: z.string(),
  createdByUserId: apiUuidSchema,
  resolvedByUserId: apiUuidSchema.nullable(),
  resolvedAt: instantSchema.nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
});

const receiptIncidentPageSchema = z.object({
  items: z.array(receiptIncidentSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

const createReceiptIncidentRequestSchema = z
  .object({
    incidentType: z.enum(RECEIPT_INCIDENT_TYPES),
    goodsReceiptItemId: apiUuidSchema.nullable(),
    quantityAffected: z.number().finite().positive().nullable(),
    notes: z.string().trim().min(1).max(RECEIPT_INCIDENT_NOTES_MAX_LENGTH),
  })
  .superRefine((value, context) => {
    if ((value.goodsReceiptItemId === null) !== (value.quantityAffected === null)) {
      context.addIssue({
        code: "custom",
        message: "La línea y la cantidad afectada deben enviarse juntas.",
      });
    }
  });

const serialValidationResponseSchema = z.object({
  duplicates: z.array(z.string()),
  repeatedInRequest: z.array(z.string()),
});

const resolveWithReplacementRequestSchema = z.object({
  replacementQuantity: z.number().finite().positive(),
  trackingDetails: z.array(draftItemSchema.shape.trackingDetails.element).optional(),
});

export function parseApiSerialValidation(value: unknown) {
  const parsed = serialValidationResponseSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("validación de seriales");
  return parsed.data;
}

export function parseResolveWithReplacementRequest(value: unknown) {
  const parsed = resolveWithReplacementRequestSchema.safeParse(value);
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

export type ApiGoodsReceipt = z.infer<typeof goodsReceiptSchema>;
export type ApiGoodsReceiptCreateRequest = z.infer<typeof createGoodsReceiptRequestSchema>;
export type ApiGoodsReceiptUpdateRequest = z.infer<typeof updateGoodsReceiptRequestSchema>;
export type ApiReceiptIncident = z.infer<typeof receiptIncidentSchema>;
export type ApiReceiptIncidentCreateRequest = z.infer<typeof createReceiptIncidentRequestSchema>;

export function parseApiGoodsReceipt(value: unknown): ApiGoodsReceipt {
  const parsed = goodsReceiptSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("recepcion de compra");
  return parsed.data;
}

export function parseApiGoodsReceiptPage(value: unknown) {
  const parsed = goodsReceiptPageSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("pagina de recepciones de compra");
  return parsed.data;
}

export function parseGoodsReceiptCreateRequest(value: unknown): ApiGoodsReceiptCreateRequest {
  const parsed = createGoodsReceiptRequestSchema.safeParse(value);
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

export function parseGoodsReceiptUpdateRequest(value: unknown): ApiGoodsReceiptUpdateRequest {
  const parsed = updateGoodsReceiptRequestSchema.safeParse(value);
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

export function parseApiReceiptIncident(value: unknown): ApiReceiptIncident {
  const parsed = receiptIncidentSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("incidencia de recepción");
  return parsed.data;
}

export function parseApiReceiptIncidentPage(value: unknown) {
  const parsed = receiptIncidentPageSchema.safeParse(value);
  if (!parsed.success) throw invalidResponse("página de incidencias de recepción");
  return parsed.data;
}

export function parseReceiptIncidentCreateRequest(value: unknown): ApiReceiptIncidentCreateRequest {
  const parsed = createReceiptIncidentRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new BackendRequestError(
      "Los datos de la incidencia no son válidos.",
      400,
      "INVALID_REQUEST",
    );
  }
  return parsed.data;
}

function invalidResponse(resource: string) {
  return new BackendRequestError(
    `El backend devolvio una ${resource} invalida.`,
    502,
    "INVALID_BACKEND_RESPONSE",
  );
}

function invalidRequest() {
  return new BackendRequestError(
    "Los datos del borrador de recepcion no son validos.",
    400,
    "INVALID_REQUEST",
  );
}
