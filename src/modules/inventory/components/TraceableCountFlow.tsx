"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CountSerialItem,
  InventoryCountSnapshot,
  ReconcileCountInput,
} from "@/core/repositories";
import {
  EXPIRATION_BEFORE_ENTRY_MESSAGE,
  getLocalCalendarDate,
  isExpirationBeforeOperationDate,
} from "@/core/inventory/expirationDate";
import { Button } from "@/shared/components/Button";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { useSerialBatchPrecheck } from "@/shared/hooks/useSerialBatchPrecheck";
import { cn } from "@/shared/utils/cn";
import { TEXT_LIMITS } from "@/shared/utils/inputLimits";
import {
  parseUnitQuantityInput,
  toFiniteNumber,
  type NumericInputValue,
} from "@/shared/utils/numberInput";
import type { InventoryProductRow } from "@/modules/inventory/application/dto/InventoryAlertsDto";
import {
  describeCountError,
  type CountErrorInfo,
  type InventoryCountService,
} from "@/modules/inventory/application/services/InventoryCountService";

type CountMode = "lot" | "serial" | "lot-serial";
type Step = "count" | "review";

interface AdditionDraft {
  id: string;
  quantity: NumericInputValue;
  lotNumber: string;
  expirationDate: string;
  serialsText: string;
}

interface TraceableCountFlowProps {
  row: InventoryProductRow;
  locationId: string;
  countService: InventoryCountService;
  busy: boolean;
  onApply: (input: ReconcileCountInput) => Promise<void>;
  onCancel: () => void;
}

/**
 * Conteo fisico trazable. El estado completo vive dentro de una instancia keyed por
 * sucursal/producto/ubicacion/nonce: cualquier cambio de contexto lo descarta por completo.
 */
export function TraceableCountFlow(props: TraceableCountFlowProps) {
  const [nonce, setNonce] = useState(0);
  return (
    <SnapshotLoader
      key={`${props.row.branchId}|${props.row.productId}|${props.locationId}|${nonce}`}
      {...props}
      onRefresh={() => setNonce((current) => current + 1)}
    />
  );
}

function SnapshotLoader(props: TraceableCountFlowProps & { onRefresh: () => void }) {
  const { row, locationId, countService, onRefresh, onCancel } = props;
  const [state, setState] = useState<{
    snapshot?: InventoryCountSnapshot;
    error?: string;
  } | null>(null);
  const branchId = row.branchId;
  const productId = row.productId;

  useEffect(() => {
    let active = true;
    countService
      .getSnapshot({ branchId, productId, locationId: locationId || undefined })
      .then((snapshot) => {
        if (active) setState({ snapshot });
      })
      .catch((caughtError) => {
        if (active) setState({ error: describeCountError(caughtError).message });
      });
    return () => {
      active = false;
    };
  }, [branchId, countService, locationId, productId]);

  if (!state) {
    return (
      <p className="text-sm font-semibold text-[var(--color-text-muted)]">
        Cargando existencia fisica registrada...
      </p>
    );
  }
  if (!state.snapshot) {
    return (
      <div className="space-y-3">
        <InlineAlert title={state.error ?? "No se pudo cargar el conteo."} tone="danger" />
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} type="button" variant="secondary">
            Cancelar
          </Button>
          <Button onClick={onRefresh} type="button">
            Reintentar
          </Button>
        </div>
      </div>
    );
  }
  return <CountForm {...props} snapshot={state.snapshot} />;
}

