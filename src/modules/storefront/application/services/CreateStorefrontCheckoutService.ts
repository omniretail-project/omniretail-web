import {
  BranchStatus,
  DeliveryMethod,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  SalesChannel,
  TransportMode,
} from "@/core/enums";
import { InsufficientInventoryAvailabilityError } from "@/core/inventory/stockAvailability";
import { calculateEffectivePrice, resolveQuantityPrice } from "@/core/pricing";
import { toBaseQuantity } from "@/core/units";
import { validatePhoneNumber } from "@/config/contact-policy";
import { normalizeEmail, validateEmail } from "@/config/email-policy";
import { calculateStorefrontShipping } from "@/config/storefront-shipping-policy";
import {
  DELIVERY_ADDRESS_LIMITS,
  isValidDeliveryAddress,
  isValidDeliveryNotificationEmail,
  isValidRecipientName,
} from "@/config/delivery-address-policy";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { StorefrontCartItemDto } from "@/modules/storefront/application/dto/StorefrontCartDto";
import type {
  StorefrontCheckoutFormDto,
  StorefrontCheckoutResultDto,
} from "@/modules/storefront/application/dto/StorefrontCheckoutDto";
import { resolveOptionalCustomerAuthorizationContext } from "@/modules/customer/application/services/CustomerAuthorizationContext";
import { GetStorefrontPublishedProductService } from "@/modules/storefront/application/services/GetStorefrontPublishedProductService";
import { ConfirmStorefrontPaymentService } from "@/modules/storefront/application/services/ConfirmStorefrontPaymentService";
import { StorefrontOrderEmailSimulationService } from "@/modules/storefront/application/services/StorefrontOrderEmailSimulationService";
import { ResolvePublicStorefrontContextService } from "@/modules/storefront/application/services/ResolvePublicStorefrontContextService";

export class CreateStorefrontCheckoutService {
  private readonly publishedProductService: GetStorefrontPublishedProductService;
  private readonly paymentConfirmationService: ConfirmStorefrontPaymentService;
  private readonly publicStorefrontContextService: ResolvePublicStorefrontContextService;
  private readonly emailSimulationService = new StorefrontOrderEmailSimulationService();

  constructor(private readonly repositories: RepositoryRegistry) {
    this.publishedProductService = new GetStorefrontPublishedProductService(repositories);
    this.paymentConfirmationService = new ConfirmStorefrontPaymentService(repositories);
    this.publicStorefrontContextService = new ResolvePublicStorefrontContextService(repositories);
  }

