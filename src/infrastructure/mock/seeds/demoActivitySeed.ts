import {
  CashMovementType,
  CashShiftStatus,
  CustomerStatus,
  DeliveryMethod,
  DispatchStatus,
  InventoryMovementType,
  InventoryReservationStatus,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  PickingItemStatus,
  PickingPriority,
  PickingStatus,
  PurchaseOrderStatus,
  ReceiptLineStatus,
  ReceiptStatus,
  SaleStatus,
  TransportMode,
} from "@/core/enums";
import type {
  Address,
  CashMovement,
  CashShift,
  Customer,
  CustomerSegment,
  Dispatch,
  InventoryBalance,
  InventoryMovement,
  InventoryReservation,
  Order,
  OrderItem,
  Package,
  Payment,
  PickingItem,
  PickingOrder,
  Product,
  ProductInventorySettings,
  PurchaseOrder,
  PurchaseOrderItem,
  Receipt,
  ReceiptIncident,
  ReceiptLine,
  Sale,
  SaleItem,
} from "@/core/entities";
import { resolveQuantityPrice } from "@/core/pricing";
import type { MockDatabase } from "@/infrastructure/mock/database/MockDatabase";

/**
 * Datos de actividad de la demo publica: ventas POS, turnos de caja, movimientos de inventario,
 * pedidos e-commerce, compras y recepciones. Todas las fechas son RELATIVAS a `reference`
 * (el momento en que se construye la base mock), de modo que el dashboard siempre muestra
 * actividad reciente.
 *
 * Invariante central: el stock de cada `InventoryBalance` es EXACTAMENTE
 * `sum(movimientos in) - sum(movimientos out)` de su sucursal+producto. El "inventario inicial"
 * es un movimiento `in` derivado (stock final + salidas - entradas posteriores), no un numero
 * escrito a mano, por lo que el kardex y el stock nunca divergen.
 */

const TENANT_ID = "tenant-demo";
const CENTRO = "branch-centro";
const NORTE = "branch-norte";
const OPENING_DAYS_AGO = 45;
const BANK_ACCOUNT_ID = "bank-001";
/** Hora mas tardia planificada para actividad de hoy (entrega de pedidos 15:00); base del escalado. */
const LATEST_PLANNED_TODAY_MS = 15 * 60 * 60_000;

export type DemoActivity = Pick<
  MockDatabase,
  | "customers"
  | "addresses"
  | "customerSegments"
  | "sales"
  | "saleItems"
  | "payments"
  | "cashShifts"
  | "cashMovements"
  | "inventoryBalances"
  | "productInventorySettings"
  | "inventoryMovements"
  | "inventoryReservations"
  | "orders"
  | "orderItems"
  | "pickingOrders"
  | "pickingItems"
  | "dispatches"
  | "packages"
  | "purchaseOrders"
  | "purchaseOrderItems"
  | "receipts"
  | "receiptLines"
  | "receiptIncidents"
>;

type ItemSpec = readonly [productId: string, quantity: number];
type CustomerKey = "ana" | "carlos" | "lucia" | "constructora" | "roberto";
type PayKind = "cash" | "card" | "transfer" | "mixed";

export interface SaleSpec {
  branch: typeof CENTRO | typeof NORTE;
  d: number;
  hm: string;
  customer?: CustomerKey;
  pay: PayKind;
  invoice?: boolean;
  items: readonly ItemSpec[];
}

export const DEMO_SALE_SPECS: readonly SaleSpec[] = [
  { branch: CENTRO, d: 29, hm: "09:35", pay: "cash", items: [["prod-hammer", 2], ["prod-screws", 10]] },
  { branch: NORTE, d: 28, hm: "10:20", pay: "card", items: [["prod-latex-paint", 1], ["prod-paint-brush", 2], ["prod-paint-roller", 1]] },
  { branch: CENTRO, d: 27, hm: "16:40", customer: "ana", pay: "card", items: [["prod-latex-paint", 2], ["prod-paint-roller", 2], ["prod-paint-brush", 3]] },
  { branch: CENTRO, d: 25, hm: "11:05", customer: "constructora", pay: "transfer", invoice: true, items: [["prod-cement", 10], ["prod-shovel", 1], ["prod-pvc-cement", 1]] },
  { branch: NORTE, d: 24, hm: "15:30", pay: "cash", items: [["prod-padlock", 1], ["prod-silicone", 2]] },
  { branch: CENTRO, d: 22, hm: "09:50", pay: "cash", items: [["prod-wall-plugs", 6], ["prod-self-tapping-screws", 10], ["prod-screwdriver-set", 1]] },
  { branch: CENTRO, d: 21, hm: "13:15", customer: "roberto", pay: "mixed", items: [["prod-multimeter", 1], ["prod-duplex-outlet", 3], ["prod-thhn-wire", 20]] },
  { branch: CENTRO, d: 18, hm: "10:30", pay: "cash", items: [["prod-pvc-pipe", 4], ["prod-pvc-elbow", 8], ["prod-ptfe-tape", 3], ["prod-shutoff-valve", 2]] },
  { branch: CENTRO, d: 16, hm: "14:25", customer: "lucia", pay: "card", invoice: true, items: [["prod-deadbolt", 2], ["prod-bedroom-lock", 1]] },
  { branch: NORTE, d: 15, hm: "12:10", pay: "cash", items: [["prod-hose", 1], ["prod-pruning-shears", 1]] },
  { branch: CENTRO, d: 13, hm: "09:05", pay: "cash", items: [["prod-hammer", 1], ["prod-handsaw", 2]] },
  { branch: CENTRO, d: 12, hm: "16:55", customer: "constructora", pay: "transfer", invoice: true, items: [["prod-cement", 25], ["prod-pvc-pipe", 6], ["prod-pvc-cement", 2]] },
  { branch: NORTE, d: 10, hm: "11:40", customer: "carlos", pay: "cash", items: [["prod-screws", 20], ["prod-self-tapping-screws", 5]] },
  { branch: CENTRO, d: 9, hm: "15:00", pay: "mixed", items: [["prod-latex-paint", 1], ["prod-paint-brush", 2], ["prod-silicone", 2]] },
  { branch: CENTRO, d: 8, hm: "10:10", pay: "card", items: [["prod-tape-measure", 2], ["prod-padlock", 1]] },
  { branch: NORTE, d: 6, hm: "13:45", pay: "cash", items: [["prod-cement", 6], ["prod-shovel", 1]] },
  { branch: CENTRO, d: 5, hm: "09:30", customer: "ana", pay: "cash", items: [["prod-screws", 12], ["prod-wall-plugs", 2]] },
  { branch: CENTRO, d: 4, hm: "17:20", pay: "card", items: [["prod-level", 1], ["prod-handsaw", 1], ["prod-hammer", 1]] },
  { branch: NORTE, d: 3, hm: "10:50", pay: "transfer", items: [["prod-duplex-outlet", 6], ["prod-thhn-wire", 25]] },
  { branch: NORTE, d: 1, hm: "16:15", customer: "roberto", pay: "card", items: [["prod-latex-paint", 1], ["prod-paint-roller", 2]] },
  { branch: CENTRO, d: 1, hm: "11:20", pay: "cash", items: [["prod-paint-brush", 4], ["prod-silicone", 1], ["prod-ptfe-tape", 2]] },
  { branch: CENTRO, d: 0, hm: "10:00", pay: "cash", items: [["prod-hammer", 1], ["prod-screws", 8]] },
  { branch: CENTRO, d: 0, hm: "11:30", customer: "carlos", pay: "card", items: [["prod-multimeter", 1], ["prod-duplex-outlet", 2]] },
  { branch: CENTRO, d: 0, hm: "12:45", pay: "cash", items: [["prod-cement", 4], ["prod-wall-plugs", 1]] },
];

