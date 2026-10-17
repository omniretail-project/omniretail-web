import { PurchaseOrdersPage } from "@/modules/purchasing";

interface PurchaseOrdersRouteProps {
  searchParams: Promise<{ orderId?: string | string[] }>;
}

export default async function Page({ searchParams }: PurchaseOrdersRouteProps) {
  const { orderId } = await searchParams;
  return <PurchaseOrdersPage initialOrderId={typeof orderId === "string" ? orderId : undefined} />;
}
