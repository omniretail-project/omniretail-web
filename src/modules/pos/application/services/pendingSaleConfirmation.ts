import { BackendRequestError } from "@/infrastructure/api/backendClient";
import { SessionJsonStore } from "@/infrastructure/storage/SessionJsonStore";
import type { CheckoutDto } from "@/modules/pos/application/dto/CheckoutDto";
import type { SaleTicketDto } from "@/modules/pos/application/dto/SaleTicketDto";

/**
 * Venta cuya respuesta se perdio (red caida, timeout o 5xx): el backend pudo haberla registrado.
 * La idempotencia del backend depende de `confirmationId` Y del contenido (huella): repetir la misma
 * clave con la misma solicitud devuelve la venta original; con otro contenido responde
 * `IDEMPOTENCY_KEY_REUSED`; con otra clave registraria una segunda venta. Por eso se conserva la
 * solicitud original completa y solo se reenvia esa, sin recalcularla desde el estado de pantalla.
 */
export interface PendingSaleConfirmation {
  version: 1;
  /** `usuario:sucursal:caja` en el que se intento; la venta solo se recupera en ese contexto. */
  contextKey: string;
  confirmationId: string;
  orderIdempotencyKey?: string;
  input: {
    branchId: string;
    cashShiftId: string;
    ticket: SaleTicketDto;
    checkout: CheckoutDto;
  };
  createdAt: string;
  /**
   * Veces que se empezo a enviar. Se guarda ANTES de cada POST: un registro encontrado tras una
   * recarga o un cierre inesperado nunca se puede dar por no enviado.
   */
  attempts: number;
}

const KEY_PREFIX = "omniretail.pos.pending-sale.";

/** Alcance de la recuperacion: usuario, tienda y sucursal. No incluye el turno de caja a proposito. */
export function pendingSaleScopeKey(userId: string, tenantId: string, branchId: string): string {
  return `${userId}:${tenantId}:${branchId}`;
}

/** Respuesta incierta: no se sabe si el backend registro la venta. */
export function isUncertainSaleFailure(error: unknown): boolean {
  if (error instanceof BackendRequestError) {
    return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
  }
  // Un fallo de red del navegador antes de obtener respuesta.
  return error instanceof TypeError;
}

/** El backend respondio con un rechazo definitivo (4xx): esa solicitud no dejo una venta nueva. */
export function isDefinitiveSaleRejection(error: unknown): boolean {
  return error instanceof BackendRequestError && !isUncertainSaleFailure(error);
}

/**
 * Solo el PRIMER envio puede descartarse por un rechazo del servidor: ahi la ausencia de venta esta
 * demostrada. En un reintento, un 401/403/404/409... se decide antes de buscar el `confirmationId`
 * (autorizacion, capacidad, sucursal y turno), asi que no prueba que el envio anterior no se
 * registrara: se conserva para verificarlo o descartarlo a mano.
 */
export function canDiscardAfterRejection(error: unknown, attempts: number): boolean {
  return attempts <= 1 && isDefinitiveSaleRejection(error);
}

export class PendingSaleConfirmationStore {
  constructor(private readonly store = new SessionJsonStore()) {}

  load(contextKey: string): PendingSaleConfirmation | null {
    const value = this.store.get<PendingSaleConfirmation>(KEY_PREFIX + contextKey);
    if (value?.version !== 1 || value.contextKey !== contextKey || !value.confirmationId) return null;
    // Un registro sin contador es de una version anterior: ya se habia enviado al menos una vez.
    return { ...value, attempts: Math.max(1, Number(value.attempts) || 1) };
  }

  /** `false` si el navegador no pudo guardarlo: entonces NO se debe enviar la venta. */
  save(pending: PendingSaleConfirmation): boolean {
    return this.store.set(KEY_PREFIX + pending.contextKey, pending);
  }

  clear(contextKey: string): void {
    this.store.remove(KEY_PREFIX + contextKey);
  }
}
