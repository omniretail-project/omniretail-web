const STORAGE_KEY = "omniretail:purchasing:orders-context:v1";
const MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Contexto temporal de navegacion hacia /compras/ordenes (reemplaza ?orderId=<UUID>). Vive en
 * sessionStorage de la pestana; es UX, no autorizacion: el backend valida cada request.
 */
export interface OrdersNavContext {
  orderId: string;
  orderNumber: string;
  supplierId?: string;
  supplierName?: string;
  source: "supplier";
}

interface StoredContext extends OrdersNavContext {
  savedAt: number;
}

export function saveOrdersNavContext(context: OrdersNavContext) {
  try {
    const stored: StoredContext = { ...context, savedAt: Date.now() };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Sin storage la lista se abre sin orden preseleccionada.
  }
}

export function readOrdersNavContext(): OrdersNavContext | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredContext>;
    if (
      typeof parsed.orderId !== "string" ||
      !parsed.orderId ||
      typeof parsed.savedAt !== "number" ||
      Date.now() - parsed.savedAt > MAX_AGE_MS
    ) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      orderId: parsed.orderId,
      orderNumber: typeof parsed.orderNumber === "string" ? parsed.orderNumber : "",
      ...(typeof parsed.supplierId === "string" ? { supplierId: parsed.supplierId } : {}),
      ...(typeof parsed.supplierName === "string" ? { supplierName: parsed.supplierName } : {}),
      source: "supplier",
    };
  } catch {
    return null;
  }
}

export function clearOrdersNavContext() {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nada que limpiar.
  }
}
