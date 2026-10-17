import { PedidoDetallePage } from "@/modules/customer/pages/PedidoDetallePage";

export default async function PedidoDetalleRoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PedidoDetallePage orderId={id} />;
}