/** Existencias finales de la sucursal Norte (Centro conserva las del catalogo). */
const NORTE_FINAL_STOCK: Readonly<Record<string, number>> = {
  "prod-hammer": 10,
  "prod-handsaw": 6,
  "prod-screwdriver-set": 9,
  "prod-screws": 40,
  "prod-self-tapping-screws": 20,
  "prod-wall-plugs": 4,
  "prod-thhn-wire": 140,
  "prod-duplex-outlet": 24,
  "prod-pvc-pipe": 18,
  "prod-pvc-cement": 8,
  "prod-latex-paint": 9,
  "prod-paint-roller": 8,
  "prod-paint-brush": 14,
  "prod-cement": 25,
  "prod-tape-measure": 10,
  "prod-padlock": 8,
  "prod-silicone": 12,
  "prod-hose": 5,
  "prod-shovel": 6,
  "prod-pruning-shears": 6,
  "prod-drill": 8,
  "prod-angle-grinder": 5,
  "prod-multimeter": 8,
  "prod-light-switch": 14,
  "prod-pvc-elbow": 40,
  "prod-shutoff-valve": 10,
  "prod-level": 6,
  "prod-bedroom-lock": 6,
  "prod-deadbolt": 7,
  "prod-ptfe-tape": 30,
};

interface PurchaseSpec {
  id: string;
  number: string;
  branch: typeof CENTRO | typeof NORTE;
  supplierId: string;
  status: PurchaseOrderStatus;
  createdDaysAgo: number;
  /** Items: [productId, ordered, received]. `received` undefined means no receipt. */
  items: ReadonlyArray<readonly [productId: string, ordered: number, received?: number]>;
  receipt?: { id: string; number: string; daysAgo: number; status: ReceiptStatus };
  incident?: { description: string; productId: string; quantityAffected: number; daysAgo: number };
}

const PURCHASE_SPECS: readonly PurchaseSpec[] = [
  {
    id: "po-demo-002",
    number: "OC-002",
    branch: CENTRO,
    supplierId: "supplier-construction",
    status: PurchaseOrderStatus.received,
    createdDaysAgo: 27,
    items: [["prod-cement", 40, 40], ["prod-pvc-pipe", 30, 30]],
    receipt: { id: "receipt-demo-002", number: "REC-002", daysAgo: 23, status: ReceiptStatus.received },
  },
  {
    id: "po-demo-003",
    number: "OC-003",
    branch: CENTRO,
    supplierId: "supplier-tools",
    status: PurchaseOrderStatus.received,
    createdDaysAgo: 20,
    items: [["prod-hammer", 12, 12], ["prod-handsaw", 8, 8], ["prod-tape-measure", 10, 10]],
    receipt: { id: "receipt-demo-003", number: "REC-003", daysAgo: 16, status: ReceiptStatus.received },
  },
  {
    id: "po-demo-004",
    number: "OC-004",
    branch: NORTE,
    supplierId: "supplier-electric",
    status: PurchaseOrderStatus.received,
    createdDaysAgo: 14,
    items: [["prod-duplex-outlet", 20, 20], ["prod-thhn-wire", 100, 100]],
    receipt: { id: "receipt-demo-004", number: "REC-004", daysAgo: 11, status: ReceiptStatus.received },
  },
  {
    id: "po-demo-005",
    number: "OC-005",
    branch: CENTRO,
    supplierId: "supplier-paint",
    status: PurchaseOrderStatus.partially_received,
    createdDaysAgo: 7,
    items: [["prod-latex-paint", 20, 12], ["prod-paint-roller", 12, 12]],
    receipt: { id: "receipt-demo-005", number: "REC-005", daysAgo: 3, status: ReceiptStatus.partial },
    incident: {
      description: "Llegaron 12 de 20 galones de pintura latex; el proveedor completara el pedido.",
      productId: "prod-latex-paint",
      quantityAffected: 8,
      daysAgo: 3,
    },
  },
  {
    id: "po-demo-006",
    number: "OC-006",
    branch: CENTRO,
    supplierId: "supplier-plumbing",
    status: PurchaseOrderStatus.sent,
    createdDaysAgo: 2,
    items: [["prod-shutoff-valve", 20], ["prod-pvc-elbow", 100]],
  },
  {
    id: "po-demo-007",
    number: "OC-007",
    branch: CENTRO,
    supplierId: "supplier-security",
    status: PurchaseOrderStatus.pending_approval,
    createdDaysAgo: 1,
    items: [["prod-padlock", 12], ["prod-deadbolt", 6]],
  },
];

type OrderPayKind = { method: PaymentMethod; status: PaymentStatus };

interface OrderSpec {
  n: number;
  d: number;
  hm: string;
  customer?: CustomerKey;
  guest?: { name: string; email: string };
  status: OrderStatus;
  delivery: DeliveryMethod.home_delivery | DeliveryMethod.store_pickup;
  items: readonly ItemSpec[];
  payment: OrderPayKind;
  /** Pedido con picking completado. */
  picked?: boolean;
  /** Dias atras en que salio a despacho (solo dispatched/delivered). */
  dispatchedDaysAgo?: number;
  deliveredDaysAgo?: number;
  carrier?: { name: string; tracking: string };
}

