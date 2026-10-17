import type { MfaMethod } from "@/core/entities/MfaEnrollment";
import type { ISODateString } from "@/core/types/common.types";

/**
 * Desafío efímero de segundo factor, creado a mitad de login() cuando la
 * contraseña es correcta pero la cuenta tiene MfaEnrollment.enabled=true
 * (R-A16). Análogo a PasswordResetChallenge (mismo patrón de challenge de
 * un solo uso), pero vive solo durante la ventana de login, nunca por
 * link.
 *
 * No guarda su propio código: el código vigente es siempre
 * MfaEnrollment.demoCodeMock (fase dummy, no rotativo) -- guardar una
 * copia acá crearía dos fuentes de verdad que podrían desincronizarse si
 * el enrollment cambia mientras un challenge sigue vivo.
 */
export interface MfaChallenge {
  id: string;
  userId: string;
  method: MfaMethod;
  failedAttempts: number;
  createdAt: ISODateString;
  expiresAt: ISODateString;
  consumedAt?: ISODateString;
  /**
   * Se marca cuando se alcanzan MFA_CHALLENGE_MAX_ATTEMPTS fallos -- el
   * desafío queda inválido aunque no haya expirado ni se haya consumido.
   */
  invalidatedAt?: ISODateString;
  /**
   * Capturados de LoginInput al crear el challenge -- verifyMfaChallenge()
   * solo recibe challengeId + código, nunca el LoginInput original, así
   * que la Session final (creada ahí) necesita esto para respetar lo que
   * el usuario pidió en el formulario de login (duración de sesión,
   * dispositivo).
   */
  rememberMe: boolean;
  deviceLabel?: string;
}
