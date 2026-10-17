export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface StatusDefinition {
  label: string;
  tone: StatusTone;
  storefrontOrderProgress?: "confirmed" | "preparing" | "sent";
}

export const statusesConfig: Record<string, StatusDefinition> = {
  active: { label: "Activo", tone: "success" },
  inactive: { label: "Inactivo", tone: "neutral" },
  archived: { label: "Archivado", tone: "neutral" },
  blocked: { label: "Bloqueado", tone: "danger" },
  // AccountStatus (auth) -- distinto de UserStatus, ver admin-users / SCOPE.md 12.12.
  pending_verification: { label: "Pendiente de verificación", tone: "warning" },
  temporarily_locked: { label: "Bloqueada temporalmente", tone: "danger" },
  password_reset_required: { label: "Pendiente de activación", tone: "warning" },
  disabled: { label: "Deshabilitada", tone: "danger" },
  published: { label: "Publicado", tone: "success" },
  pending: { label: "Pendiente", tone: "warning" },
  confirmed: { label: "Confirmado", tone: "info", storefrontOrderProgress: "confirmed" },
  preparing: { label: "Preparando", tone: "info", storefrontOrderProgress: "preparing" },
  picking: { label: "Picking", tone: "info", storefrontOrderProgress: "preparing" },
  packing: { label: "Empacando", tone: "info", storefrontOrderProgress: "preparing" },
  ready_for_pickup: {
    label: "Listo para recoger",
    tone: "success",
    storefrontOrderProgress: "preparing",
  },
  ready_for_dispatch: {
    label: "Listo para despacho",
    tone: "success",
    storefrontOrderProgress: "preparing",
  },
  dispatched: { label: "Despachado", tone: "info", storefrontOrderProgress: "sent" },
  sent: { label: "Enviado", tone: "info", storefrontOrderProgress: "sent" },
  delivered: { label: "Entregado", tone: "success", storefrontOrderProgress: "sent" },
  cancelled: { label: "Cancelado", tone: "danger" },
  partially_returned: { label: "Parcialmente devuelta", tone: "warning" },
  returned: { label: "Devuelta", tone: "danger" },
  approved: { label: "Aprobado", tone: "success" },
  rejected: { label: "Rechazado", tone: "danger" },
  received: { label: "Recibido", tone: "success" },
  partial: { label: "Parcial", tone: "warning" },
  pending_approval: { label: "Pendiente de aprobación", tone: "warning" },
  partially_received: { label: "Recibida parcialmente", tone: "warning" },
  refunded: { label: "Reembolsado", tone: "neutral" },
  in_progress: { label: "En progreso", tone: "info" },
  completed: { label: "Completado", tone: "success" },
  open: { label: "Abierto", tone: "success" },
  closed: { label: "Cerrado", tone: "neutral" },
  closed_with_difference: { label: "Cerrado con diferencia", tone: "warning" },
  scheduled: { label: "Programado", tone: "info" },
  ended: { label: "Finalizado", tone: "neutral" },
  unread: { label: "No leido", tone: "info" },
  read: { label: "Leido", tone: "neutral" },
  // TenantSubscriptionStatus (saas foundation) -- active/cancelled ya existen arriba.
  suspended: { label: "Suspendida", tone: "danger" },
};
