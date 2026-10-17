"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Product, Promotion } from "@/core/entities";
import { ProductStatus, PromotionStatus, PromotionType, SalesChannel } from "@/core/enums";
import { calculateEffectivePrice } from "@/core/pricing";
import { Button } from "@/shared/components/Button";
import { Modal } from "@/shared/components/Modal";
import { useToast } from "@/shared/components/Toast";
import { formatCurrency } from "@/shared/utils/formatCurrency";
import { cn } from "@/shared/utils/cn";
import {
  MAX_PERCENTAGE,
  MAX_SAFE_CURRENCY,
  MONEY_DECIMAL_PLACES,
  PERCENTAGE_DECIMAL_PLACES,
} from "@/shared/utils/inputLimits";
import { hasAtMostDecimalPlaces, isDecimalInputText } from "@/shared/utils/numberInput";
import {
  CheckIcon,
  GlobeIcon,
  MobileIcon,
  PosIcon,
  TagIcon,
} from "@/modules/catalog/components/CatalogIcons";
import type { ProductListItem } from "@/modules/catalog/types/catalog.types";
import { useProductPromotions } from "@/modules/catalog/hooks/useProductPromotions";

interface ProductPromotionDialogProps {
  product: ProductListItem | null;
  onClose: () => void;
}

interface PromotionFormState {
  type: PromotionType;
  value: string;
  startDate: string;
  endDate: string;
  channels: SalesChannel[];
  untilStockEnds: boolean;
}

type PromotionProduct = Pick<
  Product,
  "id" | "tenantId" | "name" | "salePrice" | "tracking" | "channels"
>;

const promotionTypeLabels: Record<PromotionType, string> = {
  [PromotionType.percentage]: "Descuento porcentual",
  [PromotionType.fixedDiscount]: "Descuento fijo",
  [PromotionType.fixedPrice]: "Precio promocional",
};

const promotionStatusLabels: Record<PromotionStatus, string> = {
  [PromotionStatus.scheduled]: "Programada",
  [PromotionStatus.active]: "Activa",
  [PromotionStatus.ended]: "Finalizada",
  [PromotionStatus.cancelled]: "Cancelada",
};

