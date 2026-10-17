import {
  GUATEMALA_DEPARTMENTS,
  GUATEMALA_MUNICIPALITIES,
  POSTAL_CODE_PATTERN,
} from "@/config/guatemala-locations";
import type { AddressFormDto } from "@/modules/customer/application/dto/AddressFormDto";
import {
  DELIVERY_ADDRESS_LIMITS,
  isValidDeliveryAddress,
  isValidRecipientName,
} from "@/config/delivery-address-policy";

export type AddressValidationErrors = Partial<
  Record<"label" | "recipientName" | "line1" | "line2" | "references" | "city" | "stateOrDepartment" | "postalCode", string>
>;

/**
 * Mismo criterio que el repositorio (MockAddressRepository.
 * assertValidAddress), replicado aca para que el formulario falle antes
 * de llamar al repo: label, recipientName, line1 y stateOrDepartment son
 * obligatorios -- Departamento dejó de ser opcional porque Municipio
 * (antes "Ciudad", el campo `city`) depende de él para saber qué
 * opciones mostrar y validar; un municipio sin departamento no tiene
 * forma de verificarse. postalCode sigue siendo opcional, pero si SE
 * completa ya no acepta cualquier texto. `country` no se pide en el
 * formulario -- la plataforma opera unicamente en Guatemala, asi que se
 * fija server-side (addressService.toFields) en vez de pedirselo al
 * cliente.
 */
export function validateAddressForm(dto: AddressFormDto): AddressValidationErrors {
  const errors: AddressValidationErrors = {};

  if (!dto.label.trim()) {
    errors.label = "El nombre de la dirección es obligatorio.";
  } else if (dto.label.trim().length > DELIVERY_ADDRESS_LIMITS.label) {
    errors.label = `El nombre de la dirección no puede superar ${DELIVERY_ADDRESS_LIMITS.label} caracteres.`;
  }
  if (!dto.recipientName.trim()) {
    errors.recipientName = "El destinatario es obligatorio.";
  } else if (!isValidRecipientName(dto.recipientName)) {
    errors.recipientName = `El destinatario permite letras, espacios, apóstrofes y guiones; máximo ${DELIVERY_ADDRESS_LIMITS.recipientName} caracteres.`;
  }
  if (!dto.line1.trim()) {
    errors.line1 = "La dirección es obligatoria.";
  } else if (!isValidDeliveryAddress(dto.line1, "line1")) {
    errors.line1 = `La dirección permite letras, números, puntos y guiones; máximo ${DELIVERY_ADDRESS_LIMITS.line1} caracteres.`;
  }
  if (dto.line2 && !isValidDeliveryAddress(dto.line2, "line2")) {
    errors.line2 = `El complemento permite solo letras, números y espacios; máximo ${DELIVERY_ADDRESS_LIMITS.line2} caracteres.`;
  }
  if (dto.references && !isValidDeliveryAddress(dto.references, "references")) {
    errors.references = `Las referencias permiten letras, números, espacios y comas; máximo ${DELIVERY_ADDRESS_LIMITS.references} caracteres.`;
  }

  const stateOrDepartment = dto.stateOrDepartment.trim();
  if (!stateOrDepartment) {
    errors.stateOrDepartment = "El departamento es obligatorio.";
  } else if (
    !GUATEMALA_DEPARTMENTS.includes(stateOrDepartment as (typeof GUATEMALA_DEPARTMENTS)[number])
  ) {
    errors.stateOrDepartment = "Selecciona un departamento válido.";
  }

  const city = dto.city.trim();
  if (!city) {
    errors.city = "El municipio es obligatorio.";
  } else if (
    GUATEMALA_DEPARTMENTS.includes(stateOrDepartment as (typeof GUATEMALA_DEPARTMENTS)[number]) &&
    !GUATEMALA_MUNICIPALITIES[stateOrDepartment as (typeof GUATEMALA_DEPARTMENTS)[number]].includes(
      city,
    )
  ) {
    errors.city = "Selecciona un municipio que pertenezca al departamento elegido.";
  }

  const postalCode = dto.postalCode.trim();
  if (postalCode && !POSTAL_CODE_PATTERN.test(postalCode)) {
    errors.postalCode = "El código postal debe tener 5 dígitos.";
  }

  return errors;
}

export function hasAddressValidationErrors(errors: AddressValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}
