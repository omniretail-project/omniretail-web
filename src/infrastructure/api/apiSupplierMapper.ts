import type { Supplier } from "@/core/entities";
import { SupplierStatus } from "@/core/enums";
import type {
  OperationalSupplierIncident,
  OperationalSupplierProduct,
  OperationalSupplier,
  OperationalSupplierDetail,
  OperationalSupplierSummary,
} from "@/core/repositories";
import type { PaginatedResult } from "@/core/types";
import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { isApiUuid } from "@/infrastructure/api/uuid";
import { z } from "zod";

/** SupplierResponse del backend (`/administration/suppliers`). */
export interface ApiSupplier {
  id: string;
  tenantId: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  leadTimeDays: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * CreateSupplierRequest / UpdateSupplierRequest: la tienda sale del JWT, nunca del body, y
 * `leadTimeDays` es un rollup de solo lectura que calcula el backend.
 */
export interface ApiSupplierRequest {
  name: string;
  legalName?: string;
  taxId?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  status: SupplierStatus;
}

const operationalSupplierSchema = z.object({
  id: z.string().refine(isApiUuid, { message: "UUID de proveedor invalido." }),
  name: z.string().min(1),
  leadTimeDays: z.number().int().nonnegative().nullable(),
  status: z.literal(SupplierStatus.active),
});

const operationalSupplierListSchema = z.array(operationalSupplierSchema);

type SupplierInput = Omit<Supplier, "id" | "tenantId" | "createdAt" | "updatedAt" | "leadTimeDays">;

export function toSupplier(supplier: ApiSupplier): Supplier {
  return {
    id: supplier.id,
    tenantId: supplier.tenantId,
    name: supplier.name,
    legalName: supplier.legalName ?? undefined,
    taxId: supplier.taxId ?? undefined,
    email: supplier.email ?? undefined,
    phone: supplier.phone ?? undefined,
    address: supplier.address ?? undefined,
    notes: supplier.notes ?? undefined,
    leadTimeDays: supplier.leadTimeDays ?? undefined,
    status: supplier.status as SupplierStatus,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}

/** El PUT del backend reemplaza los campos opcionales, por eso se envia siempre el proveedor completo. */
export function toSupplierRequest(input: SupplierInput): ApiSupplierRequest {
  return {
    name: input.name,
    legalName: input.legalName,
    taxId: input.taxId,
    email: input.email,
    phone: input.phone,
    address: input.address,
    notes: input.notes,
    status: input.status,
  };
}

export function parseOperationalSuppliers(value: unknown): OperationalSupplier[] {
  const parsed = operationalSupplierListSchema.safeParse(value);
  if (!parsed.success) {
    throw new BackendRequestError(
      "El backend devolvio proveedores operacionales invalidos.",
      502,
      "INVALID_BACKEND_RESPONSE",
    );
  }
  return parsed.data.map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
    leadTimeDays: supplier.leadTimeDays ?? undefined,
    status: supplier.status,
  }));
}

const nullableText = z.string().nullable().optional();
const supplierStatusSchema = z.nativeEnum(SupplierStatus);

const operationalSupplierSummarySchema = z.object({
  id: z.string().refine(isApiUuid, { message: "UUID de proveedor invalido." }),
  name: z.string(),
  legalName: nullableText,
  taxId: nullableText,
  email: nullableText,
  phone: nullableText,
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  status: supplierStatusSchema,
});

const operationalSupplierDetailSchema = operationalSupplierSummarySchema.extend({
  address: nullableText,
  notes: nullableText,
});

