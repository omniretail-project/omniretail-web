import type { ISODateString } from "@/core/types/common.types";

export const RECEIPT_INCIDENT_TYPES = [
  "missing",
  "damaged",
  "wrong_item",
  "expired",
  "other",
] as const;

export type ReceiptIncidentTypeCode = (typeof RECEIPT_INCIDENT_TYPES)[number];
export type ReceiptIncidentApiStatus = "open" | "resolved";

export function isReceiptIncidentTypeCode(value: string): value is ReceiptIncidentTypeCode {
  return RECEIPT_INCIDENT_TYPES.some((incidentType) => incidentType === value);
}

export interface ReceiptIncidentEvidence {
  id: string;
  name: string;
  type: string;
  size: number;
  previewUrl?: string;
}

export interface ReceiptIncident {
  id: string;
  receiptId: string;
  receiptLineId?: string;
  incidentTypeId: string;
  description: string;
  quantityAffected?: number;
  evidence?: ReceiptIncidentEvidence[];
  createdByUserId: string;
  createdAt: ISODateString;
  /** Estado API; ausente en registros legacy de mock, que siguen siendo editables. */
  status?: ReceiptIncidentApiStatus;
  resolvedByUserId?: string;
  resolvedAt?: ISODateString;
  updatedAt?: ISODateString;
}
