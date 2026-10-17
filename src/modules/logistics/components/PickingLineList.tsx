import { useState } from "react";
import { PickingIncidentStatus } from "@/core/enums";
import type {
  PickingDetailLineDto,
  PickingIncidentDto,
} from "@/modules/logistics/application/dto/PickingReadModelDto";
import {
  buildPickingPhysicalSelection,
  buildPickingSerialReplacement,
  getPickingCanonicalLocationIds,
  getPickingLineUpdateAvailability,
  getPickingLocationLots,
  getPickingLocationSerials,
  type PickingPhysicalSelectionResult,
} from "@/modules/logistics/application/pickingPhysicalSelection";
import { validatePickingLineUpdate } from "@/modules/logistics/validation/picking.validation";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { InlineAlert } from "@/shared/components/InlineAlert";
import { Input } from "@/shared/components/Input";
import { Select } from "@/shared/components/Select";
import { StatusBadge } from "@/shared/components/StatusBadge";

interface PickingLineListProps {
  disabled: boolean;
  editable: boolean;
  incidents: PickingIncidentDto[];
  lines: PickingDetailLineDto[];
  onUpdate: (
    line: PickingDetailLineDto,
    targetQuantity: number,
    physicalSelection: PickingPhysicalSelectionResult,
  ) => Promise<boolean>;
}

export function PickingLineList({ disabled, editable, incidents, lines, onUpdate }: PickingLineListProps) {
  return (
    <section className="space-y-2.5">
      <div>
        <h3 className="font-bold text-[var(--color-title)]">Productos por preparar</h3>
        <p className="text-sm text-[var(--color-text-muted)]">
          Las ubicaciones, lotes y vencimientos provienen de la reserva autoritativa.
        </p>
      </div>
      {lines.map((line) => (
        <PickingLineCard
          disabled={disabled}
          editable={editable}
          incidents={incidents.filter((incident) => incident.pickingLineId === line.pickingLineId)}
          key={`${line.pickingLineId}-${line.pickedQuantity}-${line.serialNumbers.join(",")}`}
          line={line}
          onUpdate={onUpdate}
        />
      ))}
    </section>
  );
}

interface PickingLineCardProps {
  disabled: boolean;
  editable: boolean;
  incidents: PickingIncidentDto[];
  line: PickingDetailLineDto;
  onUpdate: PickingLineListProps["onUpdate"];
}