const operationalSupplierPageSchema = z.object({
  items: z.array(operationalSupplierSummarySchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  totalItems: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

function toOperationalSummary(
  supplier: z.infer<typeof operationalSupplierSummarySchema>,
): OperationalSupplierSummary {
  return {
    id: supplier.id,
    name: supplier.name,
    ...(supplier.legalName ? { legalName: supplier.legalName } : {}),
    ...(supplier.taxId ? { taxId: supplier.taxId } : {}),
    ...(supplier.email ? { email: supplier.email } : {}),
    ...(supplier.phone ? { phone: supplier.phone } : {}),
    ...(typeof supplier.leadTimeDays === "number" ? { leadTimeDays: supplier.leadTimeDays } : {}),
    status: supplier.status,
  };
}

function invalidSuppliersResponse() {
  return new BackendRequestError(
    "El backend devolvio proveedores operacionales invalidos.",
    502,
    "INVALID_BACKEND_RESPONSE",
  );
}

export function parseOperationalSupplierPage(
  value: unknown,
): PaginatedResult<OperationalSupplierSummary> {
  const parsed = operationalSupplierPageSchema.safeParse(value);
  if (!parsed.success) throw invalidSuppliersResponse();
  return { ...parsed.data, items: parsed.data.items.map(toOperationalSummary) };
}

export function parseOperationalSupplierDetail(value: unknown): OperationalSupplierDetail {
  const parsed = operationalSupplierDetailSchema.safeParse(value);
  if (!parsed.success) throw invalidSuppliersResponse();
  return {
    ...toOperationalSummary(parsed.data),
    ...(parsed.data.address ? { address: parsed.data.address } : {}),
    ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
  };
}

const supplierProductSchema = z.object({
  id: z.string().refine(isApiUuid, { message: "UUID invalido." }),
  productId: z.string().refine(isApiUuid, { message: "UUID invalido." }),
  productName: z.string(),
  productSku: z.string(),
  supplierSku: nullableText,
  purchaseUnitSymbol: z.string(),
  purchaseToBaseFactor: z.coerce.number().finite(),
  lastCost: z.coerce.number().finite(),
  leadTimeDays: z.number().int().nonnegative().nullable().optional(),
  minimumOrderQuantity: z.coerce.number().finite(),
  preferred: z.boolean(),
  active: z.boolean(),
  costTiers: z
    .array(
      z.object({
        minQuantity: z.coerce.number().finite(),
        unitCost: z.coerce.number().finite(),
      }),
    )
    .nullable()
    .optional(),
});

const supplierIncidentSchema = z.object({
  id: z.string().refine(isApiUuid, { message: "UUID invalido." }),
  incidentType: z.string(),
  status: z.enum(["open", "resolved"]),
  quantityAffected: z.coerce.number().finite().nullable().optional(),
  notes: z.string().nullable().optional(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable().optional(),
  goodsReceiptId: z.string(),
  receiptNumber: z.string(),
  purchaseOrderId: z.string(),
  purchaseOrderNumber: z.string(),
  branchId: z.string(),
  productId: z.string().nullable().optional(),
  productName: z.string().nullable().optional(),
});

function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  });
}

export function parseOperationalSupplierProductPage(
  value: unknown,
): PaginatedResult<OperationalSupplierProduct> {
  const parsed = pageSchema(supplierProductSchema).safeParse(value);
  if (!parsed.success) throw invalidSuppliersResponse();
  return {
    ...parsed.data,
    items: parsed.data.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      productSku: item.productSku,
      ...(item.supplierSku ? { supplierSku: item.supplierSku } : {}),
      purchaseUnitSymbol: item.purchaseUnitSymbol,
      purchaseToBaseFactor: item.purchaseToBaseFactor,
      lastCost: item.lastCost,
      ...(typeof item.leadTimeDays === "number" ? { leadTimeDays: item.leadTimeDays } : {}),
      minimumOrderQuantity: item.minimumOrderQuantity,
      preferred: item.preferred,
      active: item.active,
      costTiers: [...(item.costTiers ?? [])].sort((a, b) => a.minQuantity - b.minQuantity),
    })),
  };
}

export function parseOperationalSupplierIncidentPage(
  value: unknown,
): PaginatedResult<OperationalSupplierIncident> {
  const parsed = pageSchema(supplierIncidentSchema).safeParse(value);
  if (!parsed.success) throw invalidSuppliersResponse();
  return {
    ...parsed.data,
    items: parsed.data.items.map((item) => ({
      id: item.id,
      incidentType: item.incidentType,
      status: item.status,
      ...(typeof item.quantityAffected === "number"
        ? { quantityAffected: item.quantityAffected }
        : {}),
      notes: item.notes ?? "",
      createdAt: item.createdAt,
      ...(item.resolvedAt ? { resolvedAt: item.resolvedAt } : {}),
      goodsReceiptId: item.goodsReceiptId,
      receiptNumber: item.receiptNumber,
      purchaseOrderId: item.purchaseOrderId,
      purchaseOrderNumber: item.purchaseOrderNumber,
      branchId: item.branchId,
      ...(item.productId ? { productId: item.productId } : {}),
      ...(item.productName ? { productName: item.productName } : {}),
    })),
  };
}
