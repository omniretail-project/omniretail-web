"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { RegularizationErrorInfo } from "@/modules/inventory/application/dto/InventoryRegularizationDto";
import { describeRegularizationFailure } from "@/modules/inventory/application/services/inventoryRegularizationMessages";
import {
  DiagnosticDetail,
  InventoryRegularizationPreview,
  InventoryRegularizationResult,
} from "@/modules/inventory/components/InventoryRegularizationPreview";
import { useInventoryRegularization } from "@/modules/inventory/hooks/useInventoryRegularization";
import { REGULARIZATION_REASON_MAX } from "@/modules/inventory/validation/inventoryRegularization.validation";
import { Button } from "@/shared/components/Button";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { FormField } from "@/shared/components/FormField";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { Select } from "@/shared/components/Select";
import { formatNumber } from "@/shared/utils/formatNumber";

/** Misma superficie que los paneles del historial de movimientos y de las demas pantallas admin. */
const PANEL_CLASS =
  "max-w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm";

function Panel({
  step,
  title,
  description,
  actions,
  children,
}: {
  step: number;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const headingId = `regularization-step-${step}`;
  return (
    <section aria-labelledby={headingId} className={PANEL_CLASS}>
      <header className="flex min-w-0 flex-col gap-3 border-b border-[var(--color-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-structure)] text-xs font-bold text-white"
          >
            {step}
          </span>
          <div className="min-w-0">
            <h2 className="break-words text-base font-bold text-[var(--color-title)]" id={headingId}>
              {title}
            </h2>
            {description ? (
              <p className="text-xs text-[var(--color-text-muted)]">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </header>
      <div className="min-w-0 space-y-4 p-4 sm:p-5">{children}</div>
    </section>
  );
}

function LoadingLine({ text }: { text: string }) {
  return (
    <p
      aria-live="polite"
      className="flex items-center gap-3 text-sm text-[var(--color-text-muted)]"
      role="status"
    >
      <span
        aria-hidden="true"
        className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-structure)]"
      />
      {text}
    </p>
  );
}

function ErrorAlert({
  error,
  context,
  tone = "danger",
}: {
  error: RegularizationErrorInfo & { kind?: "uncertain" | "definitive" };
  context: "load" | "execute";
  tone?: "danger" | "warning";
}) {
  const message = describeRegularizationFailure(error, context);
  return (
    <InlineAlert description={message.hint} title={message.title} tone={tone}>
      <DiagnosticDetail code={message.diagnosticCode} />
    </InlineAlert>
  );
}

export function InventoryRegularizationPage() {
  const regularization = useInventoryRegularization();
  const {
    apiMode,
    canPreview,
    canExecute,
    canAssign,
    branches,
    branchId,
    locked,
    search,
    product,
    destination,
    assignMode,
    selectedLocationId,
    preview,
    reason,
    execution,
    gate,
    canSubmit,
  } = regularization;
  const [term, setTerm] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    void regularization.searchProducts(term);
  }

  const previewData = preview?.data ?? null;
  const assignedDestination = destination?.data?.kind === "assigned" ? destination.data : null;
  const locationLabel = assignedDestination
    ? `${assignedDestination.locationCode} · ${assignedDestination.locationName}`
    : undefined;
  const unassignedDestination =
    destination?.data?.kind === "unassigned" ? destination.data : null;
  const chosenOption = unassignedDestination?.assignableLocations.find(
    (option) => option.id === selectedLocationId,
  );
  const chosenLabel = chosenOption
    ? `${chosenOption.code} · ${chosenOption.name}`
    : (previewData?.locationName ?? "");
  const confirmMessage = previewData
    ? assignMode
      ? `Se asignará ${chosenLabel} como ubicación de inventario de ${previewData.productName} (${previewData.sku}) y se moverán ${formatNumber(
          previewData.sourceQuantity,
        )} unidades (${formatNumber(
          previewData.sourceReservedQuantity,
        )} reservadas) desde el saldo sin ubicación hacia ella. Las existencias totales no cambian y la operación queda en el historial de inventario.`
      : `Se moverán ${formatNumber(previewData.sourceQuantity)} unidades (${formatNumber(
          previewData.sourceReservedQuantity,
        )} reservadas) de ${previewData.productName} (${previewData.sku}) desde el saldo sin ubicación hacia ${
          locationLabel ?? previewData.locationName
        }. Las existencias totales no cambian y el movimiento queda en el historial de inventario.`
    : "";
  const searching = search?.status === "loading";

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-5">
      <header className="flex min-w-0 flex-col gap-4 border-b border-[var(--color-border)] pb-4">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
            Inventario &gt; Regularización
          </p>
          <h1 className="mt-1 break-words text-2xl font-bold text-[var(--color-title)]">
            Regularización de ubicaciones
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--color-text-muted)]">
            Mueve el saldo heredado sin ubicación de un producto a su ubicación de inventario
            asignada. Las existencias totales no cambian.
          </p>
        </div>
      </header>

      {!apiMode ? (
        <InlineAlert
          description={regularization.apiOnlyMessage}
          title="Esta función no está disponible en modo local"
          tone="info"
        />
      ) : null}
      {apiMode && !canPreview ? (
        <InlineAlert
          description="Solicita a un administrador el permiso para consultar inventario."
          title="No tienes acceso a esta operación."
        />
      ) : null}

      {apiMode && canPreview ? (
        <>
          {locked ? (
            <InlineAlert
              description={
                execution.phase === "uncertain"
                  ? "No se puede cambiar de producto ni de sucursal hasta resolver el resultado pendiente. No cierres esta pantalla."
                  : "Hay una solicitud en curso. No cierres esta pantalla."
              }
              title="Hay una regularización en curso"
              tone="warning"
            />
          ) : null}

          <Panel
            description="Elige la sucursal y busca el producto con saldo heredado."
            step={1}
            title="Sucursal y producto"
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)] lg:items-end">
              <FormField id="regularization-branch" label="Sucursal">
                <Select
                  disabled={locked || branches.length === 0}
                  id="regularization-branch"
                  onChange={(event) => regularization.selectBranch(event.target.value)}
                  value={branchId}
                >
                  {branchId === "" ? <option value="">Selecciona una sucursal</option> : null}
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </Select>
              </FormField>

              <form onSubmit={handleSearch}>
                <FormField
                  hint="Solo productos físicos con control de inventario."
                  id="regularization-search"
                  label="Buscar producto"
                >
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      disabled={locked || !branchId}
                      id="regularization-search"
                      onChange={(event) => setTerm(event.target.value)}
                      placeholder="Nombre o SKU"
                      type="search"
                      value={term}
                    />
                    <Button
                      className="min-h-10 w-full px-4 py-2 sm:w-auto"
                      disabled={locked || !branchId || searching}
                      type="submit"
                      variant="secondary"
                    >
                      {searching ? "Buscando..." : "Buscar"}
                    </Button>
                  </div>
                </FormField>
              </form>
            </div>

            {product ? (
              <div className="flex min-w-0 flex-col gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                <p className="min-w-0 break-words">
                  <span className="font-semibold text-[var(--color-title)]">{product.name}</span>{" "}
                  <span className="text-[var(--color-text-muted)]">· {product.sku}</span>
                </p>
                <Button
                  className="min-h-10 w-full px-4 py-2 sm:w-auto"
                  disabled={locked}
                  onClick={regularization.clearProduct}
                  type="button"
                  variant="ghost"
                >
                  Cambiar producto
                </Button>
              </div>
            ) : search ? (
              <div className="space-y-2">
                {search.status === "loading" ? <LoadingLine text="Buscando productos..." /> : null}
                {search.status === "error" && search.error ? (
                  <ErrorAlert context="load" error={search.error} />
                ) : null}
                {search.status === "ready" && search.items.length === 0 ? (
                  <p className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-sm text-[var(--color-text-muted)]">
                    No encontramos productos físicos con control de inventario para esta búsqueda.
                  </p>
                ) : null}
                {search.status === "ready" && search.items.length > 0 ? (
                  <ul className="max-h-72 divide-y divide-[var(--color-border)] overflow-y-auto rounded-md border border-[var(--color-border)]">
                    {search.items.map((option) => (
                      <li key={option.id}>
                        <button
                          className="flex w-full min-w-0 flex-col gap-1 px-3 py-2 text-left text-sm hover:bg-[var(--color-app-background)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-structure)] disabled:cursor-not-allowed disabled:opacity-60 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                          disabled={locked}
                          onClick={() => regularization.selectProduct(option)}
                          type="button"
                        >
                          <span className="min-w-0 break-words font-semibold text-[var(--color-title)]">
                            {option.name}
                          </span>
                          <span className="shrink-0 text-[var(--color-text-muted)]">
                            {option.sku}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-[var(--color-border)] px-3 py-4 text-center text-sm text-[var(--color-text-muted)]">
                Busca un producto para consultar su saldo heredado.
              </p>
            )}
          </Panel>

          {product ? (
            <Panel
              actions={
                <Button
                  className="min-h-10 w-full px-4 py-2 sm:w-auto"
                  disabled={
                    locked || preview?.status === "loading" || destination?.status === "loading"
                  }
                  onClick={() => void regularization.refreshPreview()}
                  type="button"
                  variant="secondary"
                >
                  Actualizar vista previa
                </Button>
              }
              description="Revisa de dónde sale el saldo y cómo quedará la ubicación."
              step={2}
              title="Vista previa"
            >
              {destination?.status === "loading" ? (
                <LoadingLine text="Consultando la ubicación de inventario del producto..." />
              ) : null}
              {destination?.status === "error" && destination.error ? (
                <ErrorAlert context="load" error={destination.error} />
              ) : null}
              {destination?.data?.kind === "locations_disabled" ? (
                <InlineAlert
                  description="Activa el control de ubicaciones en la configuración del negocio para poder regularizar."
                  title="El control de ubicaciones está desactivado en este negocio."
                  tone="warning"
                />
              ) : null}
              {assignedDestination ? (
                <p className="text-sm text-[var(--color-text-muted)]">
                  Ubicación asignada:{" "}
                  <span className="font-semibold text-[var(--color-title)]">{locationLabel}</span>.
                  Una ubicación ya asignada no se cambia desde aquí; para moverla usa un traslado.
                </p>
              ) : null}
              {unassignedDestination ? (
                <div className="space-y-3">
                  {unassignedDestination.assignableLocations.length === 0 ? (
                    <InlineAlert
                      description="Crea o activa una ubicación desde Catálogo y precios; después vuelve a consultar."
                      title="No hay ubicaciones activas disponibles en esta sucursal."
                      tone="warning"
                    />
                  ) : (
                    <>
                      <InlineAlert
                        description="Elige una ubicación: al confirmar se asignará al producto y se consolidará su inventario existente en una sola operación."
                        title="Este producto todavía no tiene una ubicación de inventario asignada."
                        tone="info"
                      />
                      <FormField id="regularization-location" label="Ubicación que se asignará">
                        <Select
                          disabled={locked}
                          id="regularization-location"
                          onChange={(event) => regularization.selectLocation(event.target.value)}
                          value={selectedLocationId ?? ""}
                        >
                          <option value="">Selecciona una ubicación</option>
                          {unassignedDestination.assignableLocations.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.code} · {option.name}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      {!canAssign ? (
                        <InlineAlert
                          description="Puedes consultar la vista previa, pero necesitas poder registrar ajustes de inventario y actualizar productos para confirmar."
                          title="No tienes permisos para asignar ubicaciones."
                          tone="warning"
                        />
                      ) : null}
                    </>
                  )}
                </div>
              ) : null}
              {destination?.data?.kind === "unavailable" ? (
                <InlineAlert
                  description="Revisa la configuración del producto en Catálogo y precios."
                  title="No se encontró la ubicación asignada entre las ubicaciones de la sucursal."
                  tone="warning"
                />
              ) : null}
              {assignedDestination && !assignedDestination.active ? (
                <InlineAlert
                  description="El sistema indicará si esto impide la regularización."
                  title={`La ubicación ${assignedDestination.locationName} está inactiva.`}
                  tone="warning"
                />
              ) : null}

              {preview?.status === "loading" ? <LoadingLine text="Calculando la vista previa..." /> : null}
              {preview?.status === "error" && preview.error ? (
                <ErrorAlert context="load" error={preview.error} />
              ) : null}
              {preview?.status === "idle" && preview.stale && !previewData ? (
                <InlineAlert
                  description="Usa «Actualizar vista previa» para continuar."
                  title="El inventario cambió desde la última consulta."
                  tone="info"
                />
              ) : null}
              {previewData && assignMode ? (
                previewData.assignmentRequired && !previewData.assignmentAllowed ? (
                  <InlineAlert
                    description="Revisa tus permisos o las condiciones del inventario indicadas abajo."
                    title="No es posible asignar esta ubicación al producto en este momento."
                    tone="warning"
                  />
                ) : (
                  <InlineAlert
                    description="Al confirmar, la ubicación elegida quedará asignada al producto y el inventario existente se consolidará en ella."
                    title={`Se asignará ${chosenLabel} como ubicación de inventario.`}
                    tone="info"
                  />
                )
              ) : null}
              {previewData ? (
                <InventoryRegularizationPreview
                  locationLabel={assignMode ? chosenLabel : locationLabel}
                  preview={previewData}
                />
              ) : null}
              {previewData && preview?.stale ? (
                <InlineAlert
                  description="Actualiza la vista previa antes de intentarlo de nuevo."
                  title="Las cantidades mostradas ya no están vigentes."
                  tone="warning"
                />
              ) : null}
            </Panel>
          ) : null}

          {product && previewData ? (
            <Panel
              description="Indica por qué se regulariza y confirma."
              step={3}
              title="Motivo y confirmación"
            >
              <FormField
                hint={`${reason.trim().length}/${REGULARIZATION_REASON_MAX} caracteres`}
                id="regularization-reason"
                label="Motivo"
              >
                <textarea
                  className="min-h-24 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={locked || !canExecute}
                  id="regularization-reason"
                  maxLength={REGULARIZATION_REASON_MAX + 50}
                  onChange={(event) => regularization.setReason(event.target.value)}
                  placeholder="Ej.: Saldo anterior a la configuración de ubicaciones"
                  value={reason}
                />
              </FormField>

              {!canSubmit && gate.blockedBy && execution.phase !== "uncertain" ? (
                <p className="text-sm text-[var(--color-text-muted)]">{gate.blockedBy}</p>
              ) : null}

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  className="w-full sm:w-auto"
                  disabled={!canSubmit}
                  onClick={() => setConfirmOpen(true)}
                  type="button"
                >
                  Regularizar ubicación
                </Button>
              </div>
            </Panel>
          ) : null}

          {execution.phase === "executing" ? (
            <div className={`${PANEL_CLASS} p-4 sm:p-5`}>
              <LoadingLine text="Enviando la regularización. No cierres esta pantalla..." />
            </div>
          ) : null}

          {execution.phase === "uncertain" ? (
            <section className={`${PANEL_CLASS} space-y-4 p-4 sm:p-5`}>
              {execution.recovered ? (
                <InlineAlert
                  description="Quedó pendiente al salir de esta pantalla. No se envió nada de forma automática."
                  title="Recuperamos una regularización con resultado pendiente."
                  tone="info"
                />
              ) : null}
              <p className="break-words text-sm text-[var(--color-text)]">
                <span className="font-semibold text-[var(--color-title)]">
                  {execution.summary.productName}
                </span>{" "}
                <span className="text-[var(--color-text-muted)]">
                  · {execution.summary.sku} → {execution.summary.locationName}
                </span>
              </p>
              <ErrorAlert context="execute" error={execution.failure} tone="warning" />
              {execution.retryFailure ? (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-[var(--color-title)]">
                    No se pudo reintentar la solicitud ahora. El intento enviado antes se conserva.
                  </p>
                  <ErrorAlert context="execute" error={execution.retryFailure} tone="warning" />
                </div>
              ) : null}
              <DiagnosticDetail
                code={execution.request.idempotencyKey.slice(0, 8)}
                label="Referencia de la solicitud"
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  className="w-full sm:w-auto"
                  disabled={!canExecute}
                  onClick={() => void regularization.retryUncertain()}
                  type="button"
                >
                  Reintentar la misma solicitud
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => setDiscardOpen(true)}
                  type="button"
                  variant="secondary"
                >
                  Descartar este intento
                </Button>
              </div>
            </section>
          ) : null}

          {execution.phase === "failed" ? (
            <div className="space-y-3">
              <ErrorAlert context="execute" error={execution.failure} />
              {product ? (
                <Button
                  className="w-full sm:w-auto"
                  onClick={() => void regularization.refreshPreview()}
                  type="button"
                  variant="secondary"
                >
                  Actualizar vista previa
                </Button>
              ) : null}
            </div>
          ) : null}

          {execution.phase === "succeeded" ? (
            <section className={`${PANEL_CLASS} space-y-4 p-4 sm:p-5`}>
              <InventoryRegularizationResult
                locationName={execution.summary.locationName}
                productName={execution.summary.productName}
                result={execution.result}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                {product ? (
                  <Button
                    className="w-full sm:w-auto"
                    onClick={() => void regularization.refreshPreview()}
                    type="button"
                    variant="secondary"
                  >
                    Actualizar vista previa
                  </Button>
                ) : null}
                <Button
                  className="w-full sm:w-auto"
                  onClick={regularization.dismissResult}
                  type="button"
                  variant="ghost"
                >
                  Cerrar resultado
                </Button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        confirmLabel="Regularizar"
        message={confirmMessage}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void regularization.submit();
        }}
        open={confirmOpen}
        title="¿Regularizar la ubicación de este producto?"
      />
      <ConfirmDialog
        confirmLabel="Descartar intento"
        message="No sabemos si esta regularización se aplicó. Si descartas el intento, deberás consultar una vista previa nueva y revisar el historial de movimientos antes de intentarlo otra vez. ¿Descartarlo de todos modos?"
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          regularization.discardUncertain();
        }}
        open={discardOpen}
        title="Descartar el intento pendiente"
      />
    </div>
  );
}
