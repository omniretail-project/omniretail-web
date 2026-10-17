import type { ISODateString } from "@/core/types/common.types";

export interface PasswordResetChallenge {
  id: string;
  userId: string;
  token: string;
  createdAt: ISODateString;
  expiresAt: ISODateString;
  usedAt?: ISODateString;
  /**
   * Doc 4.10: "una nueva solicitud invalida el enlace anterior". Se marca
   * aquí (campo distinto de usedAt) cuando una solicitud NUEVA de la
   * misma cuenta reemplaza a esta -- nunca se llegó a usar para
   * restablecer nada, solo quedó obsoleta. resetPassword() debe tratar un
   * challenge con supersededAt igual que uno usado: ya no es válido.
   */
  supersededAt?: ISODateString;
  requestIpMock?: string;
}
