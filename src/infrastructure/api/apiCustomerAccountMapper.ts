import type { Address, Customer } from "@/core/entities";
import type { CustomerStatus } from "@/core/enums";
import type { CreateAddressInput } from "@/core/repositories/AddressRepository";
import { BackendRequestError } from "@/infrastructure/api/backendClient";

/** CustomerProfileResponse del backend (`/me/profile`), con la forma de Customer.ts. */
export interface ApiCustomerProfile {
  id: string;
  tenantId: string;
  userId: string | null;
  code: string;
  name: string;
  email: string;
  phone: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/** AddressResponse del backend (`/me/addresses`), con la forma de Address.ts. */
export interface ApiAddress {
  id: string;
  tenantId: string;
  customerId: string;
  label: string;
  recipientName: string;
  line1: string;
  line2: string | null;
  city: string;
  stateOrDepartment: string | null;
  postalCode: string | null;
  country: string;
  references: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * AddressRequest del backend (crear y editar). `tenantId`, `customerId` e `isDefault` nunca se
 * envian: salen del JWT o los decide el servidor, y cualquier campo extra se rechaza con 400.
 */
export interface ApiAddressRequest {
  label: string;
  recipientName: string;
  line1: string;
  line2?: string;
  city: string;
  stateOrDepartment?: string;
  postalCode?: string;
  country: string;
  references?: string;
}

type AddressFields = Omit<CreateAddressInput, "tenantId" | "customerId">;

export function toCustomer(profile: ApiCustomerProfile): Customer {
  return {
    id: profile.id,
    tenantId: profile.tenantId,
    userId: profile.userId ?? undefined,
    code: profile.code,
    name: profile.name,
    email: profile.email,
    phone: profile.phone ?? undefined,
    status: profile.status as CustomerStatus,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function toAddress(address: ApiAddress): Address {
  return {
    id: address.id,
    tenantId: address.tenantId,
    customerId: address.customerId,
    label: address.label,
    recipientName: address.recipientName,
    line1: address.line1,
    line2: address.line2 ?? undefined,
    city: address.city,
    stateOrDepartment: address.stateOrDepartment ?? undefined,
    postalCode: address.postalCode ?? undefined,
    country: address.country,
    references: address.references ?? undefined,
    isDefault: address.isDefault,
    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
  };
}

/** Allowlist explicita: aunque el input traiga mas campos en runtime, solo estos viajan. */
export function toAddressRequest(fields: AddressFields): ApiAddressRequest {
  return {
    label: fields.label,
    recipientName: fields.recipientName,
    line1: fields.line1,
    line2: fields.line2,
    city: fields.city,
    stateOrDepartment: fields.stateOrDepartment,
    postalCode: fields.postalCode,
    country: fields.country,
    references: fields.references,
  };
}

/**
 * Un 400 VALIDATION_ERROR trae el mensaje util en `fields` (p. ej. el municipio no pertenece al
 * departamento); la UI muestra `message`, asi que se usa el del primer campo. El resto de errores
 * se devuelve tal cual.
 */
export function withFieldMessage(error: unknown): unknown {
  if (!(error instanceof BackendRequestError) || error.status !== 400 || !error.fields) return error;
  const fieldMessage = Object.values(error.fields).find((value) => typeof value === "string" && value);
  return fieldMessage
    ? new BackendRequestError(fieldMessage, error.status, error.code, error.fields)
    : error;
}
