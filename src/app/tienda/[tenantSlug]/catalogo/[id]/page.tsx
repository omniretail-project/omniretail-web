import { ProductDetailPage } from "@/modules/storefront/pages/ProductDetailPage";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <ProductDetailPage productId={id} />; }
