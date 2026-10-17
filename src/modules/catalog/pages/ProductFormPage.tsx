"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Product } from "@/core/entities";
import { ProductType } from "@/core/enums";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { AccessDeniedState } from "@/shared/components/AccessDeniedState";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { PageErrorState } from "@/shared/components/PageErrorState";
import { useToast } from "@/shared/components/Toast";
import { useActiveBranch } from "@/shared/navigation/PrivateHeader/ActiveBranchProvider";
import { ProductForm } from "@/modules/catalog/components/ProductForm";
import type { ProductEditorDto } from "@/modules/catalog/application/dto/ProductEditorDto";
import { useProductEditorData } from "@/modules/catalog/hooks/useProductEditorData";
import { useProductFormOptions } from "@/modules/catalog/hooks/useProductFormOptions";
import { useProductMutations } from "@/modules/catalog/hooks/useProductMutations";
import { useProductPermissions } from "@/modules/catalog/hooks/useProductPermissions";
import { ProductEditorPartialSaveError } from "@/modules/catalog/application/services/ProductEditorPartialSaveError";

interface ProductFormPageProps {
  mode: "create" | "edit";
}

export function ProductFormPage({ mode }: ProductFormPageProps) {
  const params = useParams<{ id?: string }>();
  const productId = params.id ?? "";
  const router = useRouter();
  const { showToast } = useToast();
  const isEdit = mode === "edit";
  const { canCreate, canUpdate } = useProductPermissions();
  const { currentBranch, loading: branchLoading } = useActiveBranch();
  const optionsState = useProductFormOptions();
  const editorState = useProductEditorData(
    isEdit ? productId : undefined,
    currentBranch?.id,
    currentBranch?.tenantId,
  );
  const mutations = useProductMutations();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [createdZeroStockProduct, setCreatedZeroStockProduct] = useState<Product | null>(null);
  const [canonicalReloadRevision, setCanonicalReloadRevision] = useState(0);

  // Solo precarga la ruta de Inventario para acortar la siguiente navegacion; no navega: eso
  // sigue dependiendo de que el usuario elija "Agregar existencia inicial".
  const hasCreatedZeroStockProduct = createdZeroStockProduct !== null;
  useEffect(() => {
    if (hasCreatedZeroStockProduct) router.prefetch("/inventario/alertas");
  }, [hasCreatedZeroStockProduct, router]);

  async function submit(dto: ProductEditorDto) {
    // Las mutaciones propias emiten eventos globales: no deben recargar (y desmontar) el editor.
    editorState.setEventReloadsSuspended(true);
    try {
      const dtoWithActiveBranch = {
        ...dto,
        inventorySettings: dto.inventorySettings
          ? {
              ...dto.inventorySettings,
              branchId: currentBranch?.id ?? dto.inventorySettings.branchId,
            }
          : undefined,
      };
      const product = isEdit
        ? await mutations.updateWithCommercialData(productId, dtoWithActiveBranch)
        : await mutations.createWithCommercialData(dtoWithActiveBranch);
      showToast({
        title: isEdit ? "Producto actualizado" : "Producto creado",
        description: !isEdit && product.productType === ProductType.physical && product.tracking.stock
          ? "Actualmente no tiene existencia."
          : undefined,
        tone: "success",
      });
      if (!isEdit && product.productType === ProductType.physical && product.tracking.stock) {
        setCreatedZeroStockProduct(product);
        return;
      }
      router.push(`/catalogo/productos/${product.id}`);
    } catch (caughtError) {
      if (caughtError instanceof ProductEditorPartialSaveError) {
        mutations.clearError();
        showToast({
          title: "Producto guardado parcialmente",
          description: caughtError.message,
          tone: "warning",
          duration: 8000,
        });
        if (isEdit) {
          await editorState.reload();
          setCanonicalReloadRevision((current) => current + 1);
        } else {
          router.push(`/catalogo/productos/${caughtError.productId}/editar`);
        }
        return;
      }
      showToast({
        title: "No se pudo guardar",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    } finally {
      editorState.setEventReloadsSuspended(false);
    }
  }

  async function archiveProduct() {
    if (!editorState.data?.detail) return;
    try {
      await mutations.archive(editorState.data.detail.product.id);
      showToast({ title: "Producto archivado", tone: "success" });
      setConfirmArchive(false);
      router.push(`/catalogo/productos/${editorState.data.detail.product.id}`);
    } catch (caughtError) {
      showToast({
        title: "No se pudo archivar",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  // permission-enforcement-hardening-products (§5/§6 del ticket): RequirePermission solo valida
  // el nav a nivel de sub-árbol (/catalogo/productos/*), no distingue crear de editar -- sin este
  // guard, un usuario con SOLO catalog.products.read llegaría a un formulario editable con solo
  // esconder el botón "Nuevo producto"/"Editar" en las pantallas anteriores. No alcanza con
  // ocultar el botón: la ruta en sí debe denegar.
  if ((mode === "create" && !canCreate) || (mode === "edit" && !canUpdate)) {
    return <AccessDeniedState />;
  }

  // El loader es solo para la carga INICIAL: con datos ya disponibles, una recarga de fondo
  // no desmonta el formulario ni su borrador local. El remount deliberado del guardado parcial
  // sigue dependiendo de canonicalReloadRevision (key del ProductForm).
  if (
    branchLoading ||
    (optionsState.loading && !optionsState.options) ||
    (editorState.loading && !editorState.data)
  ) {
    return (
      <p className="rounded-md border border-[var(--color-border)] bg-white p-5 text-sm text-[var(--color-text-muted)]">
        Preparando formulario...
      </p>
    );
  }

  if (!optionsState.options || optionsState.error) {
    return <PageErrorState description={optionsState.error ?? "No se pudieron cargar las opciones del formulario."} />;
  }

  if (!currentBranch) {
    return <InlineAlert description="Seleccione una sucursal activa para configurar el inventario del producto." title="Sucursal activa requerida" tone="warning" />;
  }

  if (editorState.error) {
    return <PageErrorState description={editorState.error} />;
  }

  if (!editorState.data || (isEdit && !editorState.data.detail)) {
    return (
      <div className="space-y-4 rounded-md border border-[var(--color-border)] bg-white p-6">
        <h1 className="text-xl font-bold text-[var(--color-title)]">Producto no encontrado</h1>
        <p className="text-sm text-[var(--color-text)]">El producto solicitado no existe.</p>
      </div>
    );
  }

  return (
    <>
      <div className="mx-auto w-full min-w-0 max-w-7xl xl:[&>form>fieldset>nav]:overflow-visible xl:[&>form>fieldset>nav>div]:min-w-0 xl:[&>form>fieldset>nav>div]:flex-wrap xl:[&>form>fieldset>nav>div]:gap-1 xl:[&>form>fieldset>nav_button]:min-w-0 xl:[&>form>fieldset>nav_button]:flex-1 xl:[&>form>fieldset>nav_button]:justify-center xl:[&>form>fieldset>nav_button]:gap-1.5 xl:[&>form>fieldset>nav_button]:px-2 xl:[&>form>fieldset>nav_button]:text-[13px] xl:[&>form>fieldset>nav_button]:leading-tight xl:[&>form>fieldset>nav_button>span]:shrink-0">
        <ProductForm
          branchId={currentBranch.id}
          busy={mutations.busy}
          editorData={editorState.data}
          error={mutations.error}
          key={`${mode}-${productId || "new"}-${currentBranch.id}-${canonicalReloadRevision}`}
          mode={mode}
          onArchive={() => setConfirmArchive(true)}
          onSubmit={submit}
          options={optionsState.options}
        />
      </div>
      <ConfirmDialog
        open={confirmArchive}
        title="Archivar producto"
        message="El producto dejara de estar disponible para nuevas operaciones, pero se conservara su historial."
        confirmLabel="Archivar"
        onCancel={() => setConfirmArchive(false)}
        onConfirm={archiveProduct}
      />
      <ConfirmDialog
        open={Boolean(createdZeroStockProduct)}
        title="Producto creado. Actualmente no tiene existencia."
        message={`La existencia pertenece a la sucursal activa (${currentBranch.name}). Registra el inventario inicial con el flujo de ajuste para mantener sus validaciones de lote, serie y vencimiento.`}
        confirmLabel="Agregar existencia inicial"
        onCancel={() => {
          // Al navegar, el desmontaje de la pagina elimina el dialogo (sin cerrarlo antes).
          if (createdZeroStockProduct) {
            router.push(`/catalogo/productos/${createdZeroStockProduct.id}`);
            return;
          }
          setCreatedZeroStockProduct(null);
        }}
        onConfirm={() => {
          if (createdZeroStockProduct) {
            router.push(
              `/inventario/alertas?productId=${encodeURIComponent(createdZeroStockProduct.id)}&openAdjustment=1`,
            );
            return;
          }
          setCreatedZeroStockProduct(null);
        }}
      />
    </>
  );
}
