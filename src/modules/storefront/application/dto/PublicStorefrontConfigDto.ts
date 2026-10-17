import type { CatalogImageSource } from "@/core/entities";

export interface PublicStorefrontBranchDto {
  id: string;
  name: string;
  code?: string;
  address?: string;
  phone?: string;
  email?: string;
}

export interface PublicHeroBannerSlideDto {
  title: string;
  description: string;
  imageSource?: CatalogImageSource;
}

export interface PublicStorefrontConfigDto {
  storeName: string;
  storeEnabled: boolean;
  accountRequired: boolean;
  guestTrackingEnabled: boolean;
  contactPhone?: string;
  contactEmail?: string;
  logoImageSource?: CatalogImageSource;
  branches: PublicStorefrontBranchDto[];
  heroBanner: { slides: PublicHeroBannerSlideDto[] };
}
