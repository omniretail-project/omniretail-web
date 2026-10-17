/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState } from "react";
import { BusinessPreset } from "@/core/enums";
import { heroBannerDefaultsConfig, heroBannerPresetLabels } from "@/config/hero-banner-defaults";
import { useBlobPreviewUrl, useCatalogImageUrl } from "@/infrastructure/media/useCatalogImageUrl";
import type {
  HeroBannerConfigInputDto,
  HeroBannerSlideInput,
} from "@/modules/administration/application/dto/HeroBannerConfigDto";
import { ImageUrlField } from "@/modules/administration/components/ImageUrlField";
import { ADMIN_FIELD_LIMITS } from "@/modules/administration/validation/adminFieldConstraints";
import { processImageUpload } from "@/shared/application/services/processImageUpload";
import { Button } from "@/shared/components/Button";
import { FormField } from "@/shared/components/FormField";
import { Input } from "@/shared/components/Input";

const LIMITS = ADMIN_FIELD_LIMITS.heroBanner;
const SLIDE_LABELS = ["Diapositiva 1", "Diapositiva 2", "Diapositiva 3"];

interface HeroBannerConfigFormProps {
  value: HeroBannerConfigInputDto;
  tenantId: string | null;
  preset: BusinessPreset | null;
  saving: boolean;
  onChange: (value: HeroBannerConfigInputDto) => void;
  /** Avisa si alguna diapositiva tiene una URL de imagen invalida pendiente (bloquea el guardado). */
  onImageUrlInvalidChange?: (invalid: boolean) => void;
}

