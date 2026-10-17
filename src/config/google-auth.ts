import { isApiMode } from "@/config/api-mode";

/**
 * Client ID web de Google Cloud para "Continuar con Google" (`NEXT_PUBLIC_GOOGLE_CLIENT_ID`). Es
 * publico (Google lo muestra en su propio boton), pero no va en el codigo. Devuelve "" en modo mock o
 * si no esta configurado: el login muestra entonces el aviso "no disponible", igual que antes.
 */
export function getGoogleClientId(): string {
  if (!isApiMode()) return "";
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";
}
