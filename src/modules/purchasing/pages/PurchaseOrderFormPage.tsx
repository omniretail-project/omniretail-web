"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
  type SVGProps,
} from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { PageHeader } from "@/shared/components/PageHeader";
import { Select } from "@/shared/components/Select";
import { useToast } from "@/shared/components/Toast";
import { cn } from "@/shared/utils/cn";
import {
  hasAtMostDecimalPlaces,
  isQuantityCompatibleWithUnit,
  parseDecimalInput,
  parseUnitQuantityInput,
  toFiniteNumber,
} from "@/shared/utils/numberInput";
import {
  MAX_SAFE_INVENTORY_QUANTITY,
  MONEY_DECIMAL_PLACES,
  QUANTITY_DECIMAL_PLACES,
  TEXT_LIMITS,
} from "@/shared/utils/inputLimits";
import { SaasCapabilityKey } from "@/core/enums";
import { useCurrentSession } from "@/modules/auth/hooks/useCurrentSession";
import { useEntitlement } from "@/shared/hooks/useEntitlement";
import type { PurchaseOrderAvailableProduct } from "@/modules/purchasing/application/dto/PurchaseOrderEditorModel";
import type {
  PurchaseOrderEditorLine,
  PurchaseOrderPrefillContext,
  PurchaseOrderPrefillSource,
  PurchaseOrderEditorSupplier,
} from "@/modules/purchasing/application/dto/PurchaseOrderEditorModel";
import { usePurchaseOrderEditor } from "@/modules/purchasing/hooks/usePurchaseOrderEditor";

interface PurchaseOrderFormPageProps {
  mode: "create" | "edit";
}

