"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { ProductStatus } from "@/core/enums";
import { Button } from "@/shared/components/Button";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { PageHeader } from "@/shared/components/PageHeader";
import { useToast } from "@/shared/components/Toast";
import { ProductDetailCard } from "@/modules/catalog/components/ProductDetailCard";
import { useProductDetail } from "@/modules/catalog/hooks/useProductDetail";
import { useProductMutations } from "@/modules/catalog/hooks/useProductMutations";
import { useProductPermissions } from "@/modules/catalog/hooks/useProductPermissions";

export function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const { showToast } = useToast();
  const { canUpdate } = useProductPermissions();
  const { loading, detail, error, reload } = useProductDetail(params.id);
  const mutations = useProductMutations();
  const [confirmArchive, setConfirmArchive] = useState(false);

  async function archiveProduct() {
    if (!detail) return;
    try {
      await mutations.archive(detail.product.id);
      showToast({ title: "Producto archivado", tone: "success" });
      setConfirmArchive(false);
      reload();
    } catch (caughtError) {
      showToast({
        title: "No se pudo archivar",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  async function restoreProduct() {
    if (!detail) return;
    try {
      await mutations.restore(detail.product.id);
      showToast({ title: "Producto restaurado", tone: "success" });
      reload();
    } catch (caughtError) {
      showToast({
        title: "No se pudo restaurar",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  if (loading) {
    return (
      <p className="rounded-md border border-[var(--color-border)] bg-white p-5 text-sm text-[var(--color-text-muted)]">
        Cargando producto...
      </p>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4 rounded-md border border-[var(--color-border)] bg-white p-6">
        <h1 className="text-xl font-bold text-[var(--color-title)]">Producto no encontrado</h1>
        <p className="text-sm text-[var(--color-text)]">El producto solicitado no existe.</p>
        <Button href="/catalogo/productos">Volver</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={detail.product.name}
        description="Detalle del producto y configuracion comercial."
        actions={
          <>
            <Button href="/catalogo/productos">Volver</Button>
            {canUpdate && detail.product.status === ProductStatus.published ? (
              <Button href={`/catalogo/productos/${detail.product.id}/editar`}>Editar</Button>
            ) : null}
            {canUpdate && detail.product.status === ProductStatus.published ? (
              <Button onClick={() => setConfirmArchive(true)} type="button">
                Archivar
              </Button>
            ) : null}
            {canUpdate && detail.product.status === ProductStatus.archived ? (
              <Button onClick={restoreProduct} type="button">
                Restaurar producto
              </Button>
            ) : null}
          </>
        }
      />
      <ProductDetailCard detail={detail} />
      <ConfirmDialog
        open={confirmArchive}
        title="Archivar producto"
        message="El producto dejara de estar disponible para nuevas operaciones, pero se conservara su historial."
        confirmLabel="Archivar"
        onCancel={() => setConfirmArchive(false)}
        onConfirm={archiveProduct}
      />
    </div>
  );
}
