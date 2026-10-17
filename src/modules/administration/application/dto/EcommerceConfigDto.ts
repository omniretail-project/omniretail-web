import type { EcommerceConfig } from "@/core/entities";
import type { UpdateEcommerceConfigInput } from "@/core/repositories";
import type { ImageUploadDraft } from "@/shared/application/dto/ImageUploadDraft";

export type EcommerceConfigDto = Omit<EcommerceConfig, "tenantId">;

export type EcommerceConfigInputDto = Omit<UpdateEcommerceConfigInput, "logo"> & {
  logo?: EcommerceConfig["logo"];
  pendingLogo?: ImageUploadDraft;
  removeLogo?: boolean;
};
