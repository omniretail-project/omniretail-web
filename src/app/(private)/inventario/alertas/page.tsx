import { Suspense } from "react";
import { InventoryAlertsPage } from "@/modules/inventory";

export default function InventoryAlertsRoute() {
  // InventoryAlertsPage deriva panel/productId de la URL con useSearchParams (requiere Suspense).
  return (
    <Suspense fallback={null}>
      <InventoryAlertsPage />
    </Suspense>
  );
}
