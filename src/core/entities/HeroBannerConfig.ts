import type { CatalogImageSource } from "@/core/entities/CatalogImage";
import type { ISODateString } from "@/core/types/common.types";

export interface HeroBannerSlide {
  title: string;
  description: string;
  image?: CatalogImageSource;
}

export interface HeroBannerConfig {
  tenantId: string;
  slides: HeroBannerSlide[];
  updatedAt: ISODateString;
}