  async execute({
    tenantSlug,
    items,
    form,
    idempotencyKey,
  }: {
    tenantSlug: string;
    items: StorefrontCartItemDto[];
    form: StorefrontCheckoutFormDto;
    idempotencyKey: string;
  }): Promise<StorefrontCheckoutResultDto> {
    const normalizedEmail = normalizeEmail(form.email);
    assertCheckoutForm({ ...form, email: normalizedEmail });
    const checkoutIdentity = idempotencyKey.trim();
    if (!checkoutIdentity) throw new Error("No se pudo inicializar el pedido.");

    const { tenantId, ecommerceConfig } = await this.publicStorefrontContextService.execute({
      tenantSlug,
    });
    const [products, customerContext] = await Promise.all([
      Promise.all(
        items.map(async (item) => ({
          item,
          product: await this.publishedProductService.execute(tenantId, item.productId),
        })),
      ),
      resolveOptionalCustomerAuthorizationContext(this.repositories),
    ]);

    const authenticatedCustomer = customerContext?.tenantId === tenantId ? customerContext : null;
    if (ecommerceConfig.requireAccountForCheckout && !authenticatedCustomer) {
      throw new Error("Debe iniciar sesión con una cuenta de esta tienda para comprar.");
    }
    if (!ecommerceConfig.allowedDeliveryMethods.includes(DeliveryMethod.home_delivery)) {
      throw new Error("El envío a domicilio no está disponible.");
    }
    if (!ecommerceConfig.allowedPaymentMethods.includes(PaymentMethod.card)) {
      throw new Error("El pago con tarjeta no está disponible.");
    }
    if (!ecommerceConfig.defaultBranchId) {
      throw new Error("No hay una sucursal configurada para despachar pedidos.");
    }
    if (items.length === 0) throw new Error("El carrito está vacío.");

    const branch = await this.repositories.branches.getById(ecommerceConfig.defaultBranchId);
    if (!branch || branch.tenantId !== tenantId || branch.status !== BranchStatus.active) {
      throw new Error("La sucursal de despacho no está disponible.");
    }

    const checkoutToken = checkoutIdentity.replaceAll("-", "");
    const orderItems = await Promise.all(
      products.map(async ({ item, product }, index) => {
        if (!product)
          throw new Error("Uno de los productos ya no está disponible para e-commerce.");
        if (
          !Number.isFinite(item.quantity) ||
          !Number.isInteger(item.quantity) ||
          item.quantity <= 0
        ) {
          throw new Error("La cantidad de un producto no es válida.");
        }

        const [promotion, salesPriceTiers, conversions] = await Promise.all([
          this.repositories.promotions.getApplicable({
            tenantId,
            productId: product.id,
            at: new Date().toISOString(),
            channel: SalesChannel.ecommerce,
            branchId: branch.id,
          }),
          this.repositories.productSalesPriceTiers.getByProduct(product.id),
          this.repositories.units.getConversionsByProductScoped(tenantId, product.id),
        ]);
        const quantityPrice = resolveQuantityPrice({
          basePrice: product.salePrice,
          quantity: item.quantity,
          tiers: salesPriceTiers.filter(
            (tier) => tier.tenantId === tenantId && tier.productId === product.id,
          ),
        });
        const price = calculateEffectivePrice(quantityPrice, promotion);
        const unitPrice = price.effectivePrice;
        const inventoryQuantity = toBaseQuantity(item.quantity, {
          sourceUnitId: product.saleUnitId ?? product.baseUnitId,
          baseUnitId: product.baseUnitId,
          conversions,
          requireInteger: product.tracking.stock,
        });
        return {
          id: `storefront-item-${checkoutIdentity}-${index}`,
          productId: product.id,
          skuSnapshot: product.sku,
          nameSnapshot: product.name,
          quantity: item.quantity,
          inventoryQuantity,
          unitPrice,
          discount: price.discountAmount,
          subtotal: unitPrice * item.quantity,
        };
      }),
    );
    const subtotal = orderItems.reduce((total, item) => total + item.subtotal, 0);
    const discountTotal = orderItems.reduce(
      (total, item) => total + item.discount * item.quantity,
      0,
    );
    const netSubtotal = subtotal - discountTotal;
    const shippingTotal = calculateStorefrontShipping(netSubtotal);
    const orderTotal = netSubtotal + shippingTotal;
    const orderNumber = `WEB-${checkoutToken.slice(0, 10).toUpperCase()}`;
    const trackingToken = checkoutToken;

    const { order, payment } = await this.repositories.orders.createWithPayment({
      order: {
        tenantId,
        branchId: branch.id,
        orderNumber,
        source: OrderSource.ecommerce,
        customerId: authenticatedCustomer?.customerId,
        guestCustomer: authenticatedCustomer
          ? undefined
          : { name: form.fullName.trim(), email: normalizedEmail },
        items: orderItems,
        status: OrderStatus.pending,
        deliveryMethod: DeliveryMethod.home_delivery,
        transportMode: TransportMode.third_party,
        notificationContact: { emailMode: "send", email: normalizedEmail },
        deliveryAddress: {
          recipientName: form.fullName.trim(),
          recipientPhone: form.phone.trim(),
          line1: form.addressLine1.trim(),
          line2: form.addressLine2?.trim() || undefined,
          city: form.city.trim(),
          stateOrDepartment: form.department?.trim() || undefined,
          country: "Guatemala",
          references: buildReferences(form),
        },
        subtotal,
        discountTotal,
        shippingTotal,
        total: orderTotal,
        trackingToken,
        idempotencyKey: checkoutIdentity,
      },
      payment: {
        tenantId,
        method: PaymentMethod.card,
        status: PaymentStatus.pending,
        amount: orderTotal,
        currency: "GTQ",
        reference: `CARD-SIMULATED-${form.cardLastFour}`,
      },
    });
    let confirmation;
    try {
      confirmation = await this.paymentConfirmationService.execute({
        tenantId,
        branchId: branch.id,
        orderId: order.id,
        paymentId: payment.id,
      });
    } catch (cause) {
      if (cause instanceof InsufficientInventoryAvailabilityError) {
        throw new Error(
          "No hay suficiente disponibilidad para completar el pedido. Actualice el carrito e inténtelo nuevamente.",
        );
      }
      throw cause;
    }
    const emailSimulation = this.emailSimulationService.simulateConfirmation(
      normalizedEmail,
      tenantSlug,
      confirmation.order.trackingToken,
    );

    return {
      orderNumber: confirmation.order.orderNumber,
      trackingToken: confirmation.order.trackingToken,
      guestTrackingEnabled: ecommerceConfig.guestTrackingEnabled,
      confirmationEmailSent: emailSimulation.sent,
      total: confirmation.order.total,
      orderStatus: confirmation.order.status,
      paymentStatus: confirmation.payment.status,
      hasInventoryReservations: confirmation.inventoryReservations.length > 0,
      deliveryAddress: {
        recipientName: form.fullName.trim(),
        line1: form.addressLine1.trim(),
        line2: form.addressLine2?.trim() || undefined,
        city: form.city.trim(),
        department: form.department?.trim() || undefined,
        phone: form.phone.trim(),
      },
      items: orderItems.map((item) => ({
        sku: item.skuSnapshot,
        name: item.nameSnapshot,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.subtotal,
      })),
    };
  }
}

