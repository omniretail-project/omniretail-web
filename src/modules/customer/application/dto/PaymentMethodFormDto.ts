/**
 * Estado del formulario de tarjeta: los mismos campos que el checkout
 * (numero, titular, vencimiento MM/AA y CVV) mas el banco emisor.
 *
 * `cardNumber` y `cvv` solo viven en el estado de la pantalla: el servicio
 * los pasa por mockTokenizeCard y al repositorio solo llegan brand, last4,
 * vencimiento, titular y banco (MockCustomerPaymentMethodRepository y el
 * backend rechazan cualquier otro campo). Al editar no se usan: la tarjeta
 * en si no cambia, para eso se agrega una nueva. isDefault se maneja como
 * accion separada (CustomerPaymentMethodRepository.setDefault()).
 */
export interface PaymentMethodFormDto {
  cardNumber: string;
  cardholderName: string;
  /** "MM/AA". */
  expiration: string;
  cvv: string;
  issuingBank: string;
}
