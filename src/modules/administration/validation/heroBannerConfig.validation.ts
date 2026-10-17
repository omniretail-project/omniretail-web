import type { HeroBannerConfigInputDto } from "@/modules/administration/application/dto/HeroBannerConfigDto";
import { AdministrationServiceError } from "@/modules/administration/application/services/serviceHelpers";
import { ADMIN_FIELD_LIMITS } from "@/modules/administration/validation/adminFieldConstraints";

const LIMITS = ADMIN_FIELD_LIMITS.heroBanner;
const SLIDE_COUNT = 3;

export function validateHeroBannerConfigInput(dto: HeroBannerConfigInputDto) {
  if (dto.slides.length !== SLIDE_COUNT) {
    throw new AdministrationServiceError("El carrusel debe tener exactamente 3 diapositivas.");
  }
  dto.slides.forEach((slide, index) => {
    if (slide.title.trim().length > LIMITS.title) {
      throw new AdministrationServiceError(
        `El título de la diapositiva ${index + 1} no puede exceder ${LIMITS.title} caracteres.`,
      );
    }
    if (slide.description.trim().length > LIMITS.description) {
      throw new AdministrationServiceError(
        `La descripción de la diapositiva ${index + 1} no puede exceder ${LIMITS.description} caracteres.`,
      );
    }
  });
}

export function normalizeHeroBannerConfigInput(
  dto: HeroBannerConfigInputDto,
): HeroBannerConfigInputDto {
  return {
    slides: dto.slides.map((slide) => ({
      title: slide.title.trim(),
      description: slide.description.trim(),
      image: slide.image,
      pendingImage: slide.pendingImage,
      removeImage: slide.removeImage,
    })),
  };
}
