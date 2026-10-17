import { useEffect, useRef, useState } from "react";
import {
  INVALID_IMAGE_URL_MESSAGE,
  resolveImageUrlInput,
} from "@/core/media/resolveImageUrlInput";
import { Input } from "@/shared/components/Input";

interface ImageUrlFieldProps {
  readonly id: string;
  /** URL guardada actualmente (vacia si no hay imagen por URL). */
  readonly currentUrl: string;
  /**
   * Cambia cuando la imagen se reemplaza o se elimina por otra via (archivo, boton Eliminar,
   * recarga) y descarta el borrador. Por defecto se usa `currentUrl`.
   */
  readonly syncKey?: string;
  readonly disabled: boolean;
  /** Recibe la URL ya validada, o `""` para quitar la imagen. */
  readonly onChange: (src: string) => void;
  /** Avisa al formulario si hay una URL invalida pendiente, para que bloquee el guardado. */
  readonly onInvalidChange?: (invalid: boolean) => void;
}

/**
 * Campo "O use una URL publica" del logo y de las imagenes del carrusel. El backend solo guarda
 * URLs. Mientras el texto no sea valido queda como borrador local: no llega al guardado, pero el
 * formulario se entera (`onInvalidChange`) para impedir guardar sin que se conserve la imagen
 * anterior en silencio.
 */
export function ImageUrlField({
  id,
  currentUrl,
  syncKey = currentUrl,
  disabled,
  onChange,
  onInvalidChange,
}: Readonly<ImageUrlFieldProps>) {
  // El borrador recuerda con que `syncKey` se escribio: si la imagen cambia por otra via, deja de
  // aplicar sin necesidad de un efecto que lo reinicie.
  const [draft, setDraft] = useState<{ text: string; syncKey: string } | null>(null);
  const activeDraft = draft?.syncKey === syncKey ? draft.text : null;
  const invalid = activeDraft !== null;
  const onInvalidChangeRef = useRef(onInvalidChange);

  useEffect(() => {
    onInvalidChangeRef.current = onInvalidChange;
  });

  useEffect(() => {
    onInvalidChangeRef.current?.(invalid);
  }, [invalid]);

  // Al desmontar (p. ej. se cierra el formulario) ya no queda ninguna URL invalida pendiente.
  useEffect(() => {
    const notify = onInvalidChangeRef;
    return () => notify.current?.(false);
  }, []);

  function handleChange(raw: string) {
    const input = resolveImageUrlInput(raw);
    if (input.status === "invalid") {
      setDraft({ text: raw, syncKey });
      return;
    }
    setDraft(null);
    onChange(input.status === "valid" ? input.src : "");
  }

  return (
    <div className="mt-3">
      <label
        className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]"
        htmlFor={id}
      >
        O use una URL pública
      </label>
      <Input
        aria-invalid={invalid || undefined}
        disabled={disabled}
        id={id}
        inputMode="url"
        onChange={(event) => handleChange(event.target.value)}
        placeholder="https://..."
        type="url"
        value={activeDraft ?? currentUrl}
      />
      {invalid ? (
        <p className="mt-1 text-xs text-[var(--color-danger)]" role="alert">
          {INVALID_IMAGE_URL_MESSAGE}
        </p>
      ) : null}
    </div>
  );
}
