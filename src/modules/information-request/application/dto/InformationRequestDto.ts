/**
 * Contrato de la solicitud comercial (POST /api/v1/public/contact-requests del backend comercial).
 * Los códigos de rubro y módulos coinciden con las listas cerradas del backend comercial.
 */
export const INDUSTRY_OPTIONS = [
  { value: "retail", label: "Comercio minorista" },
  { value: "wholesale", label: "Mayorista o distribución" },
  { value: "hardware", label: "Ferretería" },
  { value: "pharmacy", label: "Farmacia" },
  { value: "grocery", label: "Abarrotería o supermercado" },
  { value: "services", label: "Servicios" },
  { value: "other", label: "Otro" },
] as const;

export const INDUSTRY_CODES = ["retail", "wholesale", "hardware", "pharmacy", "grocery", "services", "other"] as const;

export type IndustryCode = (typeof INDUSTRY_CODES)[number];

export const INTEREST_MODULE_OPTIONS = [
  { value: "inventory", label: "Inventario y catálogo" },
  { value: "purchasing", label: "Compras" },
  { value: "receiving", label: "Recepción de mercadería" },
  { value: "pos", label: "Punto de venta" },
  { value: "ecommerce", label: "Tienda en línea" },
  { value: "delivery", label: "Entregas y despachos" },
  { value: "reports.advanced", label: "Reportes avanzados" },
  { value: "traceability.lots", label: "Trazabilidad por lotes" },
  { value: "traceability.expiration", label: "Control de vencimientos" },
  { value: "traceability.serials", label: "Trazabilidad por series" },
  { value: "catalog.kits", label: "Kits y combinaciones" },
] as const;

export const INTEREST_MODULE_CODES = [
  "inventory",
  "purchasing",
  "receiving",
  "pos",
  "ecommerce",
  "delivery",
  "reports.advanced",
  "traceability.lots",
  "traceability.expiration",
  "traceability.serials",
  "catalog.kits",
] as const;

export type InterestModuleCode = (typeof INTEREST_MODULE_CODES)[number];

/** Version del texto de consentimiento que se muestra; viaja con la solicitud. */
export const CONSENT_VERSION = "2026-10";

export const FULL_NAME_MIN_LENGTH = 2;
export const FULL_NAME_MAX_LENGTH = 100;
export const BUSINESS_NAME_MIN_LENGTH = 2;
export const BUSINESS_NAME_MAX_LENGTH = 120;
export const EMAIL_MAX_LENGTH = 254;
export const PHONE_MIN_LENGTH = 7;
export const PHONE_MAX_LENGTH = 20;
export const MESSAGE_MAX_LENGTH = 1000;

/** Valores del formulario (antes de validar). */
export interface InformationRequestFormValues {
  fullName: string;
  businessName: string;
  email: string;
  phone: string;
  industry: IndustryCode | "";
  modules: InterestModuleCode[];
  message: string;
  consentAccepted: boolean;
  /** Honeypot: un usuario real nunca lo ve ni lo llena. */
  website: string;
  captchaToken: string;
}

export type InformationRequestFieldErrors = Partial<
  Record<keyof InformationRequestFormValues, string>
>;

/** Cuerpo exacto que se envia al backend. */
export interface InformationRequestPayload {
  fullName: string;
  businessName: string;
  email: string;
  phone: string;
  industry: IndustryCode;
  modules: InterestModuleCode[];
  message: string;
  consentAccepted: true;
  consentVersion: string;
  website: string;
  captchaToken: string;
}

export type SubmitFailureKind =
  | "forbidden"
  | "too_large"
  | "rate_limited"
  | "unavailable"
  | "disabled"
  | "rejected";

export type SubmitInformationRequestResult =
  | { status: "received"; requestId: string }
  | { status: "invalid"; fields: InformationRequestFieldErrors; message: string }
  | { status: "failed"; kind: SubmitFailureKind; message: string; retryAfterSeconds?: number }
  /** No se sabe si el backend registro la solicitud (red, timeout o respuesta inesperada). */
  | { status: "uncertain"; message: string };
