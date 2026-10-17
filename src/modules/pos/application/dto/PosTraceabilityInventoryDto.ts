import type { StorageLocationType } from "@/core/entities/StorageLocation";

export interface PosTraceabilityLocationDto {
  id: string;
  code: string;
  name: string;
  type: StorageLocationType;
}

export interface PosTraceabilityLotDto {
  lotId: string;
  lotNumber: string;
  expirationDate: string | null;
  locationId: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
}

export interface PosTraceabilitySerialDto {
  serialId: string;
  serialNumber: string;
  locationId: string;
  lotId: string | null;
}

/**
 * Agrupacion fisica preparada para el selector POS. Las cantidades solo existen cuando el
 * backend entrego un balance de lote; para series sin lote se expone el conteo disponible.
 */
export interface PosTraceabilityCombinationDto {
  location: PosTraceabilityLocationDto;
  lot: {
    lotId: string;
    lotNumber: string;
    expirationDate: string | null;
  } | null;
  quantity: number | null;
  reservedQuantity: number | null;
  availableQuantity: number | null;
  serials: PosTraceabilitySerialDto[];
  availableSerialCount: number;
}

export interface PosTraceabilityInventoryDto {
  branchId: string;
  productId: string;
  locations: PosTraceabilityLocationDto[];
  lots: PosTraceabilityLotDto[];
  serials: PosTraceabilitySerialDto[];
  combinations: PosTraceabilityCombinationDto[];
}

export interface PosTraceabilityInventoryQueryDto {
  branchId: string;
  productId: string;
  locationId?: string;
  lotId?: string;
}
