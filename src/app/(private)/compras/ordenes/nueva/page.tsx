import { Suspense } from "react";
import { PurchaseOrderFormPage } from "@/modules/purchasing";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PurchaseOrderFormPage mode="create" />
    </Suspense>
  );
}
