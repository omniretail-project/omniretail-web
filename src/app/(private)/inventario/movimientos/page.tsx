import { Suspense } from "react";
import { InventoryMovementsPage } from "@/modules/inventory";

export default function InventoryMovementsRoute() {
  return (
    <Suspense fallback={null}>
      <InventoryMovementsPage />
    </Suspense>
  );
}
