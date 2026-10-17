import { OrderConfirmationPage } from "@/modules/storefront/pages/OrderConfirmationPage";

export default async function TokenizedOrderConfirmationRoute({
  params,
}: {
  params: Promise<{ trackingToken: string }>;
}) {
  const { trackingToken } = await params;
  return <OrderConfirmationPage trackingToken={trackingToken} />;
}
