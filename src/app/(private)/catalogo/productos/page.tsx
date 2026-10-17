import { Suspense } from "react";
import { ProductsPage } from "@/modules/catalog";

export default function Page() {
  // ProductsPage lee ?categoryId= y ?quickView= con useSearchParams (requiere Suspense).
  return (
    <Suspense fallback={null}>
      <ProductsPage />
    </Suspense>
  );
}