export function PurchaseOrderFormPage({ mode }: PurchaseOrderFormPageProps) {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  // Los query params son solo transporte inicial: se consumen una vez al montar y luego la URL
  // se limpia. El estado congelado evita que el editor se reinicie al perder los params.
  const [prefillContext] = useState(() =>
    mode === "create" ? getPrefillContext(searchParams) : undefined,
  );
  const editor = usePurchaseOrderEditor(mode === "edit" ? params.id : undefined, prefillContext);
  const urlCleanedRef = useRef(false);
  const { prefillApplied } = editor;
  useEffect(() => {
    if (!prefillContext || !prefillApplied || urlCleanedRef.current) return;
    urlCleanedRef.current = true;
    router.replace("/compras/ordenes/nueva", { scroll: false });
  }, [prefillApplied, prefillContext, router]);
  const { hasCapability } = useEntitlement();
  const { hasPermission } = useCurrentSession();
  const canUsePurchasing = hasCapability(SaasCapabilityKey.purchasing);
  const canCreatePurchaseOrders = canUsePurchasing && hasPermission("purchasing.orders.create");
  const [pendingSupplierId, setPendingSupplierId] = useState<string | null>(null);
  const returnPath = getReturnPath(prefillContext?.source);
  const hasInvalidPurchaseQuantity = editor.model.lines.some((line) =>
    Boolean(getPurchaseQuantityUiError(line)),
  );

  async function handleSupplierChange(supplierId: string) {
    try {
      const result = await editor.changeSupplier(supplierId);
      if (result.requiresConfirmation) setPendingSupplierId(supplierId);
    } catch (caughtError) {
      showToast({
        title: "No se pudo cargar el proveedor",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  async function confirmSupplierChange() {
    if (!pendingSupplierId) return;
    try {
      await editor.changeSupplier(pendingSupplierId, true);
      setPendingSupplierId(null);
    } catch (caughtError) {
      showToast({
        title: "No se pudo cambiar el proveedor",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  async function handleSaveDraft() {
    try {
      await editor.saveDraft();
      showToast({
        title: mode === "edit" ? "Borrador actualizado" : "Borrador guardado",
        tone: "success",
      });
      router.push("/compras/ordenes");
    } catch (caughtError) {
      showToast({
        title: "No se pudo guardar",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  async function handleCreateOrder() {
    try {
      await editor.createOrder();
      showToast({
        title: "Orden creada",
        description: "Quedo pendiente de aprobacion.",
        tone: "success",
      });
      router.push("/compras/ordenes");
    } catch (caughtError) {
      showToast({
        title: "No se pudo crear la orden",
        description: caughtError instanceof Error ? caughtError.message : undefined,
        tone: "danger",
      });
    }
  }

  if (editor.loading) {
    return <p className="p-5 text-sm text-[var(--color-text-muted)]">Cargando orden...</p>;
  }

  if (editor.error) {
    return (
      <div className="space-y-4">
        <PageHeader title="Orden de compra" description={editor.error} />
        <Button onClick={() => router.push("/compras/ordenes")} type="button" variant="secondary">
          Volver
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
          Compras
        </p>
        <PageHeader
          title={mode === "edit" ? "Editar borrador" : "Nueva orden de compra"}
          description="Selecciona proveedor, productos asociados, cantidades y costos acordados."
        />
      </div>

      {editor.prefillNotice || editor.prefillWarning ? (
        <p
          className={cn(
            "rounded-md border px-3 py-2 text-sm font-semibold",
            editor.prefillWarning
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-blue-100 bg-blue-50 text-blue-900",
          )}
        >
          {editor.prefillWarning ?? editor.prefillNotice}
        </p>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        <div className="min-w-0 space-y-5">
          <section className="rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
              <label className="block">
                <span className="text-xs font-bold uppercase text-[var(--color-text-muted)]">
                  Proveedor
                </span>
                <Select
                  className="mt-1"
                  onChange={(event) => void handleSupplierChange(event.target.value)}
                  value={editor.model.supplierId}
                >
                  <option value="">Selecciona proveedor</option>
                  {editor.suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </Select>
                {editor.suppliers.length === 0 ? (
                  <p className="mt-1 text-xs font-semibold text-[var(--color-danger)]">
                    No hay proveedores operacionales disponibles.
                  </p>
                ) : null}
              </label>
              <div>
                <span className="text-xs font-bold uppercase text-[var(--color-text-muted)]">
                  Entrega esperada
                </span>
                <p className="mt-1 flex h-10 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 text-sm font-semibold text-[var(--color-title)]">
                  {editor.model.expectedDate
                    ? formatDate(editor.model.expectedDate)
                    : "No definido"}
                </p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {typeof editor.expectedLeadTimeDays === "number"
                    ? `${formatNumber(editor.expectedLeadTimeDays)} dias desde la fecha base`
                    : "Sin lead time configurado"}
                </p>
              </div>
              {editor.selectedSupplier ? <SupplierInfo supplier={editor.selectedSupplier} /> : null}
              <label className="block md:col-span-2">
                <span className="text-xs font-bold uppercase text-[var(--color-text-muted)]">
                  Notas
                </span>
                <textarea
                  className="mt-1 min-h-20 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
                  maxLength={TEXT_LIMITS.notes}
                  onChange={(event) => editor.updateField({ notes: event.target.value })}
                  placeholder="Notas opcionales para compras o recepcion..."
                  value={editor.model.notes}
                />
                <span className="mt-1 block text-right text-xs text-[var(--color-text-muted)]">
                  {editor.model.notes.length} / {TEXT_LIMITS.notes}
                </span>
              </label>
            </div>
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-bold text-[var(--color-title)]">
                  Productos disponibles
                </h2>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Solo productos asociados al proveedor seleccionado.
                </p>
              </div>
              <Input
                className="sm:max-w-xs"
                maxLength={TEXT_LIMITS.search}
                onChange={(event) => editor.setProductSearch(event.target.value)}
                placeholder="Buscar producto, SKU o categoria..."
                type="search"
                value={editor.productSearch}
              />
            </div>
            <div className="mt-3 space-y-2">
              {!editor.model.supplierId ? (
                <EmptyState message="Selecciona un proveedor para ver sus productos." />
              ) : editor.availableProducts.length === 0 ? (
                <EmptyState
                  message={
                    editor.catalogLoading
                      ? "Cargando productos del proveedor..."
                      : "No hay productos disponibles para agregar."
                  }
                />
              ) : (
                editor.availableProducts.map((product) => (
                  <AvailableProductRow
                    key={product.id}
                    product={product}
                    onAdd={() => editor.addProduct(product)}
                  />
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-sm">
            <h2 className="text-base font-bold text-[var(--color-title)]">Productos de la orden</h2>
            <div className="mt-3">
              {editor.model.lines.length === 0 ? (
                <EmptyState message="Agrega productos asociados al proveedor." />
              ) : (
                <>
                  <div className="space-y-3 xl:hidden">
                    {editor.model.lines.map((line) => {
                      const pricing = editor.pricingByLineId.get(line.id);
                      const expectedBase =
                        toFiniteNumber(line.quantity) * line.purchaseToBaseFactor;
                      return (
                        <article
                          className="space-y-3 rounded-lg border border-[var(--color-border)] p-3"
                          key={line.id}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-bold text-[var(--color-title)]">
                                {line.productName}
                              </p>
                              <p className="text-xs text-[var(--color-text-muted)]">
                                SKU {line.sku}
                              </p>
                            </div>
                            <button
                              aria-label={`Quitar ${line.productName}`}
                              className="shrink-0 rounded-md px-2 py-1 font-bold text-[var(--color-danger)]"
                              onClick={() => editor.removeLine(line.id)}
                              type="button"
                            >
                              Quitar
                            </button>
                          </div>
                          <dl className="grid grid-cols-2 gap-2 text-sm">
                            <SmallDescription label="Unidad de compra" value={line.unitLabel} />
                            <SmallDescription
                              label="Equivalencia"
                              value={`1 ${line.unitLabel} = ${formatNumber(line.purchaseToBaseFactor)} unidades base`}
                            />
                          </dl>
                          <label className="block text-sm font-bold text-[var(--color-text)]">
                            Cantidad
                            <Input
                              aria-invalid={Boolean(getPurchaseQuantityUiError(line))}
                              className="mt-1 w-full"
                              inputMode={line.unitAllowsDecimals ? "decimal" : "numeric"}
                              maxLength={line.unitAllowsDecimals ? 12 : 6}
                              type="text"
                              value={line.quantity}
                              onChange={(event) =>
                                editor.updateLineQuantity(
                                  line.id,
                                  parseUnitQuantityInput(
                                    event.target.value,
                                    line.unitAllowsDecimals,
                                  ),
                                )
                              }
                            />
                            {getPurchaseQuantityUiError(line) ? (
                              <span className="mt-1 block text-xs font-semibold text-[var(--color-danger)]">
                                {getPurchaseQuantityUiError(line)}
                              </span>
                            ) : null}
                          </label>
                          <label className="block text-sm font-bold text-[var(--color-text)]">
                            Costo acordado
                            <Input
                              className="mt-1 w-full"
                              inputMode="decimal"
                              maxLength={11}
                              type="text"
                              value={line.agreedCost}
                              onChange={(event) =>
                                editor.updateLineCost(
                                  line.id,
                                  parseDecimalInput(event.target.value, MONEY_DECIMAL_PLACES),
                                )
                              }
                            />
                          </label>
                          <dl className="grid grid-cols-2 gap-2 text-sm">
                            <SmallDescription
                              label="Total esperado"
                              value={`${formatNumber(expectedBase)} unidades base`}
                            />
                            <SmallDescription
                              label="Subtotal"
                              value={formatCurrency(
                                pricing?.subtotal ??
                                  toFiniteNumber(line.quantity) * toFiniteNumber(line.agreedCost),
                              )}
                            />
                          </dl>
                        </article>
                      );
                    })}
                  </div>
                  <div className="hidden overflow-x-auto xl:block">
                    <table className="w-full min-w-[980px] table-fixed border-collapse text-left text-sm">
                      <colgroup>
                        <col className="w-[23%]" />
                        <col className="w-[9%]" />
                        <col className="w-[11%]" />
                        <col className="w-[12%]" />
                        <col className="w-[13%]" />
                        <col className="w-[12%]" />
                        <col className="w-[13%]" />
                        <col className="w-[7%]" />
                      </colgroup>
                      <thead className="border-b border-[var(--color-border)] text-xs uppercase text-[var(--color-text-muted)]">
                        <tr>
                          <th className="py-2 pr-3 font-bold">Producto</th>
                          <th className="px-2 py-2 font-bold">Unidad</th>
                          <th className="px-2 py-2 font-bold">Cantidad</th>
                          <th className="px-2 py-2 text-right font-bold">Precio base</th>
                          <th className="px-2 py-2 font-bold">Precio aplicado</th>
                          <th className="px-2 py-2 text-right font-bold">Ahorro</th>
                          <th className="px-2 py-2 text-right font-bold">Subtotal</th>
                          <th className="py-2 pl-2 text-center font-bold">Accion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editor.model.lines.map((line) => {
                          const pricing = editor.pricingByLineId.get(line.id);
                          return (
                            <tr
                              className="border-b border-[var(--color-border)] last:border-0"
                              key={line.id}
                            >
                              <td className="py-2 pr-3">
                                <ProductInfoTrigger line={line} />
                              </td>
                              <td className="px-2 py-2 font-semibold text-[var(--color-text)]">
                                {line.unitLabel}
                                <span className="mt-1 block text-[11px] font-medium text-[var(--color-text-muted)]">
                                  1 = {formatNumber(line.purchaseToBaseFactor)} base
                                </span>
                              </td>
                              <td className="px-2 py-2">
                                <Input
                                  aria-invalid={Boolean(getPurchaseQuantityUiError(line))}
                                  className="h-9"
                                  inputMode={line.unitAllowsDecimals ? "decimal" : "numeric"}
                                  maxLength={line.unitAllowsDecimals ? 12 : 6}
                                  onChange={(event) =>
                                    editor.updateLineQuantity(
                                      line.id,
                                      parseUnitQuantityInput(
                                        event.target.value,
                                        line.unitAllowsDecimals,
                                      ),
                                    )
                                  }
                                  type="text"
                                  value={line.quantity}
                                />
                                {getPurchaseQuantityUiError(line) ? (
                                  <p className="mt-1 text-[11px] font-semibold text-[var(--color-danger)]">
                                    {getPurchaseQuantityUiError(line)}
                                  </p>
                                ) : null}
                              </td>
                              <td className="px-2 py-2 text-right font-semibold text-[var(--color-text)]">
                                {formatCurrency(line.baseCost)}
                              </td>
                              <td className="px-2 py-2">
                                <Input
                                  className="h-9"
                                  inputMode="decimal"
                                  maxLength={11}
                                  onChange={(event) =>
                                    editor.updateLineCost(
                                      line.id,
                                      parseDecimalInput(event.target.value, MONEY_DECIMAL_PLACES),
                                    )
                                  }
                                  type="text"
                                  value={line.agreedCost}
                                />
                                <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                                  {line.manualCost
                                    ? "Precio acordado manual"
                                    : pricing?.tierLabel
                                      ? `Escala ${pricing.tierLabel}`
                                      : "Precio base"}
                                </p>
                              </td>
                              <td className="px-2 py-2 text-right text-xs font-semibold text-[var(--color-text-muted)]">
                                {pricing && pricing.totalSavings > 0 ? (
                                  <>
                                    <span className="block text-emerald-700">
                                      {formatCurrency(pricing.unitSavings)}/u
                                    </span>
                                    <span>{formatCurrency(pricing.totalSavings)}</span>
                                  </>
                                ) : (
                                  "-"
                                )}
                              </td>
                              <td className="px-2 py-2 text-right font-bold text-[var(--color-title)]">
                                {formatCurrency(
                                  pricing?.subtotal ??
                                    toFiniteNumber(line.quantity) * toFiniteNumber(line.agreedCost),
                                )}
                              </td>
                              <td className="py-2 pl-2 text-center">
                                <button
                                  aria-label={`Quitar ${line.productName}`}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-danger)] transition hover:bg-rose-50"
                                  onClick={() => editor.removeLine(line.id)}
                                  type="button"
                                >
                                  x
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        <aside className="h-fit min-w-0 rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-sm xl:sticky xl:top-5 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto">
          <h2 className="text-base font-bold text-[var(--color-title)]">Resumen</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <SummaryItem label="Sucursal destino" value={editor.branchName} />
            <SummaryItem
              label="Proveedor"
              value={editor.selectedSupplier?.name ?? "Sin proveedor"}
            />
            <SummaryItem label="Productos" value={formatNumber(editor.model.lines.length)} />
            <SummaryItem
              label="Unidades solicitadas"
              value={formatNumber(
                editor.model.lines.reduce((sum, line) => sum + toFiniteNumber(line.quantity), 0),
              )}
            />
            <SummaryItem
              label="Entrega esperada"
              value={
                editor.model.expectedDate ? formatDate(editor.model.expectedDate) : "No definido"
              }
            />
            <SummaryItem
              label="Condicion de pago"
              value={editor.selectedSupplier?.paymentTermsLabel ?? "No definido"}
            />
            <SummaryItem label="Subtotal base" value={formatCurrency(editor.subtotalBase)} />
            <SummaryItem label="Ahorro por escalas" value={formatCurrency(editor.totalSavings)} />
            <SummaryItem label="Total" value={formatCurrency(editor.total)} strong />
          </dl>
          <div className="mt-5 flex flex-col gap-2">
            <Button onClick={() => router.push(returnPath)} type="button" variant="secondary">
              Volver
            </Button>
            <Button
              disabled={editor.saving || !canCreatePurchaseOrders || hasInvalidPurchaseQuantity}
              onClick={handleSaveDraft}
              type="button"
              variant="secondary"
            >
              {mode === "edit" ? "Guardar cambios" : "Guardar borrador"}
            </Button>
            <Button
              disabled={editor.saving || !canCreatePurchaseOrders || hasInvalidPurchaseQuantity}
              onClick={handleCreateOrder}
              type="button"
            >
              Crear orden
            </Button>
          </div>
        </aside>
      </div>

      {pendingSupplierId ? (
        <ConfirmDialog
          confirmLabel="Cambiar proveedor"
          message="Cambiar el proveedor eliminara los productos actuales de la orden."
          title="Cambiar proveedor"
          onCancel={() => setPendingSupplierId(null)}
          onConfirm={confirmSupplierChange}
        />
      ) : null}
    </div>
  );
}

function AvailableProductRow({
  product,
  onAdd,
}: {
  product: PurchaseOrderAvailableProduct;
  onAdd: () => void;
}) {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-md border border-[var(--color-border)] px-3 py-3 xl:grid xl:grid-cols-[minmax(11rem,2fr)_minmax(3rem,.45fr)_minmax(4.5rem,.6fr)_minmax(4rem,.5fr)_minmax(4rem,.5fr)_minmax(5rem,.65fr)_minmax(3rem,.4fr)_7rem] xl:items-center xl:gap-x-3 xl:py-2">
      <div className="min-w-0">
        <p
          className="line-clamp-2 break-words font-bold leading-5 text-[var(--color-title)]"
          title={product.productName}
        >
          {product.productName}
        </p>
        <p className="text-xs text-[var(--color-text-muted)]">
          {product.sku} · Prov. {product.supplierSku}
        </p>
      </div>
      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-3 xl:contents">
        <SmallField label="Unidad" value={product.unitLabel} />
        <SmallField label="Costo" value={formatCurrency(product.configuredCost)} />
        <SmallField label="Minimo" value={formatNumber(product.minimumOrderQuantity)} />
        <SmallField label="Entrega" value={formatLeadTime(product.leadTimeDays)} />
        <SmallField
          label="Stock"
          value={`${formatOptionalNumber(product.stockQuantity)} · ${product.availabilityLabel}`}
        />
        <SmallField
          label="Escalas"
          value={
            product.tiers.length > 0
              ? product.tiers
                  .map((tier) => `${tier.minQuantity}+ ${formatCurrency(tier.unitCost)}`)
                  .join(", ")
              : "-"
          }
        />
      </dl>
      <Button
        className="min-h-10 w-full shrink-0 px-3 py-1.5 md:w-auto xl:w-full"
        onClick={onAdd}
        type="button"
        variant="secondary"
      >
        <PlusIcon />
        Agregar
      </Button>
    </article>
  );
}

function SupplierInfo({ supplier }: { supplier: PurchaseOrderEditorSupplier }) {
  return (
    <section className="md:col-span-2">
      <h2 className="text-xs font-bold uppercase text-[var(--color-text-muted)]">
        Informacion del proveedor
      </h2>
      <dl className="mt-2 grid gap-x-5 gap-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] p-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <SmallDescription label="Nombre comercial" value={supplier.name} />
        <SmallDescription label="Razon social" value={supplier.legalName ?? "No definida"} />
        <SmallDescription label="NIT" value={supplier.taxId ?? "No definido"} />
        <SmallDescription
          label="Contacto principal"
          value={supplier.phone ?? supplier.email ?? "No definido"}
        />
        <SmallDescription label="Telefono" value={supplier.phone ?? "No definido"} />
        <SmallDescription label="Correo" value={supplier.email ?? "No definido"} />
        <SmallDescription label="Condicion de pago" value={supplier.paymentTermsLabel} />
        <SmallDescription label="Moneda" value={supplier.currencyLabel} />
        <SmallDescription label="Plazo de entrega" value={supplier.leadTimeLabel} />
        {supplier.notes ? (
          <SmallDescription
            className="sm:col-span-2 lg:col-span-3"
            label="Observaciones"
            value={supplier.notes}
          />
        ) : null}
      </dl>
    </section>
  );
}

function ProductInfoTrigger({ line }: { line: PurchaseOrderEditorLine }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<ProductPopoverPosition | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearCloseTimer() {
    if (!closeTimerRef.current) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => setOpen(false), 120);
  }

  function updatePosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const anchor = trigger.getBoundingClientRect();
    const width = Math.min(360, Math.max(300, window.innerWidth - 16));
    const height = popoverRef.current?.offsetHeight ?? 280;
    const margin = 8;
    const gap = 10;
    const left = clamp(anchor.left, margin, window.innerWidth - width - margin);
    const aboveTop = anchor.top - height - gap;
    const belowTop = anchor.bottom + gap;
    const placement = aboveTop >= margin ? "top" : "bottom";
    const top =
      placement === "top" ? aboveTop : Math.min(belowTop, window.innerHeight - height - margin);

    setPosition({
      left,
      top: Math.max(margin, top),
      width,
      placement,
    });
  }

  useEffect(() => {
    if (!open) return undefined;

    updatePosition();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    }

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      clearCloseTimer();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) updatePosition();
  }, [line, open]);

  return (
    <div
      ref={triggerRef}
      className="flex min-w-0 items-start gap-2"
      onBlur={() => {
        window.setTimeout(() => {
          const activeElement = document.activeElement;
          if (!activeElement) return;
          if (triggerRef.current?.contains(activeElement)) return;
          if (popoverRef.current?.contains(activeElement)) return;
          setOpen(false);
        }, 0);
      }}
      onFocus={() => setOpen(true)}
      onMouseEnter={() => {
        clearCloseTimer();
        setOpen(true);
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        aria-expanded={open}
        aria-label={`Informacion de ${line.productName}`}
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] text-xs font-bold text-[var(--color-structure)] transition hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
        onClick={(event) => {
          event.stopPropagation();
          clearCloseTimer();
          setOpen((current) => !current);
        }}
        type="button"
      >
        i
      </button>
      <div className="min-w-0">
        <p className="truncate font-bold text-[var(--color-title)]">{line.productName}</p>
        <p className="text-xs text-[var(--color-text-muted)]">
          {line.sku} · Prov. {line.supplierSku}
        </p>
      </div>
      {open && position
        ? createPortal(
            <ProductInfoPopover
              popoverRef={popoverRef}
              line={line}
              placement={position.placement}
              style={{ left: position.left, top: position.top, width: position.width }}
              onMouseEnter={clearCloseTimer}
              onMouseLeave={scheduleClose}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

type ProductPopoverPosition = {
  left: number;
  top: number;
  width: number;
  placement: "top" | "bottom";
};

function ProductInfoPopover({
  line,
  placement,
  style,
  onMouseEnter,
  onMouseLeave,
  popoverRef,
}: {
  line: PurchaseOrderEditorLine;
  placement: ProductPopoverPosition["placement"];
  style: CSSProperties;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  popoverRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={popoverRef}
      className="fixed z-40 rounded-lg border border-violet-200 bg-white p-3 text-left shadow-lg shadow-violet-950/10"
      data-placement={placement}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={style}
    >
      <h3 className="text-sm font-bold leading-5 text-[var(--color-title)]">{line.productName}</h3>
      <p className="mt-0.5 text-xs font-medium text-[var(--color-text-muted)]">
        {line.sku} · Prov. {line.supplierSku}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <SmallDescription
          label="Existencia fisica"
          value={formatOptionalNumber(line.stockQuantity)}
        />
        <SmallDescription label="Reservado" value={formatOptionalNumber(line.reservedQuantity)} />
        <SmallDescription label="Disponible" value={formatOptionalNumber(line.availableQuantity)} />
        <SmallDescription label="Minimo" value={formatOptionalNumber(line.minStock)} />
        <SmallDescription
          label="Reorder point"
          value={
            typeof line.reorderPoint === "number" ? formatNumber(line.reorderPoint) : "No definido"
          }
        />
        <SmallDescription label="Sugerido" value={formatOptionalNumber(line.suggestedReorder)} />
        <SmallDescription label="Faltante" value={formatOptionalNumber(line.shortage)} />
        <SmallDescription label="Unidad" value={line.unitLabel} />
        <SmallDescription label="Minimo compra" value={formatNumber(line.minimumOrderQuantity)} />
        <SmallDescription label="Proveedor SKU" value={line.supplierSku} />
        <SmallDescription label="Costo base" value={formatCurrency(line.baseCost)} />
        <SmallDescription label="Entrega" value={formatLeadTime(line.leadTimeDays)} />
        <SmallDescription
          className="col-span-2"
          label="Disponibilidad"
          value={line.availabilityLabel}
        />
        <SmallDescription
          className="col-span-2"
          label="Escalas"
          value={
            line.tiers.length > 0
              ? line.tiers
                  .map((tier) => `${tier.minQuantity}+ ${formatCurrency(tier.unitCost)}`)
                  .join(", ")
              : "Sin escalas"
          }
        />
      </dl>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-app-background)] px-4 py-3 text-sm font-medium text-[var(--color-text-muted)]">
      {message}
    </p>
  );
}

function SummaryItem({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[var(--color-text-muted)]">{label}</dt>
      <dd className={cn("text-right font-semibold text-[var(--color-title)]", strong && "text-lg")}>
        {value}
      </dd>
    </div>
  );
}

function SmallField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase text-[var(--color-text-muted)]">{label}</p>
      <p className="truncate text-sm font-semibold text-[var(--color-title)]">{value}</p>
    </div>
  );
}

function SmallDescription({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-bold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 break-words font-semibold text-[var(--color-title)]">{value}</dd>
    </div>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-topbar)]/35 p-4">
      <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-xl">
        <h2 className="text-lg font-bold text-[var(--color-title)]">{title}</h2>
        <p className="mt-2 text-sm text-[var(--color-text)]">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="secondary">
            Volver
          </Button>
          <Button onClick={onConfirm} type="button">
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency: "GTQ",
  }).format(Number.isFinite(value) ? value : 0);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("es-GT").format(Number.isFinite(value) ? value : 0);
}

function getPurchaseQuantityUiError(line: PurchaseOrderEditorLine) {
  if (typeof line.quantity !== "number") {
    if (
      line.quantity !== "" &&
      line.unitAllowsDecimals &&
      !hasAtMostDecimalPlaces(line.quantity, QUANTITY_DECIMAL_PLACES)
    ) {
      return "La cantidad admite hasta 3 decimales.";
    }
    if (line.quantity !== "" && !line.unitAllowsDecimals) {
      return "La unidad de compra no admite fracciones.";
    }
    return "Ingresa una cantidad valida.";
  }
  if (!Number.isFinite(line.quantity)) return "Ingresa una cantidad valida.";
  if (line.quantity <= 0) return "La cantidad debe ser mayor que cero.";
  if (line.quantity > MAX_SAFE_INVENTORY_QUANTITY) {
    return "La cantidad no puede superar 999,999.99.";
  }
  if (line.quantity < line.minimumOrderQuantity) {
    return `La cantidad mínima de compra es ${formatNumber(line.minimumOrderQuantity)}.`;
  }
  if (!line.unitAllowsDecimals && !isQuantityCompatibleWithUnit(line.quantity, false)) {
    return "La unidad de compra no admite fracciones.";
  }
  if (line.unitAllowsDecimals && !hasAtMostDecimalPlaces(line.quantity, QUANTITY_DECIMAL_PLACES)) {
    return "La cantidad admite hasta 3 decimales.";
  }
  return null;
}

function formatLeadTime(value?: number) {
  return typeof value === "number" ? `${formatNumber(value)} dias` : "No definido";
}

function formatOptionalNumber(value?: number) {
  return typeof value === "number" ? formatNumber(value) : "No disponible";
}

function getPrefillContext(searchParams: { get: (name: string) => string | null }) {
  const productId = searchParams.get("productId") ?? undefined;
  const branchId = searchParams.get("branchId") ?? undefined;
  const supplierId = searchParams.get("supplierId") ?? undefined;
  const source = getPrefillSource(searchParams.get("source"));
  const suggestedQuantityValue = searchParams.get("suggestedQuantity");
  const suggestedQuantity = getSuggestedQuantityParam(suggestedQuantityValue);
  if (!productId && !branchId && !supplierId && !source && !suggestedQuantity) return undefined;
  return {
    productId,
    branchId,
    supplierId,
    source,
    suggestedQuantity,
    suggestedQuantityInvalid: Boolean(suggestedQuantityValue && !suggestedQuantity),
  } satisfies PurchaseOrderPrefillContext;
}

function getPrefillSource(value: string | null): PurchaseOrderPrefillSource | undefined {
  if (value === "inventory" || value === "inventory-alert" || value === "reorder-suggestion") {
    return value;
  }
  return undefined;
}

function getSuggestedQuantityParam(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) &&
    parsed > 0 &&
    parsed <= MAX_SAFE_INVENTORY_QUANTITY &&
    hasAtMostDecimalPlaces(parsed, QUANTITY_DECIMAL_PLACES)
    ? parsed
    : undefined;
}

function getReturnPath(source?: PurchaseOrderPrefillSource) {
  if (source === "inventory" || source === "inventory-alert") return "/inventario/alertas";
  return "/compras/ordenes";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000`));
}

function Icon({ children, className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      className={cn("h-4 w-4", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      {...props}
    >
      {children}
    </svg>
  );
}

function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}
