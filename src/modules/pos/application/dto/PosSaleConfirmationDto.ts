import type { InventoryMovement, Order, PickingOrder } from "@/core/entities";
import type { CurrencyCode } from "@/core/types/common.types";

export interface PosSaleConfirmationDto {
  sale: {
    id: string;
    number: string;
    total: number;
    sourceOrderId?: string;
  };
  payments: Array<{ currency: CurrencyCode }>;
  inventoryMovements: Array<Pick<InventoryMovement, "id"> & Partial<InventoryMovement>>;
  order?: Order;
  pickingOrder?: PickingOrder;
  idempotent: boolean;
}
