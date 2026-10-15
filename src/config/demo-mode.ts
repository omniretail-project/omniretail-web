import { getApiMode } from "@/config/api-mode";

/**
 * Demo publica: el MISMO frontend compilado con `NEXT_PUBLIC_API_MODE=mock` y
 * `NEXT_PUBLIC_PUBLIC_DEMO=true`. Sin la bandera (o en modo api) la app se comporta como siempre.
 * Las variables NEXT_PUBLIC_* se referencian de forma literal para que Next las incruste en el bundle.
 */
export function isPublicDemo(): boolean {
  return process.env.NEXT_PUBLIC_PUBLIC_DEMO === "true" && getApiMode() === "mock";
}

export interface DemoQuickLogin {
  label: string;
  email: string;
  password: string;
}

/** Cuentas semilla de la demo (credenciales publicas por diseno; solo datos de ejemplo). */
export const DEMO_QUICK_LOGINS: readonly DemoQuickLogin[] = [
  { label: "Administrador", email: "admin@marjym.demo", password: "AdminDemo123" },
  { label: "Cajero", email: "cajero@marjym.demo", password: "CajeroDemo123" },
  { label: "Bodega", email: "bodega@marjym.demo", password: "BodegaDemo123" },
];

function normalizeUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

/** URL absoluta de la landing real (sin barra final). Vacia si no esta configurada. */
export function getMarketingSiteUrl(): string {
  return normalizeUrl(process.env.NEXT_PUBLIC_MARKETING_URL);
}

/** URL absoluta de la instancia demo (sin barra final). Vacia si no esta configurada. */
export function getPublicDemoUrl(): string {
  return normalizeUrl(process.env.NEXT_PUBLIC_DEMO_URL);
}

/** URL de contacto comercial (sin barra final). Vacia si no esta configurada. */
export function getSalesContactUrl(): string {
  return normalizeUrl(process.env.NEXT_PUBLIC_SALES_CONTACT_URL);
}

/** Destino de "Contratar MARJYM" dentro de la demo: la landing real. */
export function getDemoContractUrl(): string {
  const marketingUrl = getMarketingSiteUrl();
  return marketingUrl ? `${marketingUrl}/contratar` : "";
}
