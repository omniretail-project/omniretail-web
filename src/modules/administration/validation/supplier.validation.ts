import { SupplierStatus } from "@/core/enums";
import type { SupplierInputDto } from "@/modules/administration/application/dto/SupplierDto";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";
import {
  ADMIN_FIELD_LIMITS,
  isValidGuatemalaPhone,
  normalizeGuatemalaPhone,
} from "@/modules/administration/validation/adminFieldConstraints";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUSES = Object.values(SupplierStatus);
const LIMITS = ADMIN_FIELD_LIMITS.supplier;

export function validateSupplierInput(dto: SupplierInputDto) {
  const name = dto.name.trim();
  if (!name) {
    throw new AdministrationServiceError("El nombre del proveedor es obligatorio.");
  }
  if (name.length > LIMITS.name) {
    throw new AdministrationServiceError(
      "El nombre del proveedor no puede exceder 120 caracteres.",
    );
  }
  if (dto.legalName && dto.legalName.trim().length > LIMITS.legalName) {
    throw new AdministrationServiceError("La razón social no puede exceder 160 caracteres.");
  }
  if (dto.taxId && dto.taxId.trim().length > LIMITS.taxId) {
    throw new AdministrationServiceError(
      "La identificación tributaria no puede exceder 10 caracteres.",
    );
  }
  if (dto.address && dto.address.trim().length > LIMITS.address) {
    throw new AdministrationServiceError(
      "La dirección del proveedor no puede exceder 180 caracteres.",
    );
  }
  if (dto.notes && dto.notes.trim().length > LIMITS.notes) {
    throw new AdministrationServiceError(
      "Las notas del proveedor no pueden exceder 500 caracteres.",
    );
  }
  if (!STATUSES.includes(dto.status)) {
    throw new AdministrationServiceError("El estado del proveedor no es válido.");
  }
  const email = dto.email?.trim();
  if (email && (email.length > LIMITS.email || !EMAIL_PATTERN.test(email))) {
    throw new AdministrationServiceError("El correo electrónico no es válido.");
  }
  const phone = dto.phone?.trim();
  if (phone && !isValidGuatemalaPhone(phone)) {
    throw new AdministrationServiceError("El teléfono del proveedor debe tener 8 dígitos.");
  }
}

export function normalizeSupplierInput(dto: SupplierInputDto): SupplierInputDto {
  const optional = (value?: string) => value?.trim() || undefined;

  return {
    name: dto.name.trim(),
    legalName: optional(dto.legalName),
    taxId: optional(dto.taxId),
    email: optional(dto.email)?.toLowerCase(),
    phone: dto.phone?.trim() ? normalizeGuatemalaPhone(dto.phone) : undefined,
    address: optional(dto.address),
    notes: optional(dto.notes),
    status: dto.status,
  };
}
