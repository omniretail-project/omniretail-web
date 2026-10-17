/**
 * Forma del formulario de registro de cliente (capa UI). useRegister la
 * mapea a AuthRepository.RegisterCustomerInput renombrando
 * password -> passwordMock. El tenant NO forma parte de este DTO -- viaja
 * como parametro aparte de registerCustomer() (via usePublicTenant(),
 * nunca hardcodeado ni tomado de un campo de formulario, ver RegisterPage),
 * justamente para que el form nunca pueda decidir en que tenant se
 * registra.
 *
 * confirmPassword existe solo para validacion de cliente (detectar un
 * typo al escribir la contraseña); nunca se envia al repositorio.
 */
export interface RegisterFormDto {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}