const ORDER_SPECS: readonly OrderSpec[] = [
  {
    n: 3, d: 0, hm: "09:20", customer: "carlos", status: OrderStatus.pending,
    delivery: DeliveryMethod.home_delivery,
    items: [["prod-paint-brush", 2], ["prod-latex-paint", 1]],
    payment: { method: PaymentMethod.transfer, status: PaymentStatus.pending },
  },
  {
    n: 4, d: 1, hm: "15:10", customer: "lucia", status: OrderStatus.confirmed,
    delivery: DeliveryMethod.home_delivery,
    items: [["prod-duplex-outlet", 4], ["prod-thhn-wire", 50]],
    payment: { method: PaymentMethod.card, status: PaymentStatus.approved },
  },
  {
    n: 5, d: 2, hm: "11:30", customer: "constructora", status: OrderStatus.packing,
    delivery: DeliveryMethod.home_delivery,
    items: [["prod-cement", 20], ["prod-shovel", 2]],
    payment: { method: PaymentMethod.transfer, status: PaymentStatus.approved },
    picked: true,
  },
  {
    n: 6, d: 3, hm: "14:00", customer: "ana", status: OrderStatus.dispatched,
    delivery: DeliveryMethod.home_delivery,
    items: [["prod-hose", 1], ["prod-pruning-shears", 1]],
    payment: { method: PaymentMethod.card, status: PaymentStatus.approved },
    picked: true,
    dispatchedDaysAgo: 2,
    carrier: { name: "Cargo Expreso", tracking: "CE-48210937" },
  },
  {
    n: 7, d: 7, hm: "10:15", customer: "carlos", status: OrderStatus.delivered,
    delivery: DeliveryMethod.home_delivery,
    items: [["prod-deadbolt", 2], ["prod-bedroom-lock", 1]],
    payment: { method: PaymentMethod.card, status: PaymentStatus.approved },
    picked: true,
    dispatchedDaysAgo: 6,
    deliveredDaysAgo: 6,
  },
  {
    n: 8, d: 13, hm: "09:40", customer: "constructora", status: OrderStatus.delivered,
    delivery: DeliveryMethod.home_delivery,
    items: [["prod-cement", 30], ["prod-pvc-pipe", 10], ["prod-pvc-cement", 2]],
    payment: { method: PaymentMethod.transfer, status: PaymentStatus.approved },
    picked: true,
    dispatchedDaysAgo: 12,
    deliveredDaysAgo: 11,
  },
  {
    n: 9, d: 1, hm: "10:05", customer: "roberto", status: OrderStatus.ready_for_pickup,
    delivery: DeliveryMethod.store_pickup,
    items: [["prod-hammer", 1], ["prod-tape-measure", 1], ["prod-padlock", 2]],
    payment: { method: PaymentMethod.card, status: PaymentStatus.approved },
    picked: true,
  },
  {
    n: 10, d: 9, hm: "17:25", status: OrderStatus.cancelled,
    guest: { name: "Marcos Ixcoy", email: "marcos.ixcoy@example.com" },
    delivery: DeliveryMethod.home_delivery,
    items: [["prod-handsaw", 1]],
    payment: { method: PaymentMethod.card, status: PaymentStatus.rejected },
  },
  {
    n: 11, d: 19, hm: "12:00", customer: "lucia", status: OrderStatus.delivered,
    delivery: DeliveryMethod.home_delivery,
    items: [["prod-level", 1], ["prod-silicone", 4]],
    payment: { method: PaymentMethod.card, status: PaymentStatus.approved },
    picked: true,
    dispatchedDaysAgo: 18,
    deliveredDaysAgo: 18,
  },
];

const CUSTOMER_SPECS: ReadonlyArray<{
  key: CustomerKey;
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  segmentId: string;
  createdDaysAgo: number;
  address: { line1: string; city: string };
}> = [
  { key: "carlos", id: "customer-carlos", code: "CLI-002", name: "Carlos Méndez", email: "carlos.mendez@example.com", phone: "5555-0202", segmentId: "segment-retail", createdDaysAgo: 40, address: { line1: "6a avenida 12-30, Zona 11", city: "Guatemala" } },
  { key: "lucia", id: "customer-lucia", code: "CLI-003", name: "Lucía Herrera", email: "lucia.herrera@example.com", phone: "5555-0303", segmentId: "segment-retail", createdDaysAgo: 32, address: { line1: "12 calle 4-55, Zona 14", city: "Guatemala" } },
  { key: "constructora", id: "customer-constructora", code: "CLI-004", name: "Constructora Maya, S.A.", email: "compras@constructoramaya.example.com", phone: "2222-0404", segmentId: "segment-wholesale", createdDaysAgo: 38, address: { line1: "Km 14.5 Carretera a El Salvador", city: "Santa Catarina Pinula" } },
  { key: "roberto", id: "customer-roberto", code: "CLI-005", name: "Roberto Pineda", email: "roberto.pineda@example.com", phone: "5555-0505", segmentId: "segment-retail", createdDaysAgo: 14, address: { line1: "3a calle 8-21, Zona 17", city: "Guatemala" } },
];

