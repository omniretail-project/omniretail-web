import type { Supplier } from "@/core/entities";
import type { SupplierDto } from "@/modules/administration/application/dto/SupplierDto";

/** Maps the persisted supplier, including its derived lead-time projection for read consumers. */
export function toSupplierDto(supplier: Supplier): SupplierDto {
  return {
    id: supplier.id,
    name: supplier.name,
    legalName: supplier.legalName,
    taxId: supplier.taxId,
    email: supplier.email,
    phone: supplier.phone,
    address: supplier.address,
    notes: supplier.notes,
    leadTimeDays: supplier.leadTimeDays,
    status: supplier.status,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}
