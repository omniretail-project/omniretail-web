import { Suspense } from "react";
import { InventoryRegularizationPage } from "@/modules/inventory";

export default function InventoryRegularizationRoute() {
  return (
    <Suspense fallback={null}>
      <InventoryRegularizationPage />
    </Suspense>
  );
}