const CUSTOMER_ID: Readonly<Record<CustomerKey, string>> = {
  ana: "customer-ana",
  carlos: "customer-carlos",
  lucia: "customer-lucia",
  constructora: "customer-constructora",
  roberto: "customer-roberto",
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const pad = (value: number, size = 3) => String(value).padStart(size, "0");

// Metodo de pago de las ventas POS de un solo pago (las "mixed" se dividen aparte).
const SINGLE_PAY_METHOD: Record<Exclude<PayKind, "mixed">, PaymentMethod> = {
  cash: PaymentMethod.cash,
  card: PaymentMethod.card,
  transfer: PaymentMethod.transfer,
};

// Referencia del pago de una venta POS segun el metodo (efectivo no lleva referencia).
const salePaymentReference = (method: PaymentMethod, number: number) => {
  if (method === PaymentMethod.card) return `TERM-${pad(4000 + number * 11, 6)}`;
  if (method === PaymentMethod.transfer) return `TRX-DEMO-${pad(number)}`;
  return undefined;
};

// Orden de desempate entre movimientos del mismo instante: las entradas van antes que las salidas.
const movementTypeOrder = (left: InventoryMovementType, right: InventoryMovementType) => {
  if (left === right) return 0;
  return left === InventoryMovementType.in ? -1 : 1;
};

interface StockEvent {
  branchId: string;
  productId: string;
  type: InventoryMovementType.in | InventoryMovementType.out;
  quantity: number;
  createdAt: string;
  reason: string;
  referenceType: string;
  referenceId: string;
  performedByUserId: string;
}

export function buildDemoActivity(base: MockDatabase, reference: Date): DemoActivity {
  const productById = new Map<string, Product>(base.products.map((product) => [product.id, product]));
  const requireProduct = (productId: string) => {
    const product = productById.get(productId);
    if (!product) throw new Error(`Demo activity: unknown product ${productId}`);
    return product;
  };

  /** Inicio (00:00 local) del dia que queda `d` dias antes de `reference`. */
  const startOfDay = (d: number): Date => {
    const date = new Date(reference);
    date.setDate(date.getDate() - d);
    date.setHours(0, 0, 0, 0);
    return date;
  };
  /**
   * Estrategia de tiempos (determinista): una actividad ocurre `d` dias atras a la hora local `hm`.
   * Los dias pasados (d >= 1) siempre quedan antes de `reference`, asi que se usan tal cual. Solo
   * "hoy" (d === 0) puede planificarse mas tarde que `reference` (p.ej. a las 06:30 con ventas
   * previstas a las 12:45). En ese caso toda la actividad de hoy se escala linealmente al tramo transcurrido
   * del dia: offset' = offset * (transcurrido / ultima hora planificada de hoy). Un escalado lineal
   * es monotono, por lo que conserva el orden relativo (ventas, apertura de caja, kardex, despachos)
   * y el dia calendario, y nunca supera `reference`. Si todo lo planificado ya ocurrio, la escala es 1
   * y las horas quedan exactamente como se planearon. Limite conocido: exactamente a las 00:00:00.000
   * no hay tramo transcurrido y las actividades de hoy coinciden en `reference`.
   */
  const todayScale = Math.min(
    1,
    (reference.getTime() - startOfDay(0).getTime()) / LATEST_PLANNED_TODAY_MS,
  );
  const at = (d: number, hm: string): string => {
    const [hours, minutes] = hm.split(":").map(Number);
    const dayStart = startOfDay(d);
    if (d > 0) {
      dayStart.setHours(hours, minutes, 0, 0);
      return dayStart.toISOString();
    }
    const plannedOffset = (hours * 60 + minutes) * 60_000;
    return new Date(dayStart.getTime() + Math.floor(plannedOffset * todayScale)).toISOString();
  };
  const shift = (iso: string, minutes: number) =>
    new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

  const unitPriceFor = (productId: string, quantity: number) =>
    resolveQuantityPrice({
      basePrice: requireProduct(productId).salePrice,
      quantity,
      tiers: base.productSalesPriceTiers.filter((tier) => tier.productId === productId),
    });

  // --- Inventario: balances por sucursal ------------------------------------------------------
  const balances: InventoryBalance[] = base.inventoryBalances.map((balance) => ({ ...balance }));
  const norteSettings: ProductInventorySettings[] = [];
  Object.entries(NORTE_FINAL_STOCK).forEach(([productId, quantity]) => {
    const centroBalance = base.inventoryBalances.find(
      (balance) => balance.branchId === CENTRO && balance.productId === productId,
    );
    const minStock = Math.ceil((centroBalance?.minStock ?? 4) / 2);
    const reorderPoint = minStock + Math.max(1, Math.ceil(minStock / 2));
    balances.push({
      id: `balance-${productId}-norte`,
      tenantId: TENANT_ID,
      branchId: NORTE,
      productId,
      locationId: "loc-norte-a",
      quantity,
      reservedQuantity: 0,
      minStock,
      reorderPoint,
      updatedAt: reference.toISOString(),
    });
    norteSettings.push({
      id: `product-inventory-settings-${productId}-${NORTE}`,
      tenantId: TENANT_ID,
      productId,
      branchId: NORTE,
      minStock,
      reorderPoint,
      defaultLocationId: "loc-norte-a",
      createdAt: at(OPENING_DAYS_AGO, "08:00"),
      updatedAt: at(OPENING_DAYS_AGO, "08:00"),
    });
  });
  const balanceFor = (branchId: string, productId: string) => {
    const balance = balances.find(
      (item) => item.branchId === branchId && item.productId === productId,
    );
    if (!balance) throw new Error(`Demo activity: no balance for ${productId} in ${branchId}`);
    return balance;
  };
  const stockEvents: StockEvent[] = [];

  // --- Clientes -------------------------------------------------------------------------------
  const customerSegments: CustomerSegment[] = [
    ...base.customerSegments,
    {
      id: "segment-wholesale",
      tenantId: TENANT_ID,
      name: "Mayorista",
      active: true,
      createdAt: at(OPENING_DAYS_AGO, "08:00"),
      updatedAt: at(OPENING_DAYS_AGO, "08:00"),
    },
  ];
  const customers: Customer[] = [
    ...base.customers,
    ...CUSTOMER_SPECS.map<Customer>((spec) => ({
      id: spec.id,
      tenantId: TENANT_ID,
      code: spec.code,
      name: spec.name,
      email: spec.email,
      phone: spec.phone,
      segmentId: spec.segmentId,
      status: CustomerStatus.active,
      createdAt: at(spec.createdDaysAgo, "10:00"),
      updatedAt: at(spec.createdDaysAgo, "10:00"),
    })),
  ];
  const addresses: Address[] = [
    ...base.addresses,
    ...CUSTOMER_SPECS.map<Address>((spec) => ({
      id: `address-${spec.key}-1`,
      tenantId: TENANT_ID,
      customerId: spec.id,
      label: spec.key === "constructora" ? "Obra principal" : "Casa",
      recipientName: spec.name,
      line1: spec.address.line1,
      city: spec.address.city,
      stateOrDepartment: "Guatemala",
      country: "Guatemala",
      isDefault: true,
      createdAt: at(spec.createdDaysAgo, "10:00"),
      updatedAt: at(spec.createdDaysAgo, "10:00"),
    })),
  ];
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));

  // --- Ventas POS, pagos, turnos y caja -------------------------------------------------------
  const orderedSaleSpecs = DEMO_SALE_SPECS.map((spec) => ({
    spec,
    createdAt: at(spec.d, spec.hm),
  })).sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  const cashierByBranch: Record<string, { userId: string; registerCode: string; opening: number }> = {
    [CENTRO]: { userId: "user-cashier", registerCode: "CAJA-01", opening: 500 },
    [NORTE]: { userId: "user-cashier-norte", registerCode: "CAJA-N1", opening: 300 },
  };
  const shiftIdFor = (branchId: string, d: number) =>
    branchId === CENTRO && d === 0 ? "cash-shift-001" : `cash-shift-demo-${branchId.replace("branch-", "")}-d${d}`;

  const sales: Sale[] = [];
  const saleItems: SaleItem[] = [];
  const payments: Payment[] = [];
  const cashMovements: CashMovement[] = [];
  const shiftSales = new Map<string, { branchId: string; d: number; times: string[] }>();

  orderedSaleSpecs.forEach(({ spec, createdAt }, index) => {
    const number = index + 1;
    const saleId = `sale-demo-${pad(number)}`;
    const cashier = cashierByBranch[spec.branch];
    const items: SaleItem[] = spec.items.map(([productId, quantity], itemIndex) => {
      const product = requireProduct(productId);
      const unitPrice = unitPriceFor(productId, quantity);
      return {
        id: `${saleId}-item-${itemIndex + 1}`,
        saleId,
        productId,
        skuSnapshot: product.sku,
        nameSnapshot: product.name,
        quantity,
        unitPrice,
        discount: 0,
        subtotal: roundMoney(unitPrice * quantity),
      };
      });
    const subtotal = roundMoney(items.reduce((sum, item) => sum + (item.unitPrice + item.discount) * item.quantity, 0));
    const discountTotal = roundMoney(items.reduce((sum, item) => sum + item.discount * item.quantity, 0));
    const total = roundMoney(subtotal - discountTotal);
    const customer = spec.customer ? customerById.get(CUSTOMER_ID[spec.customer]) : undefined;
    const shiftId = shiftIdFor(spec.branch, spec.d);
    const group = shiftSales.get(shiftId) ?? { branchId: spec.branch, d: spec.d, times: [] };
    group.times.push(createdAt);
    shiftSales.set(shiftId, group);

    sales.push({
      id: saleId,
      tenantId: TENANT_ID,
      branchId: spec.branch,
      number: `POS-${pad(number)}`,
      customerId: customer?.id,
      cashShiftId: shiftId,
      items,
      status: SaleStatus.completed,
      document: spec.invoice && customer
        ? {
            type: "invoice",
            taxId: `${1200000 + number * 137}-${(number % 9) + 1}`,
            legalName: customer.name,
            fiscalAddress: "Ciudad de Guatemala",
          }
        : { type: "ticket" },
      subtotal,
      discountTotal,
      taxTotal: 0,
      total,
      createdByUserId: cashier.userId,
      createdAt,
      updatedAt: createdAt,
    });
    saleItems.push(...items);

    const split: Array<[PaymentMethod, number]> =
      spec.pay === "mixed"
        ? (() => {
            const cash = roundMoney(Math.floor(total / 2));
            return [[PaymentMethod.cash, cash], [PaymentMethod.card, roundMoney(total - cash)]];
          })()
        : [[SINGLE_PAY_METHOD[spec.pay], total]];
    split.forEach(([method, amount], paymentIndex) => {
      payments.push({
        id: `payment-demo-${saleId}-${paymentIndex + 1}`,
        tenantId: TENANT_ID,
        saleId,
        method,
        status: PaymentStatus.approved,
        amount,
        currency: "GTQ",
        bankAccountId: method === PaymentMethod.transfer ? BANK_ACCOUNT_ID : undefined,
        reference: salePaymentReference(method, number),
        createdAt,
      });
      if (method === PaymentMethod.cash) {
        cashMovements.push({
          id: `cash-movement-demo-${saleId}`,
          cashShiftId: shiftId,
          type: CashMovementType.in,
          amount,
          reason: `Venta POS-${pad(number)}`,
          referenceType: "sale",
          referenceId: saleId,
          createdByUserId: cashier.userId,
          createdAt,
        });
      }
    });

    items.forEach((item) => {
      stockEvents.push({
        branchId: spec.branch,
        productId: item.productId,
        type: InventoryMovementType.out,
        quantity: item.quantity,
        createdAt,
        reason: `Venta POS-${pad(number)}`,
        referenceType: "sale",
        referenceId: saleId,
        performedByUserId: cashier.userId,
      });
    });
  });

  // Turnos: uno por sucursal y dia con ventas; el de hoy en Centro es el turno abierto de CAJA-01.
  const cashShifts: CashShift[] = [];
  let closedShiftIndex = 0;
  [...shiftSales.entries()]
    .sort((left, right) => right[1].d - left[1].d)
    .forEach(([shiftId, group]) => {
      const cashier = cashierByBranch[group.branchId];
      // Marcas ISO-8601 de igual formato: el orden lexicografico coincide con el cronologico.
      const sorted = [...group.times].sort((left, right) => left.localeCompare(right));
      // Apertura 40 min antes de la 1a venta, sin cruzar a un dia anterior (caso de "hoy" escalado).
      const dayStartIso = startOfDay(group.d).toISOString();
      const openedAt = [shift(sorted[0], -40), dayStartIso].sort((a, b) => b.localeCompare(a))[0];
      const isOpen = group.branchId === CENTRO && group.d === 0;
      if (isOpen) {
        cashShifts.push({
          id: shiftId,
          tenantId: TENANT_ID,
          branchId: group.branchId,
          userId: cashier.userId,
          registerCode: cashier.registerCode,
          status: CashShiftStatus.open,
          openedAt,
          openingAmount: cashier.opening,
          createdAt: openedAt,
          updatedAt: openedAt,
        });
        return;
      }
      closedShiftIndex += 1;
      const closedAt = shift(sorted.at(-1) ?? sorted[0], 75);
      if (closedShiftIndex % 4 === 0) {
        cashMovements.push({
          id: `cash-movement-demo-${shiftId}-out`,
          cashShiftId: shiftId,
          type: CashMovementType.out,
          amount: 50,
          reason: "Gastos menores: flete de mercaderia",
          createdByUserId: cashier.userId,
          createdAt: shift(sorted[0], 20),
        });
      }
      if (closedShiftIndex % 7 === 3) {
        cashMovements.push({
          id: `cash-movement-demo-${shiftId}-in`,
          cashShiftId: shiftId,
          type: CashMovementType.in,
          amount: 100,
          reason: "Reposicion de cambio",
          createdByUserId: cashier.userId,
          createdAt: shift(sorted[0], 10),
        });
      }
      const expected = roundMoney(
        cashier.opening +
          cashMovements
            .filter((movement) => movement.cashShiftId === shiftId)
            .reduce(
              (sum, movement) =>
                sum + (movement.type === CashMovementType.in ? movement.amount : -movement.amount),
              0,
            ),
      );
      const withDifference = closedShiftIndex === 5;
      const counted = withDifference ? roundMoney(expected - 5) : expected;
      cashShifts.push({
        id: shiftId,
        tenantId: TENANT_ID,
        branchId: group.branchId,
        userId: cashier.userId,
        registerCode: cashier.registerCode,
        status: withDifference ? CashShiftStatus.closed_with_difference : CashShiftStatus.closed,
        openedAt,
        openingAmount: cashier.opening,
        closedAt,
        expectedAmount: expected,
        countedAmount: counted,
        difference: roundMoney(counted - expected),
        createdAt: openedAt,
        updatedAt: closedAt,
      });
    });
  cashMovements.sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  // --- Pedidos e-commerce ---------------------------------------------------------------------
  const existingOrders = base.orders.map<Order>((order) => ({
    ...order,
    createdAt: at(order.id === "order-001" ? 2 : 1, "10:30"),
    updatedAt: at(order.id === "order-001" ? 2 : 1, "10:30"),
  }));
  const orders: Order[] = [...existingOrders];
  const orderItems: OrderItem[] = base.orderItems.map((item) => ({ ...item }));
  const reservations: InventoryReservation[] = base.inventoryReservations.map((reservation) => ({
    ...reservation,
  }));
  const pickingOrders: PickingOrder[] = [...base.pickingOrders];
  const pickingItems: PickingItem[] = [...base.pickingItems];
  const dispatches: Dispatch[] = [...base.dispatches];
  const packages: Package[] = [...base.packages];
  const orderPayments: Payment[] = [...base.payments];

  // Referencia del pago de un pedido segun el metodo (efectivo no lleva referencia).
  const orderPaymentReference = (method: PaymentMethod, orderNumber: string) => {
    if (method === PaymentMethod.transfer) return `TRX-${orderNumber}`;
    if (method === PaymentMethod.card) return `CARD-${orderNumber}`;
    return undefined;
  };

  // Ultima actualizacion del pedido: entrega, despacho o creacion, en ese orden de prioridad.
  const orderUpdatedAt = (spec: OrderSpec, createdAt: string) => {
    if (spec.deliveredDaysAgo !== undefined) return at(spec.deliveredDaysAgo, "15:00");
    if (spec.dispatchedDaysAgo !== undefined) return at(spec.dispatchedDaysAgo, "09:30");
    return createdAt;
  };

  const buildOrderItems = (spec: OrderSpec, orderId: string): OrderItem[] =>
    spec.items.map(([productId, quantity], index) => {
      const product = requireProduct(productId);
      const unitPrice = unitPriceFor(productId, quantity);
      return {
        id: `order-item-demo-${pad(spec.n)}-${index + 1}`,
        orderId,
        productId,
        skuSnapshot: product.sku,
        nameSnapshot: product.name,
        quantity,
        inventoryQuantity: quantity,
        unitPrice,
        discount: 0,
        subtotal: roundMoney(unitPrice * quantity),
        fulfillmentComponents: [{ productId, quantity }],
      };
    });

  const buildOrder = (
    spec: OrderSpec,
    context: { orderId: string; orderNumber: string; items: OrderItem[]; createdAt: string },
  ): { order: Order; total: number } => {
    const { orderId, orderNumber, items, createdAt } = context;
    const customer = spec.customer ? customerById.get(CUSTOMER_ID[spec.customer]) : undefined;
    const isHome = spec.delivery === DeliveryMethod.home_delivery;
    const subtotal = roundMoney(items.reduce((sum, item) => sum + item.subtotal, 0));
    const shippingTotal = isHome && subtotal < 300 ? 25 : 0;
    const contactEmail = customer?.email ?? spec.guest?.email ?? "";
    const recipientName = customer?.name ?? spec.guest?.name ?? "Cliente";
    const recipientPhone = customer?.phone ?? "5555-0000";
    const address = customer ? addresses.find((item) => item.customerId === customer.id) : undefined;
    const total = roundMoney(subtotal + shippingTotal);

    const order: Order = {
      id: orderId,
      tenantId: TENANT_ID,
      branchId: CENTRO,
      orderNumber,
      source: OrderSource.ecommerce,
      customerId: customer?.id,
      guestCustomer: spec.guest,
      items,
      status: spec.status,
      deliveryMethod: spec.delivery,
      transportMode: isHome ? TransportMode.own_fleet : TransportMode.customer,
      deliveryAddress: isHome
        ? {
            recipientName,
            recipientPhone,
            line1: address?.line1 ?? "Zona 1",
            city: address?.city ?? "Guatemala",
            stateOrDepartment: "Guatemala",
            country: "Guatemala",
          }
        : undefined,
      storePickupContact: isHome ? undefined : { recipientName, recipientPhone },
      notificationContact: { emailMode: "send", email: contactEmail },
      subtotal,
      discountTotal: 0,
      shippingTotal,
      total,
      trackingToken: `TRACK-${orderNumber}`,
      createdAt,
      updatedAt: orderUpdatedAt(spec, createdAt),
    };
    return { order, total };
  };

  const buildOrderPayment = (
    spec: OrderSpec,
    context: { orderId: string; orderNumber: string; total: number; createdAt: string },
  ): Payment => ({
    id: `payment-demo-${context.orderId}`,
    tenantId: TENANT_ID,
    orderId: context.orderId,
    method: spec.payment.method,
    status: spec.payment.status,
    amount: context.total,
    currency: "GTQ",
    bankAccountId: spec.payment.method === PaymentMethod.transfer ? BANK_ACCOUNT_ID : undefined,
    reference: orderPaymentReference(spec.payment.method, context.orderNumber),
    createdAt: context.createdAt,
  });

  // Reservas de stock de un pedido; si ya salio a despacho la reserva queda consumida.
  const reserveOrderStock = (
    items: OrderItem[],
    context: { orderId: string; consumed: boolean; createdAt: string; updatedAt: string },
  ) => {
    const { orderId, consumed, createdAt, updatedAt } = context;
    items.forEach((item) => {
      const balance = balanceFor(CENTRO, item.productId);
      if (!consumed) balance.reservedQuantity += item.quantity;
      reservations.push({
        id: `inventory-reservation-${item.id}`,
        tenantId: TENANT_ID,
        branchId: CENTRO,
        orderId,
        orderItemId: item.id,
        productId: item.productId,
        status: consumed ? InventoryReservationStatus.consumed : InventoryReservationStatus.active,
        allocations: [
          {
            id: `reservation-allocation-${item.id}`,
            balanceId: balance.id,
            locationId: balance.locationId,
            reservedQuantity: item.quantity,
            consumedQuantity: consumed ? item.quantity : 0,
          },
        ],
        createdAt,
        updatedAt,
      });
    });
  };

  const addOrderPicking = (spec: OrderSpec, orderId: string, items: OrderItem[], createdAt: string) => {
    const pickingId = `picking-demo-${pad(spec.n)}`;
    const startedAt = shift(createdAt, 90);
    pickingOrders.push({
      id: pickingId,
      tenantId: TENANT_ID,
      orderId,
      branchId: CENTRO,
      assignedUserId: "user-warehouse",
      status: PickingStatus.completed,
      priority: PickingPriority.normal,
      startedAt,
      completedAt: shift(startedAt, 35),
      createdAt: shift(createdAt, 30),
      updatedAt: shift(startedAt, 35),
    });
    items.forEach((item) => {
      pickingItems.push({
        id: `picking-item-${item.id}`,
        pickingOrderId: pickingId,
        orderItemId: item.id,
        productId: item.productId,
        requestedQuantity: item.quantity,
        pickedQuantity: item.quantity,
        locationId: balanceFor(CENTRO, item.productId).locationId,
        serialNumbers: [],
        status: PickingItemStatus.completed,
      });
    });
  };

  const addOrderDispatch = (
    spec: OrderSpec,
    context: { orderId: string; orderNumber: string; items: OrderItem[]; dispatchedDaysAgo: number },
  ) => {
    const { orderId, orderNumber, items, dispatchedDaysAgo } = context;
    const dispatchedAt = at(dispatchedDaysAgo, "09:30");
    const dispatchId = `dispatch-demo-${pad(spec.n)}`;
    const delivered = spec.deliveredDaysAgo !== undefined;
    const deliveredAt = delivered ? at(spec.deliveredDaysAgo ?? 0, "15:00") : undefined;
    dispatches.push({
      id: dispatchId,
      tenantId: TENANT_ID,
      orderId,
      branchId: CENTRO,
      status: delivered ? DispatchStatus.delivered : DispatchStatus.dispatched,
      transportMode: spec.carrier ? TransportMode.third_party : TransportMode.own_fleet,
      carrierName: spec.carrier?.name,
      trackingNumber: spec.carrier?.tracking,
      dispatchedByUserId: "user-warehouse",
      vehicle: spec.carrier ? undefined : "Pickup P-482KLM",
      driver: spec.carrier ? undefined : "Mario Tzul",
      packageCount: 1,
      dispatchedAt,
      deliveredAt,
      createdAt: shift(dispatchedAt, -45),
      updatedAt: deliveredAt ?? dispatchedAt,
    });
    packages.push({
      id: `package-demo-${pad(spec.n)}`,
      dispatchId,
      number: `PKG-${pad(100 + spec.n)}`,
      description: "Caja de pedido",
      createdAt: shift(dispatchedAt, -45),
    });
    items.forEach((item) => {
      stockEvents.push({
        branchId: CENTRO,
        productId: item.productId,
        type: InventoryMovementType.out,
        quantity: item.quantity,
        createdAt: dispatchedAt,
        reason: `Despacho pedido ${orderNumber}`,
        referenceType: "order",
        referenceId: orderId,
        performedByUserId: "user-warehouse",
      });
    });
  };

  ORDER_SPECS.forEach((spec) => {
    const orderId = `order-${pad(spec.n)}`;
    const orderNumber = `WEB-${pad(spec.n)}`;
    const createdAt = at(spec.d, spec.hm);
    const items = buildOrderItems(spec, orderId);
    const { order, total } = buildOrder(spec, { orderId, orderNumber, items, createdAt });

    orders.push(order);
    orderItems.push(...items);
    orderPayments.push(buildOrderPayment(spec, { orderId, orderNumber, total, createdAt }));

    const reserveStock =
      spec.status !== OrderStatus.pending && spec.status !== OrderStatus.cancelled;
    if (reserveStock) {
      reserveOrderStock(items, {
        orderId,
        consumed: spec.dispatchedDaysAgo !== undefined,
        createdAt,
        updatedAt: order.updatedAt,
      });
    }
    if (spec.picked) addOrderPicking(spec, orderId, items, createdAt);
    if (spec.dispatchedDaysAgo !== undefined) {
      addOrderDispatch(spec, { orderId, orderNumber, items, dispatchedDaysAgo: spec.dispatchedDaysAgo });
    }
  });

  // --- Compras y recepciones ------------------------------------------------------------------
  const purchaseOrders: PurchaseOrder[] = [...base.purchaseOrders];
  const purchaseOrderItems: PurchaseOrderItem[] = [...base.purchaseOrderItems];
  const receipts: Receipt[] = [...base.receipts];
  const receiptLines: ReceiptLine[] = [...base.receiptLines];
  const receiptIncidents: ReceiptIncident[] = [...base.receiptIncidents];

  PURCHASE_SPECS.forEach((spec) => {
    const createdAt = at(spec.createdDaysAgo, "09:00");
    const lines = spec.items.map<PurchaseOrderItem>(([productId, ordered], index) => {
      const supplierProduct = base.supplierProducts.find(
        (item) => item.productId === productId && item.supplierId === spec.supplierId,
      );
      const unitCost = supplierProduct?.lastCost ?? requireProduct(productId).salePrice * 0.65;
      return {
        id: `${spec.id}-item-${index + 1}`,
        purchaseOrderId: spec.id,
        supplierProductId: supplierProduct?.id,
        productId,
        productNameSnapshot: requireProduct(productId).name,
        productSkuSnapshot: requireProduct(productId).sku,
        quantity: ordered,
        unitId: "unit-unit",
        purchaseToBaseFactor: 1,
        unitCost,
        subtotal: roundMoney(unitCost * ordered),
      };
    });
    const total = roundMoney(lines.reduce((sum, line) => sum + line.subtotal, 0));
    const approved = spec.status !== PurchaseOrderStatus.pending_approval;
    purchaseOrders.push({
      id: spec.id,
      tenantId: TENANT_ID,
      branchId: spec.branch,
      number: spec.number,
      supplierId: spec.supplierId,
      status: spec.status,
      expectedDate: at(spec.createdDaysAgo - 4, "00:00"),
      subtotal: total,
      total,
      createdByUserId: "user-admin",
      approvedByUserId: approved ? "user-admin" : undefined,
      approvedAt: approved ? shift(createdAt, 60) : undefined,
      createdAt,
      updatedAt: spec.receipt ? at(spec.receipt.daysAgo, "10:00") : createdAt,
    });
    purchaseOrderItems.push(...lines);

    const receiptSpec = spec.receipt;
    if (!receiptSpec) return;
    const receivedAt = at(receiptSpec.daysAgo, "10:00");
    receipts.push({
      id: receiptSpec.id,
      tenantId: TENANT_ID,
      branchId: spec.branch,
      number: receiptSpec.number,
      purchaseOrderId: spec.id,
      supplierId: spec.supplierId,
      status: receiptSpec.status,
      receivedByUserId: "user-warehouse",
      receivedAt,
      totalReceivedQuantity: spec.items.reduce((sum, [, , received]) => sum + (received ?? 0), 0),
      incidentCount: spec.incident ? 1 : 0,
      createdAt: receivedAt,
      updatedAt: receivedAt,
    });
    spec.items.forEach(([productId, ordered, received], index) => {
      if (!received) return;
      const balance = balanceFor(spec.branch, productId);
      const hasIncident = spec.incident?.productId === productId;
      receiptLines.push({
        id: `${receiptSpec.id}-line-${index + 1}`,
        receiptId: receiptSpec.id,
        productId,
        orderedQuantity: ordered,
        receivedQuantity: received,
        inventoryQuantity: received,
        status: hasIncident || received < ordered ? ReceiptLineStatus.partial : ReceiptLineStatus.complete,
        locationId: balance.locationId,
      });
      stockEvents.push({
        branchId: spec.branch,
        productId,
        type: InventoryMovementType.in,
        quantity: received,
        createdAt: receivedAt,
        reason: `Recepcion ${spec.number}`,
        referenceType: "receipt",
        referenceId: receiptSpec.id,
        performedByUserId: "user-warehouse",
      });
    });
    if (spec.incident) {
      const incidentAt = at(spec.incident.daysAgo, "10:30");
      receiptIncidents.push({
        id: `receipt-incident-demo-${receiptSpec.id}`,
        receiptId: receiptSpec.id,
        receiptLineId: `${receiptSpec.id}-line-${
          spec.items.findIndex(([productId]) => productId === spec.incident?.productId) + 1
        }`,
        incidentTypeId: "incident-missing",
        description: spec.incident.description,
        quantityAffected: spec.incident.quantityAffected,
        createdByUserId: "user-warehouse",
        createdAt: incidentAt,
        status: "open",
        updatedAt: incidentAt,
      });
    }
  });

  // --- Kardex: inventario inicial derivado + movimientos con quantityBefore/After --------------
  const totals = new Map<string, { in: number; out: number }>();
  const key = (branchId: string, productId: string) => `${branchId}|${productId}`;
  stockEvents.forEach((event) => {
    const current = totals.get(key(event.branchId, event.productId)) ?? { in: 0, out: 0 };
    if (event.type === InventoryMovementType.in) current.in += event.quantity;
    else current.out += event.quantity;
    totals.set(key(event.branchId, event.productId), current);
  });
  const openingAt = at(OPENING_DAYS_AGO, "08:00");
  balances.forEach((balance) => {
    const moved = totals.get(key(balance.branchId, balance.productId)) ?? { in: 0, out: 0 };
    const opening = balance.quantity + moved.out - moved.in;
    if (opening < 0) {
      throw new Error(
        `Demo activity: ${balance.productId}@${balance.branchId} would need negative opening stock (${opening}).`,
      );
    }
    if (opening === 0) return;
    stockEvents.push({
      branchId: balance.branchId,
      productId: balance.productId,
      type: InventoryMovementType.in,
      quantity: opening,
      createdAt: openingAt,
      reason: "Inventario inicial",
      referenceType: "opening-balance",
      referenceId: `opening-${balance.branchId}-${balance.productId}`,
      performedByUserId: "user-inventory",
    });
  });

  const running = new Map<string, number>();
  const inventoryMovements: InventoryMovement[] = [...stockEvents]
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        movementTypeOrder(left.type, right.type),
    )
    .map((event, index) => {
      const balance = balanceFor(event.branchId, event.productId);
      const before = running.get(key(event.branchId, event.productId)) ?? 0;
      const after =
        event.type === InventoryMovementType.in ? before + event.quantity : before - event.quantity;
      if (after < 0) {
        throw new Error(`Demo activity: negative running stock for ${event.productId}@${event.branchId}.`);
      }
      running.set(key(event.branchId, event.productId), after);
      return {
        id: `movement-demo-${pad(index + 1, 4)}`,
        tenantId: TENANT_ID,
        branchId: event.branchId,
        productId: event.productId,
        type: event.type,
        reason: event.reason,
        quantity: event.quantity,
        quantityBefore: before,
        quantityAfter: after,
        fromLocationId: event.type === InventoryMovementType.out ? balance.locationId : undefined,
        toLocationId: event.type === InventoryMovementType.in ? balance.locationId : undefined,
        referenceType: event.referenceType,
        referenceId: event.referenceId,
        performedByUserId: event.performedByUserId,
        createdAt: event.createdAt,
      };
    });

  balances.forEach((balance) => {
    balance.updatedAt = reference.toISOString();
  });

  return {
    customers,
    addresses,
    customerSegments,
    sales,
    saleItems,
    payments: [...orderPayments, ...payments],
    cashShifts,
    cashMovements,
    inventoryBalances: balances,
    productInventorySettings: [...base.productInventorySettings, ...norteSettings],
    inventoryMovements,
    inventoryReservations: reservations,
    orders,
    orderItems,
    pickingOrders,
    pickingItems,
    dispatches,
    packages,
    purchaseOrders,
    purchaseOrderItems,
    receipts,
    receiptLines,
    receiptIncidents,
  };
}
