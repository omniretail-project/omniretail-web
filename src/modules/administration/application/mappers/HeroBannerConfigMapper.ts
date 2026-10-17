import type { HeroBannerConfig } from "@/core/entities";
import type { HeroBannerConfigDto } from "@/modules/administration/application/dto/HeroBannerConfigDto";

export function toHeroBannerConfigDto(config: HeroBannerConfig): HeroBannerConfigDto {
  return {
    slides: config.slides.map((slide) => ({ ...slide })),
  };
}
