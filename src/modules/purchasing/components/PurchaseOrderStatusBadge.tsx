import { cn } from "@/shared/utils/cn";

const STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  pending_approval: "Pendiente de aprobacion",
  approved: "Aprobada",
  sent: "Enviada",
  partially_received: "Recepcion parcial",
  received: "Recibida",
  cancelled: "Cancelada",
};

/** Etiqueta en espanol de un estado de orden de compra; el valor del backend no cambia. */
export function getPurchaseOrderStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? "Estado no disponible";
}

/** Unica presentacion de estados de Purchase Order (lista de ordenes y detalle de proveedor). */
export function PurchaseOrderStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full px-2 py-1 text-xs font-bold",
        status === "draft" && "bg-slate-100 text-slate-700",
        status === "pending_approval" && "bg-amber-100 text-amber-800",
        status === "approved" && "bg-blue-100 text-blue-800",
        status === "sent" && "bg-indigo-100 text-indigo-800",
        status === "partially_received" && "bg-sky-100 text-amber-800 ring-1 ring-amber-200",
        status === "received" && "bg-emerald-100 text-emerald-800",
        status === "cancelled" && "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
      )}
    >
      {getPurchaseOrderStatusLabel(status)}
    </span>
  );
}
