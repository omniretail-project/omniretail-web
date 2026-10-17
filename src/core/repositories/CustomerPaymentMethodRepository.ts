import type { CustomerPaymentMethod } from "@/core/entities";
import type { CustomerPaymentMethodStatus } from "@/core/enums";

/**
 * Allowlist explicita de lo que un caller puede pedir crear. Deliberadamente
 * NO incluye: type (siempre PaymentMethod.card en V1, fijado por el repo),
 * providerPaymentMethodId (SIEMPRE generado por el repositorio, nunca
 * aceptado desde afuera), isDefault (se computa server-side igual que en
 * Address, o se cambia via setDefault()), ni ningun campo de tarjeta
 * completo/CVV -- esos ni siquiera tienen lugar en el tipo.
 * tenantId/customerId son obligatorios pero deben provenir siempre de la
 * identidad resuelta en sesion, nunca de un formulario.
 */
export type CreateCustomerPaymentMethodInput = Pick<
  CustomerPaymentMethod,
  | "tenantId"
  | "customerId"
  | "brand"
  | "issuingBank"
  | "last4"
  | "expirationMonth"
  | "expirationYear"
  | "cardholderName"
> & {
  status?: CustomerPaymentMethodStatus;
};

/**
 * brand, issuingBank y last4 son inmutables tras la creacion (para eso
 * se agrega una tarjeta nueva). isDefault queda fuera: solo
 * setDefault() lo cambia. tenantId/customerId/providerPaymentMethodId
 * nunca son editables.
 */
export type UpdateCustomerPaymentMethodInput = Partial<
  Pick<CustomerPaymentMethod, "cardholderName" | "expirationMonth" | "expirationYear" | "status">
>;

/**
 * Todas las operaciones por id exigen tenantId + customerId explicitos.
 * Un paymentMethodId por si solo nunca es suficiente para leer/mutar el
 * recurso -- un id que pertenezca a otro tenant/cliente se trata como
 * "no existe".
 */
export interface CustomerPaymentMethodRepository {
  getByCustomer(tenantId: string, customerId: string): Promise<CustomerPaymentMethod[]>;
  getById(tenantId: string, customerId: string, id: string): Promise<CustomerPaymentMethod | null>;
  create(input: CreateCustomerPaymentMethodInput): Promise<CustomerPaymentMethod>;
  update(
    tenantId: string,
    customerId: string,
    id: string,
    input: UpdateCustomerPaymentMethodInput,
  ): Promise<CustomerPaymentMethod>;
  remove(tenantId: string, customerId: string, id: string): Promise<void>;
  setDefault(
    tenantId: string,
    customerId: string,
    paymentMethodId: string,
  ): Promise<CustomerPaymentMethod>;
}