export function HeroBannerConfigForm({
  value,
  tenantId,
  preset,
  saving,
  onChange,
  onImageUrlInvalidChange,
}: Readonly<HeroBannerConfigFormProps>) {
  const [uploadErrors, setUploadErrors] = useState<Record<number, string | undefined>>({});
  const [invalidUrlSlides, setInvalidUrlSlides] = useState<ReadonlySet<number>>(new Set());
  const hasInvalidUrl = invalidUrlSlides.size > 0;

  useEffect(() => {
    onImageUrlInvalidChange?.(hasInvalidUrl);
  }, [hasInvalidUrl, onImageUrlInvalidChange]);

  const reportInvalidUrl = useCallback((index: number, invalid: boolean) => {
    setInvalidUrlSlides((current) => {
      if (current.has(index) === invalid) return current;
      const next = new Set(current);
      if (invalid) next.add(index);
      else next.delete(index);
      return next;
    });
  }, []);

  const [showImageHelp, setShowImageHelp] = useState(false);
  const canSuggest = Boolean(preset && preset !== BusinessPreset.custom);

  function updateSlide(index: number, patch: Partial<HeroBannerSlideInput>) {
    onChange({
      slides: value.slides.map((slide, slideIndex) =>
        slideIndex === index ? { ...slide, ...patch } : slide,
      ),
    });
  }

  async function selectImage(index: number, file: File | undefined) {
    if (!file) return;
    setUploadErrors((current) => ({ ...current, [index]: undefined }));
    try {
      const pendingImage = await processImageUpload(file);
      updateSlide(index, { pendingImage, removeImage: false });
    } catch (error) {
      setUploadErrors((current) => ({
        ...current,
        [index]: error instanceof Error ? error.message : "No se pudo procesar la imagen.",
      }));
    }
  }

  function applySuggestedPhrases() {
    if (!preset || preset === BusinessPreset.custom) return;
    const suggestions = heroBannerDefaultsConfig[preset];
    onChange({
      slides: value.slides.map((slide, index) => ({
        ...slide,
        title: suggestions[index]?.title ?? slide.title,
        description: suggestions[index]?.description ?? slide.description,
      })),
    });
  }

  return (
    <div className="space-y-5 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[var(--color-border)] pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-[var(--color-title)]">Carrusel principal</h2>
            <button
              aria-controls="hero-banner-image-guidance"
              aria-expanded={showImageHelp}
              aria-label="Mostrar recomendaciones para las imágenes"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-white text-xs font-bold text-[var(--color-text-muted)] transition hover:border-[var(--color-structure)] hover:text-[var(--color-structure)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-structure)]"
              onClick={() => setShowImageHelp((current) => !current)}
              title="Recomendaciones para las imágenes"
              type="button"
            >
              <span aria-hidden="true">?</span>
            </button>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Defina los títulos, descripciones e imágenes que se mostrarán en la portada de su tienda.
          </p>
        </div>
        {canSuggest ? (
          <Button disabled={saving} onClick={applySuggestedPhrases} type="button" variant="secondary">
            Usar frases sugeridas para{" "}
            {heroBannerPresetLabels[preset as Exclude<BusinessPreset, BusinessPreset.custom>]}
          </Button>
        ) : null}
      </div>

      {showImageHelp ? (
        <div
          className="rounded-lg bg-blue-50/70 px-4 py-3 text-sm text-[var(--color-text)]"
          id="hero-banner-image-guidance"
          role="note"
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <p>
              <span className="block text-xs font-semibold text-[var(--color-text-muted)]">
                Tamaño recomendado
              </span>
              <strong className="text-[var(--color-title)]">1600 × 900 px (16:9)</strong>
            </p>
            <p>
              <span className="block text-xs font-semibold text-[var(--color-text-muted)]">
                Formatos permitidos
              </span>
              <strong className="text-[var(--color-title)]">JPG, PNG o WebP</strong>
            </p>
            <p>
              <span className="block text-xs font-semibold text-[var(--color-text-muted)]">
                Tamaño máximo
              </span>
              <strong className="text-[var(--color-title)]">5 MB</strong>
            </p>
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-[var(--color-text-muted)]">
            <li>
              Mantenga el producto o elemento principal cerca del centro de la imagen.
            </li>
            <li>
              Las imágenes se adaptarán al tamaño de la pantalla y pueden recortarse ligeramente
              en algunos dispositivos. Evite colocar texto, logotipos o elementos importantes
              cerca de los bordes, especialmente en el lado izquierdo, donde se mostrará
              información de la tienda.
            </li>
            <li>
              Las imágenes de mayor tamaño serán ajustadas automáticamente por el sistema.
            </li>
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {value.slides.map((slide, index) => (
          <HeroBannerSlideFields
            index={index}
            key={index}
            onChangeDescription={(description) => updateSlide(index, { description })}
            onChangeImageUrl={(src) =>
              updateSlide(
                index,
                src
                  ? { image: { kind: "url", src }, pendingImage: undefined, removeImage: false }
                  : {
                      image: undefined,
                      pendingImage: undefined,
                      removeImage: Boolean(value.slides[index]?.image),
                    },
              )
            }
            onChangeTitle={(title) => updateSlide(index, { title })}
            onImageUrlInvalidChange={(invalid) => reportInvalidUrl(index, invalid)}
            onRemoveImage={() =>
              updateSlide(index, { image: undefined, pendingImage: undefined, removeImage: true })
            }
            onSelectImage={(file) => void selectImage(index, file)}
            saving={saving}
            slide={slide}
            tenantId={tenantId}
            uploadError={uploadErrors[index]}
          />
        ))}
      </div>
    </div>
  );
}

function HeroBannerSlideFields({
  index,
  onChangeDescription,
  onChangeImageUrl,
  onChangeTitle,
  onImageUrlInvalidChange,
  onRemoveImage,
  onSelectImage,
  saving,
  slide,
  tenantId,
  uploadError,
}: Readonly<{
  index: number;
  onChangeDescription: (description: string) => void;
  /** Recibe la URL ya validada, o `""` para quitar la imagen. */
  onChangeImageUrl: (src: string) => void;
  onChangeTitle: (title: string) => void;
  onImageUrlInvalidChange: (invalid: boolean) => void;
  onRemoveImage: () => void;
  onSelectImage: (file: File | undefined) => void;
  saving: boolean;
  slide: HeroBannerSlideInput;
  tenantId: string | null;
  uploadError: string | undefined;
}>) {
  const previewBlobUrl = useBlobPreviewUrl(slide.pendingImage?.blob);
  const persistedUrl = useCatalogImageUrl(tenantId, slide.removeImage ? undefined : slide.image, "");
  const previewUrl = previewBlobUrl ?? persistedUrl;
  const hasImage = Boolean(slide.pendingImage || (slide.image && !slide.removeImage));
  const currentImageUrl =
    slide.image?.kind === "url" && !slide.removeImage && !slide.pendingImage ? slide.image.src : "";
  // Cualquier cambio de la imagen por otra via (archivo, Eliminar, recarga) descarta el borrador.
  const imageSyncKey = `${currentImageUrl}|${slide.pendingImage ? "archivo" : ""}|${slide.removeImage ? "eliminado" : ""}`;

  return (
    <div className="flex min-w-0 flex-col space-y-4 overflow-hidden rounded-xl bg-slate-50 p-4 shadow-sm">
      <h3 className="text-sm font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
        {SLIDE_LABELS[index]}
      </h3>
      <FormField id={`hero-banner-image-${index}`} label="Imagen">
        {previewUrl ? (
          <img
            alt=""
            className="aspect-[16/9] h-auto w-full rounded-lg bg-white object-cover shadow-sm"
            src={previewUrl}
          />
        ) : (
          <div className="flex aspect-[16/9] h-auto w-full items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-white text-xs text-[var(--color-text-muted)]">
            Sin imagen
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="inline-flex min-h-10 flex-1 cursor-pointer items-center justify-center rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-center text-sm font-semibold text-[var(--color-text)] transition hover:bg-slate-50">
            {hasImage ? "Reemplazar imagen" : "Seleccionar imagen"}
            <input
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => {
                onSelectImage(event.target.files?.[0]);
                event.target.value = "";
              }}
              type="file"
            />
          </label>
          {hasImage ? (
            <Button className="px-3" disabled={saving} onClick={onRemoveImage} type="button" variant="danger">
              Eliminar
            </Button>
          ) : null}
        </div>
        {uploadError ? <p className="mt-2 text-sm text-[var(--color-danger)]">{uploadError}</p> : null}
        <ImageUrlField
          currentUrl={currentImageUrl}
          disabled={saving}
          id={`hero-banner-image-url-${index}`}
          onChange={onChangeImageUrl}
          onInvalidChange={onImageUrlInvalidChange}
          syncKey={imageSyncKey}
        />
      </FormField>
      <FormField id={`hero-banner-title-${index}`} label="Título">
        <Input
          disabled={saving}
          id={`hero-banner-title-${index}`}
          maxLength={LIMITS.title}
          onChange={(event) => onChangeTitle(event.target.value)}
          value={slide.title}
        />
        <p className="mt-1 text-right text-xs tabular-nums text-[var(--color-text-muted)]">
          {slide.title.length} / {LIMITS.title}
        </p>
      </FormField>
      <FormField id={`hero-banner-description-${index}`} label="Descripción">
        <textarea
          className="min-h-24 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none transition placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-structure)] focus:ring-2 focus:ring-[var(--color-primary)]/40"
          disabled={saving}
          id={`hero-banner-description-${index}`}
          maxLength={LIMITS.description}
          onChange={(event) => onChangeDescription(event.target.value)}
          value={slide.description}
        />
        <p className="mt-1 text-right text-xs tabular-nums text-[var(--color-text-muted)]">
          {slide.description.length} / {LIMITS.description}
        </p>
      </FormField>
    </div>
  );
}
