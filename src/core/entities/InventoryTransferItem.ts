export interface InventoryTransferItem {
  id: string;
  transferId: string;
  productId: string;
  sourceRequestId?: string;
  requestedQuantity: number;
  dispatchedQuantity: number;
  receivedQuantity: number;
}