function PickingLineCard({ disabled, editable, incidents, line, onUpdate }: PickingLineCardProps) {
  const [targetText, setTargetText] = useState(String(line.pickedQuantity));
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
    line.location?.id ?? line.trackingSelections[0]?.locationId ?? null,
  );
  const [selectedLotId, setSelectedLotId] = useState<string | null>(
    line.trackingSelections[0]?.lotId ?? null,
  );
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [replacementSerials, setReplacementSerials] = useState<string[]>(line.serialNumbers);
  const [serialEntry, setSerialEntry] = useState("");
  const [serialSearch, setSerialSearch] = useState("");
  const [showAvailableSerials, setShowAvailableSerials] = useState(false);
  const [replacementSerialSearch, setReplacementSerialSearch] = useState("");
  const [showReplacementSerials, setShowReplacementSerials] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetQuantity = Number(targetText);
  const serialDelta = Number.isFinite(targetQuantity)
    ? Math.max(targetQuantity - line.pickedQuantity, 0)
    : 0;
  const recommendedSerialCount = serialDelta > 0 ? serialDelta : line.remainingQuantity;
  const canonicalLocationIds = new Set(getPickingCanonicalLocationIds(line));
  const locationSerialNumbers = getPickingLocationSerials(line, selectedLocationId);
  const recommendedSerialNumbers = locationSerialNumbers.slice(0, recommendedSerialCount);
  const recommendedSerialSet = new Set(recommendedSerialNumbers);
  const alternativeSerialNumbers = locationSerialNumbers.filter(
    (serial) => !recommendedSerialSet.has(serial),
  );
  const selectedLot = line.lot
    ? line.availableLots.find((candidate) => candidate.id === line.lot?.id)
    : null;
  const visibleSerialNumbers = filterAvailableSerialNumbers(
    alternativeSerialNumbers,
    serialSearch,
  );
  const replacementSerialOptions = [...new Set([
    ...line.serialNumbers,
    ...locationSerialNumbers,
  ])];
  const visibleReplacementSerialOptions = filterAvailableSerialNumbers(
    replacementSerialOptions,
    replacementSerialSearch,
  );
  const lockedSerials = selectedSerials.length > 0 ? selectedSerials : line.serialNumbers;
  const serialControlsLocked = !editable || disabled;
  const locationLots = getPickingLocationLots(line, selectedLocationId);
  const traceable = line.tracking.lot || line.tracking.expiration || line.tracking.serial;
  const updateAvailability = getPickingLineUpdateAvailability(line);

  const submit = async () => {
    const validationError = validatePickingLineUpdate(line, targetQuantity, selectedSerials);
    setError(validationError);
    if (validationError) return;
    let physicalSelection: PickingPhysicalSelectionResult;
    try {
      physicalSelection = buildPickingPhysicalSelection(line, targetQuantity, {
        locationId: selectedLocationId,
        lotId: selectedLotId,
        serialNumbers: selectedSerials,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La seleccion fisica no es valida.");
      return;
    }
    const saved = await onUpdate(line, targetQuantity, physicalSelection);
    if (!saved) return;
    setError(null);
  };

  const addScannedSerial = () => {
    const number = serialEntry.trim();
    if (!locationSerialNumbers.includes(number) || selectedSerials.includes(number)) {
      setError("Selecciona una serie disponible para esta reserva.");
      return;
    }
    if (selectedSerials.length >= serialDelta) {
      setError("Ya se seleccionó la cantidad requerida de series.");
      return;
    }
    setSelectedSerials((current) => [...current, number]);
    setSerialEntry("");
    setError(null);
  };

  const replaceSerials = async () => {
    if (replacementSerials.length !== line.pickedQuantity) {
      setError(`Selecciona exactamente ${line.pickedQuantity} serie(s).`);
      return;
    }
    if (new Set(replacementSerials).size !== replacementSerials.length) {
      setError("No puedes seleccionar una serie más de una vez.");
      return;
    }
    try {
      const physicalSelection = buildPickingSerialReplacement(line, replacementSerials);
      if (await onUpdate(line, line.pickedQuantity, physicalSelection)) setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La seleccion fisica no es valida.");
    }
  };

  return (
    <article className="rounded-xl border border-[var(--color-border)] bg-white p-3 shadow-sm sm:p-3.5">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-[var(--color-title)]">{line.name}</h4>
            <StatusBadge status={line.status} />
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">{line.sku}</p>
        </div>
        <dl className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-md bg-slate-50 px-2 py-1.5"><dt className="text-xs text-[var(--color-text-muted)]">Requerida</dt><dd className="font-bold">{line.requiredQuantity}</dd></div>
          <div className="rounded-md bg-slate-50 px-2 py-1.5"><dt className="text-xs text-[var(--color-text-muted)]">Recogida</dt><dd className="font-bold">{line.pickedQuantity}</dd></div>
          <div className="rounded-md bg-slate-50 px-2 py-1.5"><dt className="text-xs text-[var(--color-text-muted)]">Restante</dt><dd className="font-bold">{line.remainingQuantity}</dd></div>
        </dl>
      </div>

      <div className="mt-3 grid gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><p className="text-xs text-[var(--color-text-muted)]">Ubicación asignada</p><p>{line.location ? `${line.location.code} · ${line.location.name}` : "Según reserva"}</p></div>
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">Lote / vencimiento</p>
          <p>{line.lot?.number ?? (line.tracking.lot ? "Según FEFO" : "No aplica")}</p>
          {selectedLot?.expirationDate ? <p className="text-xs text-[var(--color-text-muted)]">Vence {formatExpirationDate(selectedLot.expirationDate)}</p> : null}
        </div>
        <div><p className="text-xs text-[var(--color-text-muted)]">Series recogidas</p><p>{!line.tracking.serial ? "No aplica" : line.serialNumbers.length ? line.serialNumbers.join(", ") : "Ninguna"}</p></div>
      </div>

      <div className="mt-2.5 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
        <p className="text-xs font-semibold text-[var(--color-text-muted)]">Incidencia</p>
        {incidents.length === 0 ? (
          <p className="mt-1">Sin incidencias</p>
        ) : (
          <div className="mt-1 space-y-2">
            {incidents.map((incident) => (
              <div className="flex flex-wrap items-center gap-2" key={incident.id}>
                <StatusBadge status={incident.status === PickingIncidentStatus.open ? "Abierta" : "Resuelta"} tone={incident.status === PickingIncidentStatus.open ? "warning" : "success"} />
                <span>{incident.comment}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {line.availableLocations.length > 0 ? (
        <div className="mt-2.5 text-xs text-[var(--color-text-muted)]">
          <span className="font-semibold text-[var(--color-text)]">Disponibilidad reservada: </span>
          {line.availableLocations.map((location) => `${location.code ?? "Sin ubicación"}: ${location.ownReservedQuantity}`).join(" · ")}
        </div>
      ) : null}
      {line.tracking.lot && line.availableLots.length > 0 ? (
        <div className="mt-1.5 text-xs text-[var(--color-text-muted)]">
          <span className="font-semibold text-[var(--color-text)]">Lotes canónicos: </span>
          {line.availableLots.map((lot) => `${lot.number}${lot.expirationDate ? ` (vence ${formatExpirationDate(lot.expirationDate)})` : ""}`).join(" · ")}
        </div>
      ) : null}

      {!updateAvailability.available ? (
        <div className="mt-2.5">
          <InlineAlert
            description={updateAvailability.reason ?? "La trazabilidad de esta linea no esta disponible."}
            title="Trazabilidad no disponible"
            tone="warning"
          />
        </div>
      ) : null}

      {editable && !disabled && updateAvailability.available && line.remainingQuantity > 0 ? (
        <div className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
          {traceable ? (
            <div className="grid gap-2.5 sm:grid-cols-2">
              <FormField id={`location-${line.pickingLineId}`} label="Ubicacion fisica *">
                <Select
                  disabled={disabled || Boolean(line.location)}
                  id={`location-${line.pickingLineId}`}
                  onChange={(event) => {
                    setSelectedLocationId(event.target.value || null);
                    setSelectedLotId(null);
                    setSelectedSerials([]);
                    setError(null);
                  }}
                  value={selectedLocationId ?? ""}
                >
                  <option value="">Selecciona una ubicacion</option>
                  {line.availableLocations.filter(
                    (location) => location.id && canonicalLocationIds.has(location.id),
                  ).map((location) => (
                    <option key={location.id!} value={location.id!}>
                      {location.code ?? "Sin codigo"} - {location.name ?? "Sin nombre"}
                    </option>
                  ))}
                </Select>
              </FormField>
              {line.tracking.lot ? (
                <FormField id={`lot-${line.pickingLineId}`} label="Lote para el incremento *">
                  <Select
                    disabled={disabled || !selectedLocationId || line.tracking.serial}
                    id={`lot-${line.pickingLineId}`}
                    onChange={(event) => {
                      setSelectedLotId(event.target.value || null);
                      setError(null);
                    }}
                    value={selectedLotId ?? ""}
                  >
                    <option value="">Selecciona un lote</option>
                    {locationLots.map((lot) => (
                      <option key={lot.lotId} value={lot.lotId}>
                        {lot.lotNumber}{lot.expirationDate ? ` - vence ${formatExpirationDate(lot.expirationDate)}` : ""}
                      </option>
                    ))}
                  </Select>
                </FormField>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <FormField id={`target-${line.pickingLineId}`} label="Cantidad total recogida">
              <Input
                disabled={disabled}
                id={`target-${line.pickingLineId}`}
                max={line.requiredQuantity}
                min={line.pickedQuantity + 0.001}
                onChange={(event) => {
                  setTargetText(event.target.value);
                  setSelectedSerials([]);
                  setError(null);
                }}
                step={line.tracking.serial ? 1 : 0.001}
                type="number"
                value={targetText}
              />
            </FormField>
            <Button disabled={disabled} onClick={() => void submit()} type="button">
              Registrar progreso
            </Button>
          </div>

          {line.tracking.serial ? (
            <fieldset className="space-y-2.5 rounded-lg border border-[var(--color-border)] bg-slate-50 p-3" disabled={disabled}>
              <legend className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                <span>Series disponibles</span>
                <span className="rounded-full border border-[var(--color-primary)]/30 bg-white px-2 py-0.5 text-xs font-bold text-[var(--color-title)]">
                  seleccionadas {selectedSerials.length} / requeridas {serialDelta}
                </span>
              </legend>
              <div className="flex max-w-lg gap-2">
                <Input aria-label="Escanear o escribir serie" onChange={(event) => setSerialEntry(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addScannedSerial(); } }}
                  placeholder="Escanear o escribir serie" value={serialEntry} />
                <Button disabled={disabled || !serialEntry.trim()} onClick={addScannedSerial} type="button" variant="secondary">Agregar</Button>
              </div>
              {recommendedSerialNumbers.length > 0 ? (
                <div className="rounded-lg border border-[var(--color-primary)]/25 bg-white p-2.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-title)]">
                    Series sugeridas
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {recommendedSerialNumbers.map((serial) => {
                      const selected = selectedSerials.includes(serial);
                      return (
                        <button
                          aria-pressed={selected}
                          className="rounded-full border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 px-2.5 py-1 text-sm font-medium text-[var(--color-title)] transition hover:border-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={
                            disabled ||
                            selected ||
                            serialDelta <= 0 ||
                            selectedSerials.length >= serialDelta
                          }
                          key={serial}
                          onClick={() => {
                            setSelectedSerials((current) => [...current, serial]);
                            setError(null);
                          }}
                          type="button"
                        >
                          {selected ? "✓ " : ""}{serial}
                        </button>
                      );
                    })}
                  </div>
                  {serialDelta <= 0 ? (
                    <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                      Indica la cantidad total que recogerás para seleccionar las sugerencias.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {selectedSerials.length > 0 ? (
                <div aria-label="Series seleccionadas" className="flex flex-wrap gap-1.5">
                  {selectedSerials.map((serial) => (
                    <button
                      aria-label={`Quitar serie ${serial}`}
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--color-primary)] bg-white px-2.5 py-0.5 text-sm font-medium text-[var(--color-title)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                      disabled={disabled}
                      key={serial}
                      onClick={() => {
                        setSelectedSerials((current) => current.filter((item) => item !== serial));
                        setError(null);
                      }}
                      type="button"
                    >
                      {serial} <span aria-hidden="true">×</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {alternativeSerialNumbers.length ? (
                <>
                  <Button
                    aria-controls={`available-serials-${line.pickingLineId}`}
                    aria-expanded={showAvailableSerials}
                    className="self-start px-3 py-1.5 text-xs"
                    disabled={disabled}
                    onClick={() => setShowAvailableSerials((current) => !current)}
                    type="button"
                    variant="secondary"
                  >
                    {showAvailableSerials
                      ? "Ocultar otras series disponibles"
                      : `Ver otras series disponibles (${alternativeSerialNumbers.length})`}
                  </Button>
                  {showAvailableSerials ? (
                    <div
                      className="space-y-2.5 rounded-lg border border-[var(--color-border)] bg-white p-2.5"
                      id={`available-serials-${line.pickingLineId}`}
                    >
                      <Input
                        aria-label="Buscar serie"
                        onChange={(event) => setSerialSearch(event.target.value)}
                        placeholder="Buscar serie..."
                        value={serialSearch}
                      />
                      {serialSearch.trim() ? (
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {visibleSerialNumbers.length} coincidencia{visibleSerialNumbers.length === 1 ? "" : "s"}
                        </p>
                      ) : null}
                      {visibleSerialNumbers.length === 0 ? (
                        <p className="text-sm text-[var(--color-text-muted)]">No se encontraron series.</p>
                      ) : (
                        <div className="grid max-h-56 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-4">
                          {visibleSerialNumbers.map((serial) => {
                            const checked = selectedSerials.includes(serial);
                            const limitReached = !checked && selectedSerials.length >= serialDelta;
                            return (
                              <label
                                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors ${
                                  checked
                                    ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 font-medium text-[var(--color-title)]"
                                    : "border-[var(--color-border)] bg-white"
                                }`}
                                key={serial}
                              >
                                <input
                                  checked={checked}
                                  disabled={disabled || serialDelta <= 0 || limitReached}
                                  onChange={() => {
                                    setSelectedSerials((current) => checked ? current.filter((item) => item !== serial) : [...current, serial]);
                                    setError(null);
                                  }}
                                  type="checkbox"
                                />
                                {serial}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}
                </>
              ) : line.availableSerialNumbers.length === 0 ? (
                <InlineAlert
                  description="No hay series disponibles en la reserva actual."
                  title="Series no disponibles"
                  tone="warning"
                />
              ) : null}
            </fieldset>
          ) : null}
        </div>
      ) : null}
      {line.tracking.serial && serialControlsLocked ? (
        <SerialSelectionSummary
          requiredCount={line.requiredQuantity}
          selectedCount={lockedSerials.length}
          serials={lockedSerials}
        />
      ) : null}
      {editable && !disabled && updateAvailability.available && line.tracking.serial && line.pickedQuantity > 0 ? (
        <div className="mt-3 space-y-2 border-t border-[var(--color-border)] pt-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">Corregir series recogidas · {replacementSerials.length} / {line.pickedQuantity}</p>
            <Button
              aria-controls={`replacement-serials-${line.pickingLineId}`}
              aria-expanded={showReplacementSerials}
              className="px-3 py-1.5 text-xs"
              onClick={() => setShowReplacementSerials((current) => !current)}
              type="button"
              variant="secondary"
            >
              {showReplacementSerials ? "Ocultar series disponibles" : "Ver series disponibles"}
            </Button>
          </div>
          <div aria-label="Series recogidas" className="flex flex-wrap gap-1.5">
            {replacementSerials.map((serial) => (
              <span
                className="rounded-full border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 px-2.5 py-0.5 text-sm font-medium text-[var(--color-title)]"
                key={serial}
              >
                ✓ {serial}
              </span>
            ))}
          </div>
          {showReplacementSerials ? (
            <div
              className="space-y-2.5 rounded-lg border border-[var(--color-border)] bg-slate-50 p-3"
              id={`replacement-serials-${line.pickingLineId}`}
            >
              <Input
                aria-label="Buscar serie para corregir"
                onChange={(event) => setReplacementSerialSearch(event.target.value)}
                placeholder="Buscar serie..."
                value={replacementSerialSearch}
              />
              <div className="grid max-h-56 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-4">
                {visibleReplacementSerialOptions.map((serial) => (
                  <label
                    className={`flex items-center gap-1.5 rounded-md border bg-white px-2.5 py-1.5 ${
                      replacementSerials.includes(serial)
                        ? "border-[var(--color-primary)] font-medium text-[var(--color-title)]"
                        : "border-[var(--color-border)]"
                    }`}
                    key={serial}
                  >
                    <input checked={replacementSerials.includes(serial)} disabled={disabled ||
                      (!replacementSerials.includes(serial) && replacementSerials.length >= line.pickedQuantity)}
                      onChange={() => setReplacementSerials((current) => current.includes(serial)
                        ? current.filter((item) => item !== serial) : [...current, serial])} type="checkbox" />
                    {serial}
                  </label>
                ))}
              </div>
              <Button disabled={disabled || replacementSerials.length !== line.pickedQuantity ||
                replacementSerials.every((serial) => line.serialNumbers.includes(serial))}
                onClick={() => void replaceSerials()} type="button" variant="secondary">
                Guardar selección de series
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <InlineAlert description={error} title="Revisa el progreso" tone="warning" /> : null}
    </article>
  );
}

function SerialSelectionSummary({
  serials,
  selectedCount,
  requiredCount,
}: {
  serials: string[];
  selectedCount: number;
  requiredCount: number;
}) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-[var(--color-text-muted)]">Series recogidas</p>
        <span className="rounded-full bg-[var(--color-app-background)] px-2 py-0.5 text-xs font-bold text-[var(--color-title)]">
          seleccionadas {selectedCount} / requeridas {requiredCount}
        </span>
      </div>
      {serials.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {serials.map((serial) => (
            <span
              className="rounded-full border border-[var(--color-primary)]/40 bg-[var(--color-app-background)] px-2.5 py-0.5 text-sm font-medium text-[var(--color-title)]"
              key={serial}
            >
              {serial}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function formatExpirationDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) return value;
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

export function filterAvailableSerialNumbers(serialNumbers: string[], search: string) {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  if (!normalizedSearch) return serialNumbers;
  return serialNumbers.filter((serial) => serial.toLocaleLowerCase().includes(normalizedSearch));
}
