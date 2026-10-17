export interface ProductTrackingConfig {
  stock: boolean;
  lot: boolean;
  expiration: boolean;
  serial: boolean;
}

export const noProductTracking = (): ProductTrackingConfig => ({
  stock: false,
  lot: false,
  expiration: false,
  serial: false,
});

export const isTrackedProduct = (tracking: ProductTrackingConfig) =>
  tracking.stock || tracking.lot || tracking.expiration || tracking.serial;
