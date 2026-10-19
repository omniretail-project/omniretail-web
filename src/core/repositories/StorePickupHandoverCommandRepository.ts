export interface StorePickupHandoverCommandScope {
  branchId: string;
}

export interface StorePickupHandoverResult {
  orderId: string;
  status: "delivered";
  deliveredAt: string;
  idempotent: boolean;
}

/** Comando REST de entrega al cliente; tenant y actor provienen de la sesion autenticada. */
export interface StorePickupHandoverCommandRepository {
  confirm(
    scope: StorePickupHandoverCommandScope,
    orderId: string,
  ): Promise<StorePickupHandoverResult>;
}
