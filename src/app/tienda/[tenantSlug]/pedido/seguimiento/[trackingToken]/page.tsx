import { OrderTrackingPage } from "@/modules/storefront/pages/OrderTrackingPage";
export default async function Page({ params }: { params: Promise<{ trackingToken: string }> }) { const { trackingToken } = await params; return <OrderTrackingPage trackingToken={trackingToken} />; }
