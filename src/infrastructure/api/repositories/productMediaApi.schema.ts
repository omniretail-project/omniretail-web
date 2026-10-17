import { z } from "zod";
import { isApiUuid } from "@/infrastructure/api/uuid";
import { isBackendManagedMediaUrl } from "@/infrastructure/api/mediaUrl";

const apiUuidSchema = z.string().refine(isApiUuid, {
  message: "UUID de backend inválido.",
});

export const apiProductMediaSchema = z.object({
  id: apiUuidSchema,
  productId: apiUuidSchema,
  type: z.enum(["image", "video"]),
  url: z.string().refine(
    (value) => isBackendManagedMediaUrl(value) || /^https?:\/\//i.test(value),
    { message: "URL multimedia de backend inválida." },
  ),
  altText: z.string().nullable(),
  primary: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const apiProductMediaListSchema = z.array(apiProductMediaSchema);

export type ApiProductMedia = z.infer<typeof apiProductMediaSchema>;
