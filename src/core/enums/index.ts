export enum TenantStatus {
  active = "active",
  inactive = "inactive",
  archived = "archived",
}
export enum BranchStatus {
  active = "active",
  inactive = "inactive",
  archived = "archived",
}
export enum RoleStatus {
  active = "active",
  inactive = "inactive",
  archived = "archived",
}
export enum BranchType {
  main = "main",
  store = "store",
  warehouse = "warehouse",
}
export enum UserType {
  customer = "customer",
  employee = "employee",
}
export enum UserStatus {
  active = "active",
  inactive = "inactive",
  blocked = "blocked",
  archived = "archived",
}
export enum AccountStatus {
  pending_verification = "pending_verification",
  active = "active",
  temporarily_locked = "temporarily_locked",
  password_reset_required = "password_reset_required",
  disabled = "disabled",
  archived = "archived",
}
export enum ProductStatus {
  published = "published",
  archived = "archived",
}
export enum ProductType {
  physical = "physical",
  service = "service",
  kit = "kit",
}
export enum SalesChannel {
  pos = "pos",
  ecommerce = "ecommerce",
  mobileApp = "mobileApp",
}
export enum CategoryStatus {
  active = "active",
  archived = "archived",
}
export enum UnitStatus {
  active = "active",
  archived = "archived",
}
export enum UnitCategory {
  unit = "unit",
  weight = "weight",
  length = "length",
  volume = "volume",
  other = "other",
}
export enum InventoryMovementType {
  in = "in",
  out = "out",
  adjustment = "adjustment",
  transfer = "transfer",
}
export enum InventoryReservationStatus {
  active = "active",
  consumed = "consumed",
  released = "released",
}
export enum InventoryAdjustmentType {
  manualIncrease = "manualIncrease",
  manualDecrease = "manualDecrease",
  waste = "waste",
  countCorrection = "countCorrection",
}
export enum InventoryHealthStatus {
  healthy = "healthy",
  low_stock = "low_stock",
  out_of_stock = "out_of_stock",
  overstock = "overstock",
}
export enum InventoryTransferRequestStatus {
  requested = "requested",
  approved = "approved",
  rejected = "rejected",
  inTransit = "inTransit",
  received = "received",
  cancelled = "cancelled",
}
export enum InventoryTransferStatus {
  preparing = "preparing",
  inTransit = "inTransit",
  received = "received",
  cancelled = "cancelled",
}
export enum InventoryTransferReason {
  replenishment = "replenishment",
  demandCoverage = "demandCoverage",
  urgentRequest = "urgentRequest",
  inventoryBalancing = "inventoryBalancing",
  other = "other",
}
export enum LocationStatus {
  active = "active",
  inactive = "inactive",
  archived = "archived",
}
export enum SerialStatus {
  available = "available",
  reserved = "reserved",
  in_transit = "in_transit",
  sold = "sold",
  damaged = "damaged",
  archived = "archived",
}
export enum SupplierStatus {
  active = "active",
  inactive = "inactive",
  archived = "archived",
}
export enum PurchaseOrderStatus {
  draft = "draft",
  pending_approval = "pending_approval",
  approved = "approved",
  sent = "sent",
  partially_received = "partially_received",
  received = "received",
  cancelled = "cancelled",
}
export enum ReceiptStatus {
  pending = "pending",
  in_progress = "in_progress",
  partial = "partial",
  received = "received",
  cancelled = "cancelled",
}
export enum ReceiptLineStatus {
  pending = "pending",
  partial = "partial",
  complete = "complete",
  incident = "incident",
}
export enum CustomerStatus {
  active = "active",
  inactive = "inactive",
  archived = "archived",
}
export enum OrderSource {
  ecommerce = "ecommerce",
  pos = "pos",
  mobileApp = "mobileApp",
}
export enum OrderStatus {
  pending = "pending",
  confirmed = "confirmed",
  preparing = "preparing",
  picking = "picking",
  packing = "packing",
  ready_for_pickup = "ready_for_pickup",
  ready_for_dispatch = "ready_for_dispatch",
  dispatched = "dispatched",
  delivered = "delivered",
  cancelled = "cancelled",
}
export enum PaymentMethod {
  cash = "cash",
  card = "card",
  transfer = "transfer",
  mixed = "mixed",
}
export enum PaymentStatus {
  pending = "pending",
  approved = "approved",
  rejected = "rejected",
  refunded = "refunded",
}
export enum CustomerPaymentMethodStatus {
  active = "active",
  archived = "archived",
}
export enum DeliveryMethod {
  immediate = "immediate",
  store_pickup = "store_pickup",
  home_delivery = "home_delivery",
}
export enum TransportMode {
  none = "none",
  customer = "customer",
  own_fleet = "own_fleet",
  third_party = "third_party",
}
export enum SaleStatus {
  completed = "completed",
  partially_returned = "partially_returned",
  returned = "returned",
  cancelled = "cancelled",
}
export enum CashShiftStatus {
  open = "open",
  closed = "closed",
  closed_with_difference = "closed_with_difference",
}
export enum CashMovementType {
  in = "in",
  out = "out",
}
export enum ReturnStatus {
  requested = "requested",
  approved = "approved",
  rejected = "rejected",
  completed = "completed",
  cancelled = "cancelled",
}
export enum PickingStatus {
  pending = "pending",
  assigned = "assigned",
  in_progress = "in_progress",
  completed = "completed",
  cancelled = "cancelled",
}
export enum PickingItemStatus {
  pending = "pending",
  partial = "partial",
  completed = "completed",
  incident = "incident",
}
export enum PickingPriority {
  low = "low",
  normal = "normal",
  high = "high",
  urgent = "urgent",
}
export enum PickingIncidentType {
  missing = "missing",
  damaged = "damaged",
  invalid_lot_serial = "invalid_lot_serial",
  quantity_difference = "quantity_difference",
  location_empty = "location_empty",
}
export enum PickingIncidentStatus {
  open = "open",
  resolved = "resolved",
}
export enum PackingStatus {
  in_progress = "in_progress",
  finalized = "finalized",
}
export enum PackingOperationType {
  save_preparation = "save_preparation",
  generate_label = "generate_label",
  register_label_print = "register_label_print",
  finalize = "finalize",
}
export enum DispatchStatus {
  pending = "pending",
  ready = "ready",
  dispatched = "dispatched",
  delivered = "delivered",
  cancelled = "cancelled",
}
export enum PromotionStatus {
  scheduled = "scheduled",
  active = "active",
  ended = "ended",
  cancelled = "cancelled",
}
export enum PromotionType {
  percentage = "percentage",
  fixedDiscount = "fixedDiscount",
  fixedPrice = "fixedPrice",
}
export enum NotificationStatus {
  unread = "unread",
  read = "read",
  archived = "archived",
}
export enum NotificationChannel {
  in_app = "in_app",
  email = "email",
}
export enum BusinessPreset {
  hardware_store = "hardware_store",
  pharmacy = "pharmacy",
  grocery = "grocery",
  services = "services",
  custom = "custom",
}
export enum PlanCode {
  basic = "basic",
  enterprise = "enterprise",
}
export enum PlanStatus {
  active = "active",
  archived = "archived",
}
export enum TenantSubscriptionStatus {
  active = "active",
  suspended = "suspended",
  cancelled = "cancelled",
}
/**
 * Catalogo canonico de capabilities SaaS comerciales -- lo que el Tenant CONTRATO, nunca lo que
 * un Employee puede hacer (eso es Role.permissions) ni en que sucursal puede operar (eso es
 * User.allowedBranchIds). Deliberadamente NO incluye auth/roles/permissions/tenant
 * isolation/security/banking config: esas no son capabilities comerciales, son la plataforma
 * base disponible para cualquier Tenant. Multiples sucursales tampoco es una capability -- ver
 * SaasLimitKey.maxBranches.
 */
export enum SaasCapabilityKey {
  inventory = "inventory",
  purchasing = "purchasing",
  receiving = "receiving",
  pos = "pos",
  ecommerce = "ecommerce",
  delivery = "delivery",
  advancedReports = "reports.advanced",
  traceabilityLots = "traceability.lots",
  traceabilityExpiration = "traceability.expiration",
  traceabilitySerials = "traceability.serials",
  catalogKits = "catalog.kits",
}
/**
 * Catalogo canonico de limites numericos por plan. Una key ausente en PlanDefinition.limits
 * significa "sin limite definido para este plan" (nunca "0" ni "ilimitado" implicito por
 * default) -- ver ResolveTenantEntitlementsService. No incluye products/orders/sales/revenue ni
 * maxPosTerminals (no existe dominio persistente PosTerminal todavia) sin un requerimiento real.
 */
export enum SaasLimitKey {
  maxEmployees = "maxEmployees",
  maxBranches = "maxBranches",
}
