/** Descarga el mismo PDF que el backend adjunta al correo de confirmación. */
export async function downloadStorefrontReceiptPdf({
  tenantSlug,
  trackingToken,
}: {
  tenantSlug: string;
  trackingToken: string;
}) {
  const response = await fetch(
    `/api/public/${encodeURIComponent(tenantSlug)}/receipt/${encodeURIComponent(trackingToken)}`,
  );
  if (!response.ok) throw new Error("No se pudo descargar el comprobante.");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = "comprobante-pedido.pdf";
  link.click();
  URL.revokeObjectURL(url);
}
