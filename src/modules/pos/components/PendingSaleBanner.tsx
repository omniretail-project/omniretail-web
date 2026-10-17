"use client";

import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { formatCurrency } from "@/shared/utils/formatCurrency";

export interface PendingSaleBannerProps {
  readonly total: number;
  readonly itemCount: number;
  readonly createdAt: string;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly onDiscard: () => void;
}

export const DISCARD_PENDING_SALE_WARNING =
  "Si la venta ya quedó registrada y la descartas, podrías cobrarla dos veces. Revisa primero el Historial de ventas. ¿Descartar de todos modos?";

/**
 * Aviso de una venta cuya respuesta se perdio. Mientras exista, la terminal no permite editar el
 * ticket ni crear otra venta: solo reenviar la misma solicitud (misma clave y mismo contenido) para
 * conocer el resultado.
 */
export function PendingSaleBanner({
  total,
  itemCount,
  createdAt,
  loading,
  error,
  onRetry,
  onDiscard,
}: PendingSaleBannerProps) {
  const time = new Date(createdAt).toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit" });
  return (
    <InlineAlert
      description={`${itemCount} producto(s) por ${formatCurrency(total)}, enviada a las ${time}. No se pudo confirmar si el servidor la registró; no cobres otra vez hasta verificarla.`}
      title="Hay una venta pendiente de verificar"
      tone="warning"
    >
      {error ? (
        <p className="mt-2 text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={loading} onClick={onRetry} type="button">
          {loading ? "Verificando..." : "Verificar resultado"}
        </Button>
        <Button
          disabled={loading}
          onClick={() => {
            if (window.confirm(DISCARD_PENDING_SALE_WARNING)) onDiscard();
          }}
          type="button"
          variant="secondary"
        >
          Descartar
        </Button>
      </div>
    </InlineAlert>
  );
}
