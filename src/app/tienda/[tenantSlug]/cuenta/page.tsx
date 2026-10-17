import { redirect } from "next/navigation";
export default async function Page({ params }: { params: Promise<{ tenantSlug: string }> }) { const { tenantSlug } = await params; redirect(`/tienda/${encodeURIComponent(tenantSlug)}/cuenta/perfil`); }