function CountForm({
  row,
  snapshot,
  locationId,
  countService,
  busy,
  onApply,
  onCancel,
  onRefresh,
}: TraceableCountFlowProps & { snapshot: InventoryCountSnapshot; onRefresh: () => void }) {
  // Serializado si el flag lo indica O el snapshot trae series: nunca se omite la composicion.
  const serialized =
    snapshot.tracking.serial ||
    snapshot.serials.length > 0 ||
    snapshot.lots.some((lot) => lot.serials.length > 0);
  const mode: CountMode = serialized
    ? snapshot.tracking.lot || snapshot.lots.length > 0
      ? "lot-serial"
      : "serial"
    : "lot";
  const [step, setStep] = useState<Step>("count");
  const [counts, setCounts] = useState<Record<string, NumericInputValue>>({});
  const [foundSerials, setFoundSerials] = useState<string[]>([]);
  const [foundByLot, setFoundByLot] = useState<Record<string, string[]>>({});
  const [additions, setAdditions] = useState<AdditionDraft[]>([]);
  const [additionErrors, setAdditionErrors] = useState<Record<string, string[]>>({});
  const [reason, setReason] = useState("");
  const [openLotId, setOpenLotId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<CountErrorInfo | null>(null);
  const [applying, setApplying] = useState(false);

  const registered = snapshot.quantity;
  const lotFound = (lotId: string) =>
    mode === "lot" ? toFiniteNumber(counts[lotId] ?? 0) : (foundByLot[lotId]?.length ?? 0);
  const foundExisting =
    mode === "serial"
      ? foundSerials.length
      : snapshot.lots.reduce((sum, lot) => sum + lotFound(lot.lotId), 0);
  const additionsTotal = additions.reduce((sum, addition) => sum + toFiniteNumber(addition.quantity), 0);
  const foundTotal = Number((foundExisting + additionsTotal).toFixed(3));
  const difference = Number((foundTotal - registered).toFixed(3));

  const missingSerialsReserved = useMemo(() => {
    const reserved = (items: CountSerialItem[], found: string[]) =>
      items.filter((serial) => serial.status === "RESERVED" && !found.includes(serial.serialNumber));
    if (mode === "serial") return reserved(snapshot.serials, foundSerials);
    if (mode === "lot-serial") {
      return snapshot.lots.flatMap((lot) => reserved(lot.serials, foundByLot[lot.lotId] ?? []));
    }
    return [];
  }, [foundByLot, foundSerials, mode, snapshot.lots, snapshot.serials]);

  const errors: string[] = [];
  if (!reason.trim()) errors.push("El motivo es requerido.");
  if (mode === "lot") {
    for (const lot of snapshot.lots) {
      const value = counts[lot.lotId];
      if (value === undefined || value === "") {
        errors.push(`Declara el conteo del lote ${lot.lotNumber}.`);
      } else if (toFiniteNumber(value) > lot.quantity) {
        errors.push(`El lote ${lot.lotNumber} no puede superar ${lot.quantity}; usa unidad adicional.`);
      }
    }
  }
  Object.values(additionErrors).forEach((list) => errors.push(...list));
  const invalid = errors.length > 0;

  function buildInput(): ReconcileCountInput {
    return {
      branchId: snapshot.branchId,
      productId: snapshot.productId,
      ...(locationId ? { locationId } : {}),
      reason: reason.trim(),
      // Valores del snapshot original; nunca se recalculan.
      expectedQuantity: snapshot.quantity,
      ...(mode === "serial"
        ? {
            // Composicion ORIGINAL del snapshot, nunca derivada de la UI, busqueda ni additions.
            expectedSerialNumbers: snapshot.serials.map((serial) => serial.serialNumber),
            foundSerialNumbers: foundSerials,
          }
        : {
            lots: snapshot.lots.map((lot) => ({
              lotId: lot.lotId,
              expectedQuantity: lot.quantity,
              ...(mode === "lot"
                ? { countedQuantity: toFiniteNumber(counts[lot.lotId] ?? 0) }
                : {
                    expectedSerialNumbers: lot.serials.map((serial) => serial.serialNumber),
                    foundSerialNumbers: foundByLot[lot.lotId] ?? [],
                  }),
            })),
          }),
      additions: additions.map((addition) => {
        const serials = parseSerials(addition.serialsText);
        return {
          quantity: toFiniteNumber(addition.quantity),
          ...(snapshot.tracking.lot && addition.lotNumber.trim()
            ? { lotNumber: addition.lotNumber.trim() }
            : {}),
          ...(snapshot.tracking.expiration && addition.expirationDate
            ? { expirationDate: addition.expirationDate }
            : {}),
          ...(snapshot.tracking.serial ? { serialNumbers: serials } : {}),
        };
      }),
    };
  }

  async function apply() {
    if (invalid || applying || busy) return;
    setApplying(true);
    setSubmitError(null);
    try {
      await onApply(buildInput());
    } catch (caughtError) {
      setSubmitError(describeCountError(caughtError));
      setStep("count");
    } finally {
      setApplying(false);
    }
  }

  function updateAddition(id: string, patch: Partial<AdditionDraft>) {
    setAdditions((current) =>
      current.map((addition) => (addition.id === id ? { ...addition, ...patch } : addition)),
    );
  }

  const reportAdditionErrors = useCallback((id: string, list: string[]) => {
    setAdditionErrors((current) => {
      const previous = current[id] ?? [];
      if (previous.join("|") === list.join("|")) return current;
      const next = { ...current };
      if (list.length === 0) delete next[id];
      else next[id] = list;
      return next;
    });
  }, []);

  function removeAddition(id: string) {
    setAdditions((current) => current.filter((addition) => addition.id !== id));
    setAdditionErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  const summary = (
    <dl className="grid gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-app-background)] px-3 py-2 text-sm sm:grid-cols-5">
      <SummaryCell label="Registrado" value={registered} />
      <SummaryCell label="Reservado" value={snapshot.reservedQuantity} />
      <SummaryCell label="Disponible" value={snapshot.availableQuantity} />
      <SummaryCell label="Encontrado" value={foundTotal} />
      <SummaryCell
        label="Diferencia"
        tone={difference < 0 ? "danger" : difference > 0 ? "success" : undefined}
        value={`${difference > 0 ? "+" : ""}${difference}`}
      />
    </dl>
  );

  if (step === "review") {
    const missingTotal = Math.max(0, registered - foundExisting);
    return (
      <div className="space-y-4">
        {summary}
        <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--color-app-background)] text-xs uppercase text-[var(--color-text-muted)]">
              <tr>
                <th className="px-3 py-2">Lote</th>
                <th className="px-3 py-2 text-right">Registrado</th>
                <th className="px-3 py-2 text-right">Encontrado</th>
                <th className="px-3 py-2 text-right">No encontrado</th>
              </tr>
            </thead>
            <tbody>
              {mode === "serial" ? (
                <tr className="border-t border-[var(--color-border)]">
                  <td className="px-3 py-2">Series sin lote</td>
                  <td className="px-3 py-2 text-right">{snapshot.serials.length}</td>
                  <td className="px-3 py-2 text-right">{foundSerials.length}</td>
                  <td className="px-3 py-2 text-right">{snapshot.serials.length - foundSerials.length}</td>
                </tr>
              ) : (
                snapshot.lots.map((lot) => (
                  <tr className="border-t border-[var(--color-border)]" key={lot.lotId}>
                    <td className="px-3 py-2">{lot.lotNumber}</td>
                    <td className="px-3 py-2 text-right">{lot.quantity}</td>
                    <td className="px-3 py-2 text-right">{lotFound(lot.lotId)}</td>
                    <td className="px-3 py-2 text-right">{Math.max(0, lot.quantity - lotFound(lot.lotId))}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {additions.length > 0 ? (
          <p className="text-sm font-semibold text-[var(--color-title)]">
            Se registraran {additionsTotal} unidades adicionales encontradas.
          </p>
        ) : null}
        {missingTotal > 0 ? (
          <InlineAlert
            title={`Se detectaron ${missingTotal} unidades no encontradas. Al aplicar el conteo se actualizara el inventario y la trazabilidad asociada.`}
            tone="warning"
          />
        ) : null}
        {missingSerialsReserved.length > 0 ? (
          <InlineAlert
            title="Hay seriales reservados que no fueron marcados como encontrados; el backend puede rechazar el conteo."
            tone="warning"
          />
        ) : null}
        {submitError ? <InlineAlert title={submitError.message} tone="danger" /> : null}
        <CountFooter>
          <Button disabled={applying || busy} onClick={() => setStep("count")} type="button" variant="secondary">
            Volver
          </Button>
          <Button disabled={applying || busy || invalid} onClick={() => void apply()} type="button">
            {applying || busy ? "Aplicando..." : "Aplicar conteo"}
          </Button>
        </CountFooter>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {summary}
      {submitError ? (
        <InlineAlert title={submitError.message} tone="danger">
          {submitError.kind === "stale" ? (
            <div className="mt-2">
              <Button onClick={onRefresh} type="button" variant="secondary">
                Actualizar conteo
              </Button>
            </div>
          ) : null}
        </InlineAlert>
      ) : null}

      {mode === "lot" ? (
        <div className="space-y-2">
          {snapshot.lots.map((lot) => {
            const value = counts[lot.lotId] ?? "";
            const diff = value === "" ? null : toFiniteNumber(value) - lot.quantity;
            return (
              <div
                className="grid items-center gap-2 rounded-md border border-[var(--color-border)] p-3 sm:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,0.7fr))_minmax(0,0.9fr)_minmax(0,0.6fr)]"
                key={lot.lotId}
              >
                <div className="min-w-0">
                  <p className="font-bold text-[var(--color-title)]">Lote {lot.lotNumber}</p>
                  {lot.expirationDate ? (
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Vence {formatDate(lot.expirationDate)}
                    </p>
                  ) : null}
                </div>
                <SummaryCell label="Registrado" value={lot.quantity} />
                <SummaryCell label="Reservado" value={lot.reservedQuantity} />
                <div>
                  <p className="text-[11px] font-bold uppercase text-[var(--color-text-muted)]">
                    Conteo fisico
                  </p>
                  <Input
                    aria-label={`Conteo fisico del lote ${lot.lotNumber}`}
                    inputMode={row.unitAllowsDecimals ? "decimal" : "numeric"}
                    maxLength={12}
                    onChange={(event) => {
                      const parsed = parseUnitQuantityInput(event.target.value, row.unitAllowsDecimals);
                      // No se admite mas que lo registrado: el excedente va como unidad adicional.
                      const next =
                        typeof parsed === "number" && parsed > lot.quantity ? lot.quantity : parsed;
                      setCounts((current) => ({ ...current, [lot.lotId]: next }));
                    }}
                    type="text"
                    value={value}
                  />
                </div>
                <SummaryCell
                  label="Diferencia"
                  tone={diff === null ? undefined : diff < 0 ? "danger" : undefined}
                  value={diff === null ? "-" : diff}
                />
              </div>
            );
          })}
        </div>
      ) : null}

      {mode === "serial" ? (
        <SerialChecklist
          selected={foundSerials}
          serials={snapshot.serials}
          title="Seriales fisicos registrados"
          onChange={setFoundSerials}
        />
      ) : null}

      {mode === "lot-serial" ? (
        <div className="space-y-2">
          {snapshot.lots.map((lot) => {
            const found = foundByLot[lot.lotId] ?? [];
            const open = openLotId === lot.lotId;
            return (
              <div className="rounded-md border border-[var(--color-border)]" key={lot.lotId}>
                <button
                  aria-expanded={open}
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left"
                  onClick={() => setOpenLotId(open ? null : lot.lotId)}
                  type="button"
                >
                  <span>
                    <span className="block font-bold text-[var(--color-title)]">Lote {lot.lotNumber}</span>
                    {lot.expirationDate ? (
                      <span className="text-xs text-[var(--color-text-muted)]">
                        Vence {formatDate(lot.expirationDate)}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs font-semibold text-[var(--color-text-muted)]">
                    Registrado {lot.quantity} · Reservado {lot.reservedQuantity} · Encontrados{" "}
                    {found.length} · Faltantes {Math.max(0, lot.serials.length - found.length)}
                  </span>
                </button>
                {open ? (
                  <div className="border-t border-[var(--color-border)] p-3">
                    <SerialChecklist
                      selected={found}
                      serials={lot.serials}
                      title="Seriales del lote"
                      onChange={(next) => setFoundByLot((current) => ({ ...current, [lot.lotId]: next }))}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {missingSerialsReserved.length > 0 ? (
        <InlineAlert
          title={`${missingSerialsReserved.length} serial(es) reservado(s) sin marcar como encontrados.`}
          tone="warning"
        />
      ) : null}

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--color-title)]">
            Unidades encontradas no registradas
          </h3>
          <Button
            onClick={() =>
              setAdditions((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  quantity: "",
                  lotNumber: "",
                  expirationDate: "",
                  serialsText: "",
                },
              ])
            }
            type="button"
            variant="secondary"
          >
            + Registrar unidad adicional
          </Button>
        </div>
        {additions.map((addition) => (
          <AdditionRow
            addition={addition}
            countService={countService}
            key={addition.id}
            productId={snapshot.productId}
            tracking={snapshot.tracking}
            unitAllowsDecimals={row.unitAllowsDecimals}
            onChange={(patch) => updateAddition(addition.id, patch)}
            onErrors={reportAdditionErrors}
            onRemove={() => removeAddition(addition.id)}
          />
        ))}
      </section>

      <label className="block space-y-1">
        <span className="text-sm font-semibold text-[var(--color-title)]">Motivo *</span>
        <textarea
          className="min-h-20 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
          maxLength={TEXT_LIMITS.reason}
          onChange={(event) => setReason(event.target.value)}
          value={reason}
        />
      </label>

      {invalid && reason.trim() ? (
        <ul className="space-y-0.5 text-xs font-semibold text-[var(--color-danger)]">
          {errors.slice(0, 5).map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      <CountFooter>
        <Button onClick={onCancel} type="button" variant="secondary">
          Cancelar
        </Button>
        <Button disabled={invalid} onClick={() => setStep("review")} type="button">
          Revisar conteo
        </Button>
      </CountFooter>
    </div>
  );
}

function CountFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-[var(--color-border)] bg-white px-4 py-3 sm:flex-row sm:justify-end">
      {children}
    </div>
  );
}

function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "danger" | "success";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase text-[var(--color-text-muted)]">{label}</dt>
      <dd
        className={cn(
          "font-bold text-[var(--color-title)]",
          tone === "danger" && "text-red-700",
          tone === "success" && "text-emerald-700",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** Marcado por click (sin Ctrl/Shift); la busqueda local no pierde la seleccion. */
function SerialChecklist({
  serials,
  selected,
  title,
  onChange,
}: {
  serials: CountSerialItem[];
  selected: string[];
  title: string;
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const visible = normalized
    ? serials.filter((serial) => serial.serialNumber.toLowerCase().includes(normalized))
    : serials;

  function toggle(serialNumber: string) {
    onChange(
      selected.includes(serialNumber)
        ? selected.filter((item) => item !== serialNumber)
        : [...selected, serialNumber],
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-bold text-[var(--color-title)]">{title}</p>
      {serials.length > 8 ? (
        <Input
          aria-label="Buscar serie"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar serie..."
          value={query}
        />
      ) : null}
      <div className="max-h-56 overflow-y-auto rounded-md border border-[var(--color-border)] bg-white">
        {visible.length === 0 ? (
          <p className="px-3 py-2 text-sm text-[var(--color-text-muted)]">No hay series.</p>
        ) : (
          visible.map((serial) => {
            const checked = selected.includes(serial.serialNumber);
            return (
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 border-b border-[var(--color-border)] px-3 py-1.5 text-sm last:border-b-0",
                  checked && "bg-blue-50 font-semibold",
                )}
                key={serial.serialId}
              >
                <input checked={checked} onChange={() => toggle(serial.serialNumber)} type="checkbox" />
                <span className="break-all">{serial.serialNumber}</span>
                {serial.status === "RESERVED" ? (
                  <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                    Reservado
                  </span>
                ) : null}
              </label>
            );
          })
        )}
      </div>
      <p className="text-sm font-semibold text-[var(--color-text-muted)]">
        Encontrados: {selected.length} / {serials.length} · No encontrados:{" "}
        {Math.max(0, serials.length - selected.length)}
      </p>
    </div>
  );
}

function AdditionRow({
  addition,
  tracking,
  productId,
  countService,
  unitAllowsDecimals,
  onChange,
  onErrors,
  onRemove,
}: {
  addition: AdditionDraft;
  tracking: InventoryCountSnapshot["tracking"];
  productId: string;
  countService: InventoryCountService;
  unitAllowsDecimals: boolean;
  onChange: (patch: Partial<AdditionDraft>) => void;
  onErrors: (id: string, errors: string[]) => void;
  onRemove: () => void;
}) {
  const serials = parseSerials(addition.serialsText);
  const repeated = findRepeated(serials);
  const quantity = toFiniteNumber(addition.quantity);
  const precheck = useSerialBatchPrecheck({
    serials,
    enabled: tracking.serial,
    validate: (list) => countService.validateNewSerials({ productId, serialNumbers: list }),
  });

  const errors: string[] = [];
  if (quantity <= 0) errors.push("Ingresa la cantidad de la unidad adicional.");
  if (tracking.lot && !addition.lotNumber.trim()) errors.push("Ingresa el lote de la unidad adicional.");
  if (tracking.expiration) {
    if (!addition.expirationDate) errors.push("Ingresa el vencimiento de la unidad adicional.");
    else if (isExpirationBeforeOperationDate(addition.expirationDate, getLocalCalendarDate())) {
      errors.push(EXPIRATION_BEFORE_ENTRY_MESSAGE);
    }
  }
  if (tracking.serial) {
    if (!Number.isInteger(quantity) || serials.length !== quantity) {
      errors.push(`Registra exactamente ${quantity} series nuevas (tienes ${serials.length}).`);
    }
    if (repeated.length > 0) errors.push(`Series repetidas: ${repeated.join(", ")}.`);
    if (precheck.remoteDuplicates.length > 0) {
      errors.push(`Series ya registradas: ${precheck.remoteDuplicates.join(", ")}.`);
    }
  }
  const errorKey = errors.join("|");

  useEffect(() => {
    onErrors(addition.id, errorKey ? errorKey.split("|") : []);
  }, [addition.id, errorKey, onErrors]);

  // Al desmontar se limpia su error para no bloquear la revision.
  useEffect(() => {
    const id = addition.id;
    return () => onErrors(id, []);
  }, [addition.id, onErrors]);

  return (
    <div className="space-y-2 rounded-md border border-[var(--color-border)] p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="space-y-1 text-xs font-bold uppercase text-[var(--color-text-muted)]">
          Cantidad
          <Input
            inputMode={unitAllowsDecimals && !tracking.serial ? "decimal" : "numeric"}
            maxLength={12}
            onChange={(event) =>
              onChange({
                quantity: parseUnitQuantityInput(event.target.value, unitAllowsDecimals && !tracking.serial),
              })
            }
            type="text"
            value={addition.quantity}
          />
        </label>
        {tracking.lot ? (
          <label className="space-y-1 text-xs font-bold uppercase text-[var(--color-text-muted)]">
            Lote
            <Input
              maxLength={TEXT_LIMITS.lotNumber}
              onChange={(event) => onChange({ lotNumber: event.target.value })}
              value={addition.lotNumber}
            />
          </label>
        ) : null}
        {tracking.expiration ? (
          <label className="space-y-1 text-xs font-bold uppercase text-[var(--color-text-muted)]">
            Vencimiento
            <Input
              min={getLocalCalendarDate()}
              onChange={(event) => onChange({ expirationDate: event.target.value })}
              type="date"
              value={addition.expirationDate}
            />
          </label>
        ) : null}
      </div>
      {tracking.serial ? (
        <textarea
          aria-label="Series nuevas"
          className="min-h-20 w-full rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
          maxLength={TEXT_LIMITS.serialNumbers}
          onChange={(event) => onChange({ serialsText: event.target.value })}
          placeholder="Una serie nueva por linea"
          value={addition.serialsText}
        />
      ) : null}
      {precheck.unavailable ? (
        <p className="text-xs font-semibold text-[var(--color-text-muted)]">
          No se pudo validar los seriales en este momento; se validaran al aplicar.
        </p>
      ) : null}
      {errors.length > 0 ? (
        <ul className="space-y-0.5 text-xs font-semibold text-[var(--color-danger)]">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex justify-end">
        <Button onClick={onRemove} type="button" variant="ghost">
          Quitar
        </Button>
      </div>
    </div>
  );
}

function parseSerials(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function findRepeated(serials: string[]) {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  serials.forEach((serial) => {
    if (seen.has(serial)) repeated.add(serial);
    seen.add(serial);
  });
  return [...repeated];
}

function formatDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}
