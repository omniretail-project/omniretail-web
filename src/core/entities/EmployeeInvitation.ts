import type { ISODateString } from "@/core/types/common.types";

/**
 * Invitación de activación de cuenta para un empleado que ya existe como
 * User (creado desde /administracion/usuarios, fuera de este módulo).
 * Deliberadamente NO es EmailVerification: nace de una acción
 * administrativa (no de un registro público), activa una cuenta que
 * todavía no existía como AuthAccount usable (no solo "confirma" una ya
 * creada), y tiene su propia política de vigencia (R-A09/4.10: 24h, un
 * solo uso). Mezclarla con EmailVerification acoplaría dos flujos con
 * dueños y ciclos de vida distintos.
 */
export interface EmployeeInvitation {
  id: string;
  userId: string;
  /**
   * Tenant del User al momento de invitar -- capturado aca porque
   * AuthAccount no guarda tenantId (se deriva de User), y User.tenantId
   * puede cambiar despues de emitida la invitacion (reasignacion a otro
   * tenant). Es la referencia autoritativa contra la que
   * activateEmployeeAccount() revalida al momento de activar: si
   * User.tenantId ya no coincide con este valor, la invitacion se
   * considera invalida aunque el token siga vigente.
   */
  tenantId: string;
  token: string;
  createdAt: ISODateString;
  expiresAt: ISODateString;
  acceptedAt?: ISODateString;
}
