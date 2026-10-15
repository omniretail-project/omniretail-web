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

/**
 * Credenciales PUBLICAS por diseno de las cuentas semilla mock. Solo existen en el seed que corre
 * en el navegador del prospecto (nunca en el backend real), viajan en el bundle y se muestran como
 * botones de acceso rapido. Fuente unica: el seed (`demoSeed.ts`) las consume desde aqui.
 * Regla operativa: nunca crear usuarios `@marjym.demo` en el backend real.
 */
export const DEMO_ACCOUNT_PASSWORDS = {
  admin: "AdminDemo123", // NOSONAR typescript:S2068 credencial publica de la demo mock (ver arriba)
  cashier: "CajeroDemo123", // NOSONAR typescript:S2068 credencial publica de la demo mock (ver arriba)
  warehouse: "BodegaDemo123", // NOSONAR typescript:S2068 credencial publica de la demo mock (ver arriba)
} as const;

/** Cuentas semilla de la demo que se ofrecen como acceso rapido en el login. */
export const DEMO_QUICK_LOGINS: readonly DemoQuickLogin[] = [
  { label: "Administrador", email: "admin@marjym.demo", password: DEMO_ACCOUNT_PASSWORDS.admin },
  { label: "Cajero", email: "cajero@marjym.demo", password: DEMO_ACCOUNT_PASSWORDS.cashier },
  { label: "Bodega", email: "bodega@marjym.demo", password: DEMO_ACCOUNT_PASSWORDS.warehouse },
];

/** Quita espacios y barras finales. Sin regex: `/\/+$/` tiene backtracking super-lineal (S8786). */
function normalizeUrl(value: string | undefined): string {
  let url = (value ?? "").trim();
  while (url.endsWith("/")) url = url.slice(0, -1);
  return url;
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
