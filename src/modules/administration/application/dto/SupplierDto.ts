import type { Supplier } from "@/core/entities";

/** Supplier leadTimeDays is an exposed read-only rollup, never an administration input. */
export type SupplierDto = Omit<Supplier, "tenantId">;

export type SupplierInputDto = Pick<
  Supplier,
  "name" | "legalName" | "taxId" | "email" | "phone" | "address" | "notes" | "status"
>;