export function ProductPromotionDialog({ product, onClose }: ProductPromotionDialogProps) {
  const { showToast } = useToast();
  const { data, error, finalize, loading, save } = useProductPromotions(product?.id ?? null);
  const [mode, setMode] = useState<"view" | "form">("view");
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const promotions = data?.promotions ?? [];
  const currentProduct = data?.product ?? product;
  const productArchived = currentProduct?.status === ProductStatus.archived;
  const form = !productArchived && (mode === "form" || (!loading && promotions.length === 0));

  async function handleSave(state: PromotionFormState) {
    if (!currentProduct) return;
    const validationError = validatePromotionForm(state, currentProduct.salePrice);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      await save({
        promotionId: editingPromotion?.id,
        productId: currentProduct.id,
        tenantId: currentProduct.tenantId,
        productName: currentProduct.name,
        type: state.type,
        value: Number(state.value),
        startAt: toIsoStart(state.startDate),
        endAt: state.endDate ? toIsoEnd(state.endDate) : undefined,
        channels: state.channels,
        untilStockEnds: state.untilStockEnds && currentProduct.tracking.stock,
      });
      showToast({
        title: editingPromotion ? "Promoción actualizada" : "Promoción creada",
        tone: "success",
      });
      setMode("view");
      setEditingPromotion(null);
    } catch (caughtError) {
      setFormError(caughtError instanceof Error ? caughtError.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function handleFinalize(promotion: Promotion) {
    setBusy(true);
    setFormError(null);
    try {
      await finalize(promotion.id);
      showToast({ title: "Promoción finalizada", tone: "success" });
    } catch (caughtError) {
      setFormError(caughtError instanceof Error ? caughtError.message : "No se pudo finalizar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(product)}
      maxWidth="960px"
      size="lg"
      subtitle={currentProduct?.name}
      title={form ? (editingPromotion ? "Editar promoción" : "Crear promoción") : "Promoción"}
      onClose={onClose}
      footer={
        form && currentProduct ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              onClick={() => {
                setMode(promotions.length ? "view" : "form");
                setEditingPromotion(null);
                setFormError(null);
              }}
              type="button"
              variant="secondary"
            >
              Cancelar
            </Button>
            <Button disabled={busy} form="product-promotion-form" type="submit">
              <TagIcon />
              {busy ? "Guardando..." : "Guardar promoción"}
            </Button>
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Cargando promociones...</p>
      ) : error ? (
        <p className="rounded-md border border-[var(--color-danger)] p-3 text-sm font-medium text-[var(--color-danger)]">
          {error}
        </p>
      ) : !currentProduct ? (
        <p className="text-sm text-[var(--color-text-muted)]">Producto no disponible.</p>
      ) : form ? (
        <PromotionForm
          error={formError}
          initialPromotion={editingPromotion}
          product={currentProduct}
          onSubmit={handleSave}
        />
      ) : (
        <PromotionOverview
          busy={busy}
          error={formError}
          product={currentProduct}
          promotions={promotions}
          onCreate={() => {
            setEditingPromotion(null);
            setFormError(null);
            setMode("form");
          }}
          onEdit={(promotion) => {
            setEditingPromotion(promotion);
            setFormError(null);
            setMode("form");
          }}
          onFinalize={handleFinalize}
          readOnly={productArchived}
        />
      )}
    </Modal>
  );
}

function PromotionOverview({
  busy,
  error,
  product,
  promotions,
  onCreate,
  onEdit,
  onFinalize,
  readOnly,
}: {
  busy: boolean;
  error: string | null;
  product: PromotionProduct;
  promotions: Promotion[];
  onCreate: () => void;
  onEdit: (promotion: Promotion) => void;
  onFinalize: (promotion: Promotion) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-4">
      {error ? (
        <p className="rounded-md border border-[var(--color-danger)] p-3 text-sm font-medium text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
      {readOnly ? (
        <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] p-3 text-sm font-semibold text-[var(--color-text)]">
          Restaura el producto para gestionar promociones.
        </p>
      ) : (
        <div className="flex justify-end">
          <Button
            className="w-full min-h-10 px-3 py-2 sm:w-auto"
            onClick={onCreate}
            type="button"
            variant="secondary"
          >
            <TagIcon />
            Nueva promoción
          </Button>
        </div>
      )}
      <div className="space-y-3">
        {promotions.map((promotion) => {
          const price = calculateEffectivePrice(product.salePrice, promotion);
          return (
            <article
              className="rounded-xl border border-[var(--color-border)] bg-white p-4"
              key={promotion.id}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="font-bold text-[var(--color-title)]">{promotion.name}</h3>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    {promotionTypeLabels[promotion.type]} · {formatPromotionValue(promotion)}
                  </p>
                </div>
                <StatusPill status={promotion.status} />
              </div>
              <div className="mt-4 grid gap-3 rounded-lg bg-[var(--color-app-background)] p-3 md:grid-cols-3">
                <Metric label="Precio regular" value={formatCurrency(price.basePrice)} />
                <Metric label="Precio promocional" value={formatCurrency(price.effectivePrice)} />
                <Metric label="Descuento" value={formatCurrency(price.discountAmount)} />
              </div>
              <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                <Detail label="Inicio" value={formatDate(promotion.startAt)} />
                <Detail
                  label="Fin"
                  value={promotion.endAt ? formatDate(promotion.endAt) : "Sin fecha final"}
                />
                <Detail
                  label="Canales"
                  value={<PromotionChannels channels={promotion.channels} />}
                />
                <Detail
                  label="Inventario"
                  value={
                    promotion.untilStockEnds ? "Hasta agotar existencias" : "Sin límite de stock"
                  }
                />
              </dl>
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                {readOnly ? null : (
                  <Button
                    className="min-h-10 px-3 py-2"
                    onClick={() => onEdit(promotion)}
                    type="button"
                    variant="secondary"
                  >
                    Editar
                  </Button>
                )}
                {!readOnly && promotion.status !== PromotionStatus.ended ? (
                  <Button
                    className="min-h-10 px-3 py-2"
                    disabled={busy}
                    onClick={() => onFinalize(promotion)}
                    type="button"
                    variant="danger"
                  >
                    Finalizar promoción
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function PromotionForm({
  error,
  initialPromotion,
  product,
  onSubmit,
}: {
  error: string | null;
  initialPromotion: Promotion | null;
  product: PromotionProduct;
  onSubmit: (state: PromotionFormState) => void;
}) {
  const [state, setState] = useState<PromotionFormState>(() =>
    initialPromotion ? formFromPromotion(initialPromotion) : defaultPromotionForm(product),
  );
  const [nowTimestamp] = useState(Date.now);
  const preview = useMemo(
    () =>
      calculateEffectivePrice(
        product.salePrice,
        Number(state.value) > 0
          ? { id: initialPromotion?.id ?? "preview", type: state.type, value: Number(state.value) }
          : null,
      ),
    [initialPromotion?.id, product.salePrice, state.type, state.value],
  );

  function update(patch: Partial<PromotionFormState>) {
    setState((current) => ({ ...current, ...patch }));
  }

  function toggleChannel(channel: SalesChannel) {
    update({
      channels: state.channels.includes(channel)
        ? state.channels.filter((item) => item !== channel)
        : [...state.channels, channel],
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(state);
  }

  return (
    <form className="space-y-4" id="product-promotion-form" onSubmit={submit}>
      <div className="grid gap-3 rounded-lg bg-[var(--color-app-background)] p-3 md:grid-cols-3">
        <Metric label="Precio regular" value={formatCurrency(preview.basePrice)} />
        <Metric label="Precio promocional" value={formatCurrency(preview.effectivePrice)} />
        <Metric
          label="Estado"
          value={
            new Date(toIsoStart(state.startDate)).getTime() > nowTimestamp ? "Programada" : "Activa"
          }
        />
      </div>
      <label className="block space-y-2 text-sm font-semibold text-[var(--color-text)]">
        Tipo
        <select
          className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-text)] outline-none transition hover:border-[var(--color-structure)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
          onChange={(event) => update({ type: event.target.value as PromotionType })}
          value={state.type}
        >
          <option value={PromotionType.percentage}>Descuento porcentual</option>
          <option value={PromotionType.fixedDiscount}>Descuento fijo</option>
          <option value={PromotionType.fixedPrice}>Precio promocional</option>
        </select>
      </label>
      <label className="block space-y-2 text-sm font-semibold text-[var(--color-text)]">
        Valor
        <input
          className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-text)] outline-none transition hover:border-[var(--color-structure)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
          inputMode="decimal"
          maxLength={11}
          onChange={(event) => {
            if (isDecimalInputText(event.target.value)) update({ value: event.target.value });
          }}
          type="text"
          value={state.value}
        />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block space-y-2 text-sm font-semibold text-[var(--color-text)]">
          Fecha inicio
          <input
            className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-text)] outline-none transition hover:border-[var(--color-structure)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
            onChange={(event) => update({ startDate: event.target.value })}
            type="date"
            value={state.startDate}
          />
        </label>
        <label className="block space-y-2 text-sm font-semibold text-[var(--color-text)]">
          Fecha final
          <input
            className="h-10 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 text-sm text-[var(--color-text)] outline-none transition hover:border-[var(--color-structure)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
            onChange={(event) => update({ endDate: event.target.value })}
            type="date"
            value={state.endDate}
          />
        </label>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold text-[var(--color-text)]">Canales</p>
        <div className="flex flex-wrap gap-2">
          <ChannelButton
            active={state.channels.includes(SalesChannel.pos)}
            onClick={() => toggleChannel(SalesChannel.pos)}
          >
            <PosIcon />
            POS
          </ChannelButton>
          <ChannelButton
            active={state.channels.includes(SalesChannel.ecommerce)}
            onClick={() => toggleChannel(SalesChannel.ecommerce)}
          >
            <GlobeIcon />
            Web
          </ChannelButton>
          <ChannelButton
            active={state.channels.includes(SalesChannel.mobileApp)}
            onClick={() => toggleChannel(SalesChannel.mobileApp)}
          >
            <MobileIcon />
            App
          </ChannelButton>
        </div>
      </div>
      <label
        className={cn(
          "flex items-center gap-3 rounded-lg border border-[var(--color-border)] p-3 text-sm font-semibold",
          product.tracking.stock ? "text-[var(--color-text)]" : "text-[var(--color-text-muted)]",
        )}
      >
        <input
          checked={state.untilStockEnds}
          className="h-4 w-4 accent-[var(--color-structure)]"
          disabled={!product.tracking.stock}
          onChange={(event) => update({ untilStockEnds: event.target.checked })}
          type="checkbox"
        />
        Hasta agotar existencias
      </label>
      {error ? (
        <p className="rounded-md border border-[var(--color-danger)] p-3 text-sm font-medium text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function ChannelButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-10 items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]",
        active
          ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-title)]"
          : "border-[var(--color-border)] bg-white text-[var(--color-text-muted)] hover:border-[var(--color-structure)] hover:text-[var(--color-title)]",
      )}
      onClick={onClick}
      type="button"
    >
      {active ? <CheckIcon /> : null}
      {children}
    </button>
  );
}

function PromotionChannels({ channels }: { channels: SalesChannel[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {channels.includes(SalesChannel.pos) ? <MiniChannel icon={<PosIcon />} label="POS" /> : null}
      {channels.includes(SalesChannel.ecommerce) ? (
        <MiniChannel icon={<GlobeIcon />} label="Web" />
      ) : null}
      {channels.includes(SalesChannel.mobileApp) ? (
        <MiniChannel icon={<MobileIcon />} label="App" />
      ) : null}
    </div>
  );
}

function MiniChannel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-primary)] bg-[var(--color-primary)]/10 px-2 py-1 text-xs font-semibold text-[var(--color-title)]">
      {icon}
      {label}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-base font-bold text-[var(--color-title)]">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 font-semibold text-[var(--color-text)]">{value}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: PromotionStatus }) {
  return (
    <span className="inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-1 text-xs font-bold text-[var(--color-title)]">
      {promotionStatusLabels[status]}
    </span>
  );
}

function defaultPromotionForm(product: PromotionProduct): PromotionFormState {
  return {
    type: PromotionType.percentage,
    value: "10",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    channels: enabledProductChannels(product),
    untilStockEnds: product.tracking.stock,
  };
}

function formFromPromotion(promotion: Promotion): PromotionFormState {
  return {
    type: promotion.type,
    value: String(promotion.value),
    startDate: promotion.startAt.slice(0, 10),
    endDate: promotion.endAt?.slice(0, 10) ?? "",
    channels: promotion.channels,
    untilStockEnds: promotion.untilStockEnds,
  };
}

function enabledProductChannels(product: PromotionProduct): SalesChannel[] {
  return [
    product.channels.pos ? SalesChannel.pos : null,
    product.channels.ecommerce ? SalesChannel.ecommerce : null,
    product.channels.mobileApp ? SalesChannel.mobileApp : null,
  ].filter((channel): channel is SalesChannel => Boolean(channel));
}

function validatePromotionForm(state: PromotionFormState, salePrice: number) {
  const value = Number(state.value);
  if (!Number.isFinite(value) || value <= 0) return "Ingresa un valor mayor a 0.";
  const maximumDecimalPlaces =
    state.type === PromotionType.percentage
      ? PERCENTAGE_DECIMAL_PLACES
      : MONEY_DECIMAL_PLACES;
  if (!hasAtMostDecimalPlaces(state.value, maximumDecimalPlaces)) {
    return `El valor admite hasta ${maximumDecimalPlaces} decimales.`;
  }
  if (state.type === PromotionType.percentage && value > MAX_PERCENTAGE) {
    return "El porcentaje no puede superar 100.";
  }
  if (state.type !== PromotionType.percentage && value > MAX_SAFE_CURRENCY) {
    return "El valor no puede superar Q9,999,999.99.";
  }
  if (
    (state.type === PromotionType.fixedDiscount || state.type === PromotionType.fixedPrice) &&
    value >= salePrice
  ) {
    return "El valor debe ser menor al precio regular.";
  }
  if (!state.startDate) return "Selecciona una fecha de inicio.";
  if (state.endDate && state.endDate < state.startDate) {
    return "La fecha final no puede ser anterior a la fecha de inicio.";
  }
  if (state.channels.length === 0) return "Selecciona al menos un canal.";
  return null;
}

function toIsoStart(date: string) {
  return `${date}T00:00:00.000Z`;
}

function toIsoEnd(date: string) {
  return `${date}T23:59:59.999Z`;
}

function formatPromotionValue(promotion: Promotion) {
  if (promotion.type === PromotionType.percentage) return `${promotion.value}%`;
  return formatCurrency(promotion.value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-GT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}
