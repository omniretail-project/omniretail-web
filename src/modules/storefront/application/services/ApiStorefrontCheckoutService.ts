import type {
  StorefrontCheckoutFormDto,
  StorefrontCheckoutResultDto,
} from "@/modules/storefront/application/dto/StorefrontCheckoutDto";
import type { StorefrontCartItemDto } from "@/modules/storefront/application/dto/StorefrontCartDto";
import { BackendRequestError } from "@/infrastructure/api/backendClient";

interface BackendCheckoutResponse extends Omit<StorefrontCheckoutResultDto, "items"> {
  items: Array<Omit<StorefrontCheckoutResultDto["items"][number], "imageUrl" | "imageAlt">>;
}

export class ApiStorefrontCheckoutService {
  async execute(input: {
    tenantSlug: string;
    items: StorefrontCartItemDto[];
    form: StorefrontCheckoutFormDto;
    idempotencyKey: string;
  }): Promise<StorefrontCheckoutResultDto> {
    const response = await fetch(`/api/public/${encodeURIComponent(input.tenantSlug)}/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({ ...input.form, items: input.items.map(({ productId, quantity }) => ({ productId, quantity })) }),
    });
    const payload = (await response.json().catch(() => null)) as
      | BackendCheckoutResponse
      | { message?: string; code?: string }
      | null;
    if (!response.ok) {
      // Se conserva status/code del ApiError (p. ej. 409 INSUFFICIENT_STOCK) para que la UI decida el mensaje.
      const apiError = payload && "message" in payload ? payload : null;
      throw new BackendRequestError(
        apiError?.message || "No se pudo procesar el pedido.",
        response.status,
        typeof apiError?.code === "string" ? apiError.code : undefined,
      );
    }
    const checkout = payload as BackendCheckoutResponse;
    return {
      ...checkout,
      items: (checkout.items ?? []).map((item) => {
        const cartItem = input.items.find((candidate) => candidate.sku === item.sku);
        return { ...item, imageUrl: cartItem?.imageUrl, imageAlt: cartItem?.imageAlt };
      }),
    };
  }
}
