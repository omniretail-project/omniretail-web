import type { ISODateString } from "@/core/types/common.types";

/** Snapshot comercial simulado; no acredita pago ni constituye factura fiscal. */
export interface SubscriptionInvoice {
  id: string;
  tenantId: string;
  cycleStart: ISODateString;
  cycleEnd: ISODateString;
  createdAt: ISODateString;
  addonCodes: string[];
  baseQuetzales: number;
  addonLines: { code: string; name: string; amountQuetzales: number }[];
  totalQuetzales: number;
  status: "simulated";
}
