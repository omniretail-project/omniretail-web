import { parseCardExpiration } from "@/config/card-input-policy";
import type { CustomerPaymentMethod } from "@/core/entities";
import { mockTokenizeCard } from "@/infrastructure/payments/mockTokenizeCard";
import type { RepositoryRegistry } from "@/infrastructure/providers/RepositoryProvider";
import type { PaymentMethodFormDto } from "@/modules/customer/application/dto/PaymentMethodFormDto";
import { resolveCustomerAuthorizationContext } from "@/modules/customer/application/services/CustomerAuthorizationContext";

type PaymentMethodRepositories = Pick<
  RepositoryRegistry,
  "auth" | "users" | "roles" | "customers" | "customerPaymentMethods"
>;

/**
 * Application services de Metodos de pago. Misma disciplina que
 * addressService: unicamente `repositories` + datos de negocio en la
 * firma publica -- tenantId/customerId se resuelven internamente en
 * cada llamada, nunca se aceptan del caller. La allowlist runtime y las
 * invariantes de default siguen viviendo en MockCustomerPaymentMethodRepository.
 */

export async function listPaymentMethods(
  repositories: PaymentMethodRepositories,
): Promise<CustomerPaymentMethod[]> {
  const context = await resolveCustomerAuthorizationContext(repositories);
  return repositories.customerPaymentMethods.getByCustomer(context.tenantId, context.customerId);
}

function parseExpiration(value: string): { month: number; year: number } {
  const expiration = parseCardExpiration(value);
  if (!expiration) throw new Error("Ingresa una fecha válida en formato MM/AA.");
  return expiration;
}

export async function createPaymentMethod(
  repositories: PaymentMethodRepositories,
  dto: PaymentMethodFormDto,
): Promise<CustomerPaymentMethod> {
  const context = await resolveCustomerAuthorizationContext(repositories);
  const expiration = parseExpiration(dto.expiration);
  // El numero completo y el CVV solo llegan hasta la tokenizacion: de ella
  // se toman brand y last4. providerPaymentMethodId se descarta (lo genera
  // el repositorio/backend), y tenantId/customerId salen del contexto
  // resuelto, nunca del formulario.
  const card = mockTokenizeCard({
    cardNumber: dto.cardNumber,
    cvv: dto.cvv,
    expirationMonth: expiration.month,
    expirationYear: expiration.year,
  });
  return repositories.customerPaymentMethods.create({
    tenantId: context.tenantId,
    customerId: context.customerId,
    brand: card.brand,
    issuingBank: dto.issuingBank.trim(),
    last4: card.last4,
    expirationMonth: card.expirationMonth,
    expirationYear: card.expirationYear,
    cardholderName: dto.cardholderName.trim() || undefined,
  });
}

export async function updatePaymentMethod(
  repositories: PaymentMethodRepositories,
  paymentMethodId: string,
  dto: PaymentMethodFormDto,
): Promise<CustomerPaymentMethod> {
  const context = await resolveCustomerAuthorizationContext(repositories);
  const expiration = parseExpiration(dto.expiration);
  // Numero, CVV, marca, last4 y banco no son editables (la "tarjeta" en si
  // no cambia; para eso se agrega una nueva) -- ni se envian.
  return repositories.customerPaymentMethods.update(
    context.tenantId,
    context.customerId,
    paymentMethodId,
    {
      cardholderName: dto.cardholderName.trim() || undefined,
      expirationMonth: expiration.month,
      expirationYear: expiration.year,
    },
  );
}

export async function removePaymentMethod(
  repositories: PaymentMethodRepositories,
  paymentMethodId: string,
): Promise<void> {
  const context = await resolveCustomerAuthorizationContext(repositories);
  return repositories.customerPaymentMethods.remove(
    context.tenantId,
    context.customerId,
    paymentMethodId,
  );
}

export async function setDefaultPaymentMethod(
  repositories: PaymentMethodRepositories,
  paymentMethodId: string,
): Promise<CustomerPaymentMethod> {
  const context = await resolveCustomerAuthorizationContext(repositories);
  return repositories.customerPaymentMethods.setDefault(
    context.tenantId,
    context.customerId,
    paymentMethodId,
  );
}
