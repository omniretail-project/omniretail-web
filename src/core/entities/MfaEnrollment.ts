import type { ISODateString } from "@/core/types/common.types";

export type MfaMethod = "totp" | "email";

export interface MfaEnrollment {
  id: string;
  userId: string;
  enabled: boolean;
  method: MfaMethod;
  /**
   * Código de demostración fijado al enrolar (PR13). En fase dummy no hay
   * algoritmo TOTP real ni correo real: en vez de simular criptografía que
   * nadie va a verificar, se genera un código fijo por enrolamiento --
   * mismo criterio de transparencia que ya usa el sistema en
   * registerCustomer/inviteEmployee, donde el token se devuelve
   * directamente porque no hay canal real de entrega. Se usa
   * "demoCodeMock" y no "secretMock" porque no hay nada que derivar en
   * fase dummy -- el código de prueba ES el secreto, mostrado
   * directamente.
   */
  demoCodeMock: string;
  /**
   * Se completa cuando se termina de verificar el código de activación
   * (PR13). Antes de esto, el enrollment existe pero `enabled` sigue en
   * false -- mismo patrón de dos fases que EmailVerification/
   * PasswordResetChallenge (existe el registro, pero todavía no cuenta
   * como completado).
   */
  verifiedAt?: ISODateString;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