function buildReferences(form: StorefrontCheckoutFormDto): string | undefined {
  return form.references?.trim() || undefined;
}

function assertCheckoutForm(form: StorefrontCheckoutFormDto): void {
  if (!form.fullName.trim()) throw new Error("Ingrese el nombre completo.");
  if (!isValidRecipientName(form.fullName)) {
    throw new Error("El nombre contiene caracteres no permitidos o supera el límite permitido.");
  }
  if (validateEmail(form.email) || !isValidDeliveryNotificationEmail(form.email)) {
    throw new Error("Ingrese un correo electrónico válido.");
  }
  if (!form.phone.trim()) throw new Error("Ingrese un teléfono de contacto.");
  const phoneError = validatePhoneNumber(form.phone);
  if (phoneError) throw new Error(phoneError);
  if (!form.addressLine1.trim()) throw new Error("Ingrese la dirección de entrega.");
  if (!isValidDeliveryAddress(form.addressLine1, "line1")) {
    throw new Error(
      `La dirección permite letras, números, puntos y guiones; máximo ${DELIVERY_ADDRESS_LIMITS.line1} caracteres.`,
    );
  }
  if (form.addressLine2 && !isValidDeliveryAddress(form.addressLine2, "line2")) {
    throw new Error(
      `El complemento permite solo letras, números y espacios; máximo ${DELIVERY_ADDRESS_LIMITS.line2} caracteres.`,
    );
  }
  if (form.references && !isValidDeliveryAddress(form.references, "references")) {
    throw new Error(
      `Las referencias permiten letras, números, espacios y comas; máximo ${DELIVERY_ADDRESS_LIMITS.references} caracteres.`,
    );
  }
  if (!form.city.trim()) throw new Error("Ingrese la ciudad de entrega.");
  if (!form.cardholderName.trim()) throw new Error("Ingrese el titular de la tarjeta.");
  if (!/^\d{4}$/.test(form.cardLastFour)) {
    throw new Error("Ingrese los últimos 4 dígitos de la tarjeta.");
  }
}
