/**
 * Espeja los campos editables de Address (core/entities/Address.ts) menos
 * id/customerId/isDefault/timestamps -- isDefault se maneja como accion
 * separada (AddressRepository.setDefault()), no como campo del
 * formulario de crear/editar. `country` no es parte del formulario: la
 * plataforma opera unicamente en Guatemala, asi que se fija server-side
 * (ver addressService.toFields) en vez de pedirselo al cliente.
 */
export interface AddressFormDto {
  label: string;
  recipientName: string;
  line1: string;
  line2: string;
  city: string;
  stateOrDepartment: string;
  postalCode: string;
  references: string;
}
