import type { HeroBannerSlide } from "@/core/entities";
import type { ImageUploadDraft } from "@/shared/application/dto/ImageUploadDraft";

export interface HeroBannerConfigDto {
  slides: HeroBannerSlide[];
}

export interface HeroBannerSlideInput {
  title: string;
  description: string;
  image?: HeroBannerSlide["image"];
  pendingImage?: ImageUploadDraft;
  removeImage?: boolean;
}

export interface HeroBannerConfigInputDto {
  slides: HeroBannerSlideInput[];
}
